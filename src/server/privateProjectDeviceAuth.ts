import { isUuid } from '../services/syncEnvelope'
import {
  MAX_SYNC_REQUEST_BYTES,
  type VerifiedSyncSession
} from './guardedSyncService'

/**
 * This shape is constructed from Netlify Functions' trusted context argument.
 * NEVER construct it from request headers, client cookies or submitted JSON.
 * Netlify context.user is supported on private team-login protected projects
 * deployed after Oct 5 2026, but is not available in local Netlify CLI.
 */
export type TrustedPrivateProjectContext = {
  site?: { id?: string }
  user?: { id?: string; expiresAt?: Date | string }
}

export type RegisteredPublisher = {
  deviceId: string
  publicKeyJwk: JsonWebKey
  revoked: boolean
}

export interface PublisherProofStore {
  /**
   * This must lookup the trusted account's device registration.
   * NO automatic enrollment on request or login is allowed.
   */
  getRegisteredPublisher(
    subject: string, deviceId: string
  ): Promise<RegisteredPublisher | null>

  /** Only permit registered non-revoked devices; rate-limit challenge creation. */
  issueChallenge(
    subject: string, deviceId: string, ttlSeconds: number
  ): Promise<{ nonce: string } | null>

  /**
   * MUST atomically mark an unexpired challenge as used, bound to both user
   * and registered device. Return false for expired, missing or used nonces.
   */
  consumeChallenge(
    subject: string, deviceId: string, nonce: string
  ): Promise<boolean>
}

export type PrivateProjectProofOptions = {
  expectedSiteId: string
  expectedOrigin: string
  enabled: boolean
  store: PublisherProofStore
  now?: () => number
}

const MAX_CHALLENGE_SECONDS = 90
const encoder = new TextEncoder()
const DEVICE_PROOF_DOMAIN = 'personal-state-observer:device-publish:v1'

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

function validOptions(opts: PrivateProjectProofOptions): boolean {
  return opts.enabled &&
    /^https:\/\/[^/]+$/.test(opts.expectedOrigin) &&
    opts.expectedSiteId.length >= 8 &&
    opts.expectedSiteId.length <= 100
}

function trustedSubject(
  context: TrustedPrivateProjectContext,
  options: PrivateProjectProofOptions
): string | null {
  if (!validOptions(options) || context.site?.id !== options.expectedSiteId) {
    return null
  }
  const user = context.user
  if (!user || typeof user.id !== 'string' ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(user.id)) return null
  const expiresAt = user.expiresAt instanceof Date
    ? user.expiresAt.getTime()
    : typeof user.expiresAt === 'string'
      ? Date.parse(user.expiresAt) : NaN
  if (!Number.isFinite(expiresAt) ||
    expiresAt <= (options.now?.() ?? Date.now())) return null

  // Both site and user identity come only from trusted Netlify context.
  const subject = 'netlify:' + options.expectedSiteId + ':' + user.id
  return subject.length <= 200 ? subject : null
}

function bytesToUrlBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function signatureBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{86}$/.test(value)) return null
  try {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==')
    if (raw.length !== 64) return null
    return Uint8Array.from(raw, char => char.charCodeAt(0))
  } catch {
    return null
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get('content-length')
  if (length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_SYNC_REQUEST_BYTES)) {
    throw new Error('body-too-large')
  }
  if (!request.body) throw new Error('empty-body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SYNC_REQUEST_BYTES) {
        await reader.cancel()
        throw new Error('body-too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const data = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) {
    data.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  return data
}

function isTrustedOrigin(request: Request, expectedOrigin: string): boolean {
  const url = new URL(request.url)
  return url.origin === expectedOrigin &&
    request.headers.get('origin') === expectedOrigin
}

/**
 * Signing contract shared with the phone client. Includes method + exact
 * URL + SHA-256 of exact wire bytes + one-time challenge + trusted owner.
 * No application record plaintext is ever passed to this helper.
 */
export async function createDeviceProofMessage(args: {
  siteId: string
  ownerId: string
  method: string
  url: string
  nonce: string
  body: Uint8Array<ArrayBuffer>
}): Promise<Uint8Array<ArrayBuffer>> {
  if (!isUuid(args.nonce) || args.method !== 'POST') {
    throw new Error('invalid-device-proof-input')
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', args.body)
  )
  const target = new URL(args.url)
  return encoder.encode([
    DEVICE_PROOF_DOMAIN,
    args.siteId,
    args.ownerId,
    args.method,
    target.origin + target.pathname + target.search,
    args.nonce,
    bytesToUrlBase64(digest)
  ].join('\n'))
}

function validPublicKey(jwk: JsonWebKey): boolean {
  return jwk.kty === 'EC' && jwk.crv === 'P-256' &&
    typeof jwk.x === 'string' && typeof jwk.y === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(jwk.x) &&
    /^[A-Za-z0-9_-]{43}$/.test(jwk.y) &&
    jwk.d === undefined
}

async function verifyDeviceProof(
  request: Request,
  siteId: string,
  ownerId: string,
  nonce: string,
  jwk: JsonWebKey
): Promise<boolean> {
  if (!validPublicKey(jwk)) return false
  const signatureHeader = request.headers.get('x-pso-signature')
  if (!signatureHeader) return false
  const signature = signatureBytes(signatureHeader)
  if (!signature) return false
  const body = await readBoundedBody(request.clone())
  const message = await createDeviceProofMessage({
    siteId, ownerId, method: request.method,
    url: request.url, nonce, body
  })
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    signature, message
  )
}

