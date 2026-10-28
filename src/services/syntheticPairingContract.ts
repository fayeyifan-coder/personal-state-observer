/**
 * Offline wire-contract rehearsal matching the pending pairing server protocol.
 * No Netlify client, fetch(), registration, token storage or database writes.
 *
 * The synthetic siteId and ownerId here are RANDOM FIXTURES; a successful
 * local proof is NEVER an authenticated real-device enrollment.
 */
import {
  readLocalTestPairingPublicKey,
  signLocalTestPairingChallenge
} from './syntheticDeviceKeyStore'

const DOMAIN = 'personal-state-observer:manual-pairing-proof:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FINGERPRINT = /^[0-9a-f]{64}$/
const encoder = new TextEncoder()

export type SyntheticPendingCandidate = {
  deviceId: string
  fingerprint: string
  publicJwk: JsonWebKey
  siteId: string
  ownerId: string
  requestId: string
  nonce: string
  expiresAt: string
}

function canonicalJwk(jwk: JsonWebKey): {
  kty: string; crv: string; x: string; y: string
} {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' || typeof jwk.y !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.y) || jwk.d !== undefined) {
    throw Error('虚构配对申请中的公钥格式不正确。')
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
}

export async function fingerprintForPairingJwk(jwk: JsonWebKey): Promise<string> {
  const fields = canonicalJwk(jwk)
  // Import also checks that the public EC point is valid.
  await crypto.subtle.importKey(
    'jwk', { ...fields, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  )
  const raw = await crypto.subtle.digest(
    'SHA-256', encoder.encode(JSON.stringify(fields))
  )
  return [...new Uint8Array(raw)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Byte-for-byte the same versioned domain-separated format as PR #14. */
export function pairingProofBytes(args: {
  siteId: string
  ownerId: string
  requestId: string
  nonce: string
  deviceId: string
  fingerprint: string
}): Uint8Array<ArrayBuffer> {
  if (!UUID.test(args.requestId) || !UUID.test(args.nonce) ||
    !UUID.test(args.deviceId) || !FINGERPRINT.test(args.fingerprint)) {
    throw Error('模拟配对证明的字段格式不正确。')
  }
  return encoder.encode([
    DOMAIN, args.siteId, args.ownerId, args.requestId, args.nonce,
    args.deviceId, args.fingerprint
  ].join('\n'))
}

/**
 * Locally create a server-shaped pending request; no browser identity is
 * attached and no actual HTTP request is sent.
 */
export async function startSyntheticPairing(): Promise<SyntheticPendingCandidate> {
  const { deviceId, publicJwk } = await readLocalTestPairingPublicKey()
  const fingerprint = await fingerprintForPairingJwk(publicJwk)
  return {
    deviceId,
    publicJwk,
    fingerprint,
    siteId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    nonce: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 300_000).toISOString()
  }
}

/** Sign with existing saved private key, verify with the public key locally. */
export async function proveSyntheticPairing(candidate: SyntheticPendingCandidate):
  Promise<{ passed: true; fingerprint: string }> {
  if (Date.parse(candidate.expiresAt) <= Date.now()) {
    throw Error('模拟挑战已超时，请重新生成模拟申请。')
  }
  const expectedFingerprint = await fingerprintForPairingJwk(candidate.publicJwk)
  if (expectedFingerprint !== candidate.fingerprint) {
    throw Error('模拟申请中的指纹被修改，已拒绝。')
  }
  const signature = await signLocalTestPairingChallenge(candidate)
  const key = await crypto.subtle.importKey(
    'jwk', { ...canonicalJwk(candidate.publicJwk), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['verify']
  )
  const message = pairingProofBytes(candidate)
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key, signature, message
  )
  if (!verified) throw Error('本机模拟服务器无法验证签名。')
  return { passed: true, fingerprint: expectedFingerprint }
}
