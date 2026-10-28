import assert from 'node:assert/strict'
import {
  fingerprintForPairingJwk, pairingProofBytes
} from '../src/services/syntheticPairingContract'

const fixture = {
  siteId: '0a39996e-f00d-471a-9bf9-51f2a8fa3e02',
  ownerId: 'fbb6440c-b7ac-4cd5-b8a2-98b22771e842',
  requestId: 'd74053f5-a494-47bf-906f-412496dfb4a7',
  nonce: '565be63a-15f0-469b-abde-563233225bbe',
  deviceId: 'cd31b0bf-5140-4818-a9d2-cfe55b1c41fa',
  fingerprint: 'ab'.repeat(32)
}
const decoded = new TextDecoder().decode(pairingProofBytes(fixture))
assert.equal(decoded, [
  'personal-state-observer:manual-pairing-proof:v1',
  fixture.siteId, fixture.ownerId, fixture.requestId,
  fixture.nonce, fixture.deviceId, fixture.fingerprint
].join('\n'), 'client must exactly match PR #14 server proof byte format')

assert.throws(() => pairingProofBytes({
  ...fixture, nonce: 'invalid'
}), /字段格式不正确/)
assert.throws(() => pairingProofBytes({
  ...fixture, fingerprint: 'ffff'
}), /字段格式不正确/)

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
const actual = await fingerprintForPairingJwk(jwk)
assert.match(actual, /^[0-9a-f]{64}$/)
const canonical = JSON.stringify({
  kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y
})
const sha = new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(canonical)
))
assert.equal(actual, Array.from(sha, b => b.toString(16).padStart(2, '0')).join(''))
await assert.rejects(
  fingerprintForPairingJwk({ ...jwk, d: 'not-allowed' }),
  /公钥格式不正确/
)

const signed = await crypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey,
  pairingProofBytes({ ...fixture, fingerprint: actual })
)
assert.equal(await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
  signed, pairingProofBytes({ ...fixture, fingerprint: actual })
), true)
assert.equal(await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
  signed, pairingProofBytes({ ...fixture, fingerprint: actual, nonce: crypto.randomUUID() })
), false, 'challenge is bound to exact nonce')
assert.equal(await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
  signed, pairingProofBytes({ ...fixture, fingerprint: actual, deviceId: crypto.randomUUID() })
), false, 'proof cannot be replayed for a different device')
console.log('[PASS] synthetic pairing wire contract, full fingerprint and domain-separated ECDSA proof')
