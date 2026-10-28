import assert from 'node:assert/strict'
import {
  createPendingPairingWorkflow, pairingFingerprint, pairingProofMessage,
  type PendingPairing, type ManualPairingStore, type ApprovalOutcome
} from '../src/server/manualPairingProtocol'

const siteId = 'd30fd8ac-cb06-4aa8-8d53-4390b421ff70'
const ownerId = '743d8645-50e6-4fab-b4c0-c811d0c9f3fd'
const anotherOwner = '137a179e-3e57-481f-a743-497effa8dfa7'
const subject = 'netlify:' + siteId + ':' + ownerId
const phoneId = crypto.randomUUID()
const wrongPhone = crypto.randomUUID()
const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const stolen = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
const fingerprint = await pairingFingerprint(jwk)

class FixtureStore implements ManualPairingStore {
  pending = new Map<string, PendingPairing>()
  active = new Map<string, string>()
  async begin(s: string, deviceId: string, publicKeyJwk: JsonWebKey,
    fp: string, ttlSeconds: number) {
    assert.equal(ttlSeconds, 300)
    if (this.active.has(s) ||
        [...this.pending.values()].some(x =>
          x.subject === s && !x.provedAt &&
          x.expiresAt.getTime() > Date.now())) return null
    const requestId = crypto.randomUUID(), nonce = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    this.pending.set(s + ':' + requestId, {
      requestId, nonce, expiresAt, subject: s, deviceId,
      publicKeyJwk, fingerprint: fp, provedAt: null
    })
    return { requestId, nonce, expiresAt }
  }
  async read(s: string, id: string) {
    return this.pending.get(s + ':' + id) ?? null
  }
  async markProven(s: string, id: string) {
    const row = this.pending.get(s + ':' + id)
    if (!row || row.provedAt || row.expiresAt.getTime() <= Date.now()) return false
    row.provedAt = new Date()
    return true
  }
  async approveByOperator(s: string, id: string, fp: string): Promise<ApprovalOutcome> {
    const row = this.pending.get(s + ':' + id)
    if (!row || row.fingerprint !== fp || row.expiresAt.getTime() <= Date.now()) {
      return 'invalid-or-expired'
    }
    if (!row.provedAt) return 'not-proven'
    if (this.active.has(s)) return 'already-paired'
    this.active.set(s, row.deviceId)
    return 'approved'
  }
  async revokeByOperator(s: string, deviceId: string) {
    if (this.active.get(s) !== deviceId) return false
    this.active.delete(s)
    return true
  }
}
const store = new FixtureStore()
const ctx = { site: { id: siteId },
  user: { id: ownerId, expiresAt: new Date(Date.now() + 60_000) } }
const options = { expectedSiteId: siteId, enabled: true, store }
const wf = createPendingPairingWorkflow(ctx, options)

assert.equal(await createPendingPairingWorkflow(
  { site: ctx.site }, options
).request(phoneId, jwk), null, 'anonymous must not enroll')
assert.equal(await createPendingPairingWorkflow(
  { ...ctx, site: { id: crypto.randomUUID() } }, options
).request(phoneId, jwk), null, 'wrong Netlify site denied')
assert.equal(await createPendingPairingWorkflow(
  { ...ctx, user: { id: ownerId, expiresAt: new Date(0) } }, options
).request(phoneId, jwk), null, 'expired session denied')
assert.equal(await createPendingPairingWorkflow(ctx, {
  ...options, enabled: false
}).request(phoneId, jwk), null, 'default-disabled enrollment denied')
assert.equal(await wf.request(phoneId, { ...jwk, d: 'secret' }), null,
  'private key in proposed JWK rejected')
assert.equal(await wf.request(phoneId, { ...jwk, x: 'not-an-ec-point' }), null)

const pending = await wf.request(phoneId, jwk)
assert.ok(pending)
assert.equal(pending!.fingerprint, fingerprint)
assert.equal(store.active.size, 0, 'login and candidate request never enrolls')
assert.equal(await store.approveByOperator(subject, pending!.requestId, fingerprint), 'not-proven')
assert.equal(await wf.request(wrongPhone, jwk), null, 'existing pending blocks takeover')
const signatureFor = async (privateKey: CryptoKey, req = pending!) => {
  const message = pairingProofMessage({
    siteId: req.siteId, ownerId: req.ownerId, requestId: req.requestId,
    nonce: req.nonce, deviceId: phoneId, fingerprint: req.fingerprint
  })
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, message
  ))
  return btoa(Array.from(signature, b => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
assert.equal(await wf.prove(pending!.requestId, await signatureFor(stolen.privateKey)), false)
assert.equal(await wf.prove(crypto.randomUUID(), await signatureFor(pair.privateKey)), false)
assert.equal(await createPendingPairingWorkflow({
  site: ctx.site,
  user: { id: anotherOwner, expiresAt: new Date(Date.now() + 60_000) }
}, options).prove(pending!.requestId, await signatureFor(pair.privateKey)), false)
assert.equal(await wf.prove(pending!.requestId, 'bad-signature'), false)
assert.equal(store.active.size, 0, 'wrong signatures cannot promote a candidate')

assert.equal(await wf.prove(pending!.requestId, await signatureFor(pair.privateKey)), true)
assert.equal(await wf.prove(pending!.requestId, await signatureFor(pair.privateKey)), false,
  'duplicate proof rejected')
assert.equal(store.active.size, 0, 'valid proof still has NO publish rights')
assert.equal(await store.approveByOperator(subject, pending!.requestId, '0'.repeat(64)),
  'invalid-or-expired', 'operator must compare exact fingerprint')
assert.equal(store.active.size, 0)
assert.equal(await store.approveByOperator(subject, pending!.requestId, fingerprint), 'approved',
  'only separated operator path may grant publish rights')
assert.equal(store.active.get(subject), phoneId)
assert.equal(await wf.request(wrongPhone, jwk), null,
  'no second publisher when one is active')
assert.equal(await store.revokeByOperator(subject, wrongPhone), false)
assert.equal(await store.revokeByOperator(subject, phoneId), true)
assert.equal(store.active.size, 0)
console.log('[PASS] offline pairing: trusted account, proof possession, no auto-enroll, out-of-band approval and revocation')
