import { isUuid } from '../services/syncEnvelope'
import type { PostgresPool } from './postgresSyncRepository'
import {
  createVerifiedPairingEvidenceIssuer
} from './verifiedPairingEvidenceIssuer'

/**
 * SERVER-ONLY, in-memory startup preflight, NOT a key vault.
 * A deployment must obtain an existing signer from an independently reviewed
 * custody mechanism. NEVER silently generate/re-enroll a key on cold start.
 * This does not establish a trustworthy first pin; the verifier must already
 * have an out-of-band verified SHA-256 public-key fingerprint.
 */
export type ExternalIssuerKeyBinding = {
  siteId: string
  independentlyPinnedFingerprint: string
  publicKeyJwk: JsonWebKey
  signingKey: CryptoKey
}

const FP = /^[a-f0-9]{64}$/
const COORD = /^[A-Za-z0-9_-]{43}$/
const enc = new TextEncoder()

function publicFields(jwk: JsonWebKey): JsonWebKey {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' || !COORD.test(jwk.x) ||
    typeof jwk.y !== 'string' || !COORD.test(jwk.y) ||
    Object.prototype.hasOwnProperty.call(jwk, 'd')) {
    throw Error('issuer-public-key-invalid')
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
}

function assertNonExtractableSigner(key: CryptoKey): void {
  if (!key || key.type !== 'private' || key.extractable ||
    key.algorithm?.name !== 'ECDSA' ||
    (key.algorithm as EcKeyAlgorithm).namedCurve !== 'P-256' ||
    !key.usages.includes('sign')) {
    throw Error('issuer-private-key-unacceptable')
  }
}

/**
 * Prove that a supplied private signer matches an ALREADY independently pinned
 * public key. This proves signing continuity only, not custody quality,
 * independent provisioning, or runtime persistence across Netlify cold starts.
 * No DB connections, HTTP calls, file writes, or private-key exports.
 */
export async function verifyExternalIssuerKeyBinding(
  config: ExternalIssuerKeyBinding
): Promise<{ siteId: string; fingerprint: string }> {
  if (!config || !isUuid(config.siteId) ||
    typeof config.independentlyPinnedFingerprint !== 'string' ||
    !FP.test(config.independentlyPinnedFingerprint)) {
    throw Error('issuer-independent-pin-missing')
  }
  assertNonExtractableSigner(config.signingKey)
  const jwk = publicFields(config.publicKeyJwk)
  // Match tools/trusted-pairing-evidence.mjs canonical kty,crv,x,y order.
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256', enc.encode(JSON.stringify(jwk))
  ))
  const fingerprint = Array.from(digest, byte =>
    byte.toString(16).padStart(2, '0')).join('')
  if (fingerprint !== config.independentlyPinnedFingerprint) {
    throw Error('issuer-public-key-pin-mismatch')
  }
  let verifier: CryptoKey
  try {
    verifier = await crypto.subtle.importKey(
      'jwk', { ...jwk, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    )
  } catch {
    throw Error('issuer-public-key-invalid')
  }
  // Different random proof for each cold-start check, domain-separated.
  const challenge = enc.encode([
    'personal-state-observer:issuer-cold-start-proof:v1',
    config.siteId, fingerprint, crypto.randomUUID()
  ].join('\n'))
  let matches = false
  try {
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, config.signingKey, challenge
    )
    matches = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, verifier, signature, challenge
    )
  } catch {
    throw Error('issuer-signing-key-unavailable')
  }
  if (!matches) throw Error('issuer-private-public-key-mismatch')
  return { siteId: config.siteId, fingerprint }
}

/**
 * ONLY an integration candidate: fail startup BEFORE any database query when
 * a supplied signer differs from the externally pinned evidence issuer.
 * No HTTP endpoints; no automatic secret loading or key generation.
 * Future hosted entrypoints must call this factory, not the unchecked draft
 * factory, and require an independently established pin.
 */
export async function createPinnedVerifiedPairingEvidenceIssuer(
  pool: PostgresPool,
  binding: ExternalIssuerKeyBinding,
  options: { enabled: boolean; now?: () => number }
): Promise<ReturnType<typeof createVerifiedPairingEvidenceIssuer>> {
  if (!options?.enabled) throw Error('issuer-hosting-not-approved')
  await verifyExternalIssuerKeyBinding(binding)
  return createVerifiedPairingEvidenceIssuer(pool, {
    enabled: true,
    siteId: binding.siteId,
    signingKey: binding.signingKey,
    now: options.now
  })
}
