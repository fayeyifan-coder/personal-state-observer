import assert from 'node:assert/strict'
import { evidenceIssuerFingerprint } from '../tools/trusted-pairing-evidence.mjs'
import {
  createPinnedVerifiedPairingEvidenceIssuer,
  verifyExternalIssuerKeyBinding,
  type ExternalIssuerKeyBinding
} from '../src/server/issuerKeyReadiness'
import type { PostgresPool } from '../src/server/postgresSyncRepository'

const siteId = '822d29ac-1881-416c-90c8-84f985546fad'
const keys = async (extractable = false) => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign', 'verify']
  )
  return {
    privateKey: pair.privateKey,
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey)
  }
}
const trusted = await keys()
const binding: ExternalIssuerKeyBinding = {
  siteId, signingKey: trusted.privateKey,
  publicKeyJwk: trusted.publicJwk,
  independentlyPinnedFingerprint: evidenceIssuerFingerprint(trusted.publicJwk)
}

assert.deepEqual(await verifyExternalIssuerKeyBinding(binding), {
  siteId, fingerprint: binding.independentlyPinnedFingerprint
})
// The same previously supplied non-exportable signer may pass another check.
// This does NOT establish its persistence in a real hosted cold start.
assert.deepEqual(await verifyExternalIssuerKeyBinding(binding), {
  siteId, fingerprint: binding.independentlyPinnedFingerprint
})

const replacement = await keys()
await assert.rejects(
  verifyExternalIssuerKeyBinding({ ...binding, signingKey: replacement.privateKey }),
  /issuer-private-public-key-mismatch/,
  'a newly generated server private key cannot silently impersonate original issuer'
)
await assert.rejects(
  verifyExternalIssuerKeyBinding({
    ...binding, publicKeyJwk: replacement.publicJwk
  }),
  /issuer-public-key-pin-mismatch/
)
await assert.rejects(
  verifyExternalIssuerKeyBinding({
    ...binding, independentlyPinnedFingerprint: '0'.repeat(64)
  }),
  /issuer-public-key-pin-mismatch/
)
await assert.rejects(
  verifyExternalIssuerKeyBinding({
    ...binding, independentlyPinnedFingerprint: ''
  }),
  /issuer-independent-pin-missing/
)
await assert.rejects(
  verifyExternalIssuerKeyBinding({ ...binding, siteId: 'wrong-site' }),
  /issuer-independent-pin-missing/
)
await assert.rejects(
  verifyExternalIssuerKeyBinding({
    ...binding, publicKeyJwk: {
      ...binding.publicKeyJwk, d: 'nonpublic-key-field'
    }
  }),
  /issuer-public-key-invalid/
)
await assert.rejects(
  verifyExternalIssuerKeyBinding({
    ...binding, publicKeyJwk: { ...binding.publicKeyJwk, x: 'bogus' }
  }),
  /issuer-public-key-invalid/
)
const extractablePair = await keys(true)
await assert.rejects(
  verifyExternalIssuerKeyBinding({
    ...binding, signingKey: extractablePair.privateKey
  }),
  /issuer-private-key-unacceptable/
)
await assert.rejects(
  verifyExternalIssuerKeyBinding({
    ...binding, signingKey: undefined as unknown as CryptoKey
  }),
  /issuer-private-key-unacceptable/
)

let databaseConnections = 0
const fakePool: PostgresPool = {
  connect: async () => {
    databaseConnections++
    throw Error('unexpected-database-call')
  }
}
await assert.rejects(
  createPinnedVerifiedPairingEvidenceIssuer(fakePool, binding, {
    enabled: false
  }),
  /issuer-hosting-not-approved/
)
await assert.rejects(
  createPinnedVerifiedPairingEvidenceIssuer(fakePool, {
    ...binding, signingKey: replacement.privateKey
  }, { enabled: true }),
  /issuer-private-public-key-mismatch/
)
await assert.rejects(
  createPinnedVerifiedPairingEvidenceIssuer(fakePool, {
    ...binding, independentlyPinnedFingerprint: 'f'.repeat(64)
  }, { enabled: true }),
  /issuer-public-key-pin-mismatch/
)
assert.equal(databaseConnections, 0, 'failed startup must not touch PostgreSQL')
const verifiedIssuer = await createPinnedVerifiedPairingEvidenceIssuer(
  fakePool, binding, { enabled: true }
)
assert.equal(databaseConnections, 0, 'successful preflight does not cause DB I/O')
assert.equal(typeof verifiedIssuer.issue, 'function')
assert.equal(databaseConnections, 0)

// Distinguish platform secret storage from cryptographic binding.
// If BOTH public key and submitted pin are substituted by a single attacker,
// algebraic consistency alone does not establish a genuine trust root.
const syntheticUntrustedPin = {
  ...binding,
  signingKey: replacement.privateKey,
  publicKeyJwk: replacement.publicJwk,
  independentlyPinnedFingerprint: evidenceIssuerFingerprint(replacement.publicJwk)
}
assert.equal(
  (await verifyExternalIssuerKeyBinding(syntheticUntrustedPin)).siteId,
  siteId,
  'same-origin self-asserted pin is not sufficient for real production trust'
)
console.log('[PASS] isolated issuer readiness: cross-runtime fingerprint parity, key mismatch/rotation and extractability refused, no DB access on preflight')