/**
 * The authenticator is created inside a Netlify Function from its trusted
 * invocation context; the Request can NEVER supply subject or permission.
 *
 * All authenticated devices can read their own account, but POST publishing
 * requires a registered phone key and a one-use, unexpired challenge.
 */
export function createPrivateProjectAuthenticator(
  context: TrustedPrivateProjectContext,
  options: PrivateProjectProofOptions
): (request: Request) => Promise<VerifiedSyncSession | null> {
  return async (request: Request) => {
    const subject = trustedSubject(context, options)
    if (!subject) return null
    const readOnly: VerifiedSyncSession = {
      subject, deviceId: null, permission: 'read'
    }
    if (request.method !== 'POST' ||
      new URL(request.url).pathname !== '/api/sync/snapshots' ||
      !isTrustedOrigin(request, options.expectedOrigin)) {
      return readOnly
    }

    const deviceId = request.headers.get('x-pso-device-id')
    const nonce = request.headers.get('x-pso-challenge')
    if (!isUuid(deviceId) || !isUuid(nonce)) return readOnly

    try {
      const registered = await options.store.getRegisteredPublisher(
        subject, deviceId
      )
      if (!registered || registered.revoked ||
        registered.deviceId !== deviceId) return readOnly

      const valid = await verifyDeviceProof(
        request, options.expectedSiteId, context.user!.id!, nonce,
        registered.publicKeyJwk
      )
      if (!valid) return readOnly

      // Production challenge store must compare-and-consume atomically.
      const consumed = await options.store.consumeChallenge(
        subject, deviceId, nonce
      )
      if (!consumed) return readOnly

      return { subject, deviceId, permission: 'publish' }
    } catch {
      // Invalid keys, verification failure and storage outage fail closed.
      return readOnly
    }
  }
}

/**
 * Challenge issuance is a separate protected contract; this is NOT an
 * externally routed Netlify Function. Enrollment must be owner-approved
 * out-of-band (never automatic upon issuance).
 */
export function createPrivateChallengeHandler(
  context: TrustedPrivateProjectContext,
  options: PrivateProjectProofOptions
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (!validOptions(options)) return json({ error: 'pairing-disabled' }, 503)
    const subject = trustedSubject(context, options)
    if (!subject) return json({ error: 'unauthenticated' }, 401)
    if (request.method !== 'POST' ||
      new URL(request.url).pathname !== '/api/sync/device-challenge') {
      return json({ error: 'not-found' }, 404)
    }
    if (!isTrustedOrigin(request, options.expectedOrigin)) {
      return json({ error: 'origin-not-allowed' }, 403)
    }
    let body: unknown
    try {
      if (Number(request.headers.get('content-length') ?? 0) > 1024) {
        throw new Error('too-large')
      }
      const raw = await request.text()
      if (raw.length > 1024) throw new Error('too-large')
      body = JSON.parse(raw)
    } catch {
      return json({ error: 'invalid-challenge-request' }, 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).join('|') !== 'deviceId' ||
      !isUuid((body as { deviceId?: unknown }).deviceId)) {
      return json({ error: 'invalid-challenge-request' }, 400)
    }
    const deviceId = (body as { deviceId: string }).deviceId
    try {
      const device = await options.store.getRegisteredPublisher(
        subject, deviceId
      )
      if (!device || device.revoked || device.deviceId !== deviceId) {
        return json({ error: 'device-not-authorized' }, 403)
      }
      const created = await options.store.issueChallenge(
        subject, deviceId, MAX_CHALLENGE_SECONDS
      )
      if (!created || !isUuid(created.nonce)) {
        return json({ error: 'challenge-unavailable' }, 429)
      }
      return json({ nonce: created.nonce, siteId: options.expectedSiteId, ownerId: context.user!.id, expiresInSeconds: MAX_CHALLENGE_SECONDS })
    } catch {
      return json({ error: 'challenge-unavailable' }, 503)
    }
  }
}
