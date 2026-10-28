import { isUuid } from '../services/syncEnvelope'
import type { TrustedPrivateProjectContext } from './privateProjectDeviceAuth'

/**
 * Pairing is deliberately NOT exposed as a Netlify Function in this PR.
 * An authenticated Netlify login can request a candidate, but NEVER approve
 * its own public key. Only a separate trusted operator channel may approve
 * after comparing the exact public-key fingerprint on the phone.
 */
export type PendingPairing = {
  subject: string
  requestId: string
  nonce: string
  deviceId: string
  publicKeyJwk: JsonWebKey
  fingerprint: string
  expiresAt: Date
  provedAt: Date | null
}

export type PairingRequest = {
  requestId: string
  nonce: string
  fingerprint: string
  expiresAt: string
  siteId: string
  ownerId: string
}

export type ApprovalOutcome =
  | 'approved' | 'already-paired' | 'not-proven' | 'invalid-or-expired'

export interface ManualPairingStore {
  begin(
    subject: string, deviceId: string, publicKeyJwk: JsonWebKey,
    fingerprint: string, ttlSeconds: number
  ): Promise<Omit<PendingPairing, 'subject' | 'deviceId' | 'publicKeyJwk' | 'fingerprint' | 'provedAt'> | null>
  read(subject: string, requestId: string): Promise<PendingPairing | null>
  markProven(subject: string, requestId: string): Promise<boolean>

  /**
   * TRUSTED OPERATOR ONLY: no public route or self-service registration.
   * Call only after verifying owner intent and matching a fingerprint
   * out-of-band. The DB implementation locks the account before granting.
   */
  approveByOperator(
    subject: string, requestId: string, expectedFingerprint: string
  ): Promise<ApprovalOutcome>
  revokeByOperator(subject: string, deviceId: string): Promise<boolean>
}

export type ManualPairingOptions = {
  expectedSiteId: string
  enabled: boolean
  store: ManualPairingStore
  now?: () => number
}

const DOMAIN = 'personal-state-observer:manual-pairing-proof:v1'
const MAX_SECONDS = 300
const textEncoder = new TextEncoder()
const HEX_FINGERPRINT = /^[0-9a-f]{64}$/

function trustedOwner(
  ctx: TrustedPrivateProjectContext,
  opts: ManualPairingOptions
): { subject: string; ownerId: string } | null {
  if (!opts.enabled || !/^[A-Za-z0-9-]{8,100}$/.test(opts.expectedSiteId) ||
    ctx.site?.id !== opts.expectedSiteId) return null
  const user = ctx.user
  if (!user || typeof user.id !== 'string' ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(user.id)) return null
  const expiry = user.expiresAt instanceof Date
    ? user.expiresAt.getTime()
    : typeof user.expiresAt === 'string' ? Date.parse(user.expiresAt) : NaN
  if (!Number.isFinite(expiry) || expiry <= (opts.now?.() ?? Date.now())) return null
  const subject = 'netlify:' + opts.expectedSiteId + ':' + user.id
  if (subject.length > 200) return null
  return { subject, ownerId: user.id }
}

function publicKeyFields(key: JsonWebKey): { kty: string; crv: string; x: string; y: string } {
  if (key?.kty !== 'EC' || key.crv !== 'P-256' ||
    typeof key.x !== 'string' || typeof key.y !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.y) ||
    key.d !== undefined ||
    Object.keys(key).some(name => !['kty', 'crv', 'x', 'y', 'key_ops', 'ext', 'alg'].includes(name))) {
    throw Error('invalid-pairing-public-key')
  }
  // Validate the EC point on the curve, not merely the JWK field shapes.
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }
}

export async function pairingFingerprint(jwk: JsonWebKey): Promise<string> {
  const fields = publicKeyFields(jwk)
  await crypto.subtle.importKey('jwk', { ...fields, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const sha = new Uint8Array(await crypto.subtle.digest(
    'SHA-256', textEncoder.encode(JSON.stringify(fields))
  ))
  return Array.from(sha, b => b.toString(16).padStart(2, '0')).join('')
}

export function pairingProofMessage(args: {
  siteId: string
  ownerId: string
  requestId: string
  nonce: string
  deviceId: string
  fingerprint: string
}): Uint8Array<ArrayBuffer> {
  if (!isUuid(args.requestId) || !isUuid(args.nonce) ||
    !isUuid(args.deviceId) || !HEX_FINGERPRINT.test(args.fingerprint)) {
    throw Error('invalid-pairing-proof-input')
  }
  return textEncoder.encode([
    DOMAIN, args.siteId, args.ownerId, args.requestId, args.nonce,
    args.deviceId, args.fingerprint
  ].join('\n'))
}

function decodeRawSignature(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{86}$/.test(value)) throw Error('invalid-signature')
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==')
    if (binary.length !== 64) throw Error('invalid-signature')
    return Uint8Array.from(binary, char => char.charCodeAt(0))
  } catch { throw Error('invalid-signature') }
}

/** No request object, HTTP route, or side effect outside the injected store. */
export function createPendingPairingWorkflow(
  ctx: TrustedPrivateProjectContext, opts: ManualPairingOptions
) {
  return {
    async request(deviceId: string, publicKeyJwk: JsonWebKey): Promise<PairingRequest | null> {
      const owner = trustedOwner(ctx, opts)
      if (!owner || !isUuid(deviceId)) return null
      let fingerprint: string
      try { fingerprint = await pairingFingerprint(publicKeyJwk) }
      catch { return null }
      const pending = await opts.store.begin(
        owner.subject, deviceId, publicKeyJwk, fingerprint, MAX_SECONDS
      )
      if (!pending || !isUuid(pending.requestId) || !isUuid(pending.nonce)) return null
      return {
        requestId: pending.requestId, nonce: pending.nonce,
        fingerprint, expiresAt: pending.expiresAt.toISOString(),
        siteId: opts.expectedSiteId, ownerId: owner.ownerId
      }
    },

    async prove(requestId: string, signatureBase64Url: string): Promise<boolean> {
      const owner = trustedOwner(ctx, opts)
      if (!owner || !isUuid(requestId)) return false
      let signature: Uint8Array<ArrayBuffer>
      try { signature = decodeRawSignature(signatureBase64Url) }
      catch { return false }
      const pending = await opts.store.read(owner.subject, requestId)
      if (!pending || pending.provedAt ||
        pending.expiresAt.getTime() <= (opts.now?.() ?? Date.now()) ||
        !isUuid(pending.nonce) || !isUuid(pending.deviceId)) return false
      try {
        // Recalculate the fingerprint from the stored immutable public key.
        if (await pairingFingerprint(pending.publicKeyJwk) !== pending.fingerprint) {
          return false
        }
        const key = await crypto.subtle.importKey(
          'jwk', { ...publicKeyFields(pending.publicKeyJwk), ext: true },
          { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
        )
        const message = pairingProofMessage({
          siteId: opts.expectedSiteId, ownerId: owner.ownerId,
          requestId, nonce: pending.nonce, deviceId: pending.deviceId,
          fingerprint: pending.fingerprint
        })
        const valid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' }, key, signature, message
        )
        return valid && opts.store.markProven(owner.subject, requestId)
      } catch { return false }
    }
  }
}
