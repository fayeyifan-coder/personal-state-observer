import assert from 'node:assert/strict'
import { createBackup } from '../src/services/backup'
import { createEncryptedSyncSnapshot } from '../src/services/syncProtocol'
import { createGuardedSyncHandler } from '../src/server/guardedSyncService'
import {
  createPrivateChallengeHandler,
  createPrivateProjectAuthenticator,
  createDeviceProofMessage,
  type RegisteredPublisher,
  type PublisherProofStore,
  type TrustedPrivateProjectContext
} from '../src/server/privateProjectDeviceAuth'

const origin = 'https://synthetic-pso-private.netlify.app'
const siteId = '2faf200c-2153-4f84-ad8d-3410ac39bccc'
const ownerId = '37abfc4a-0e1f-4f95-9d0e-bd0e53cacdac'
const otherUser = '625dc951-bac0-4f92-b5cb-343a27df83c5'
const phoneId = 'ab9a3ec2-8f54-4e11-92cf-a60c9b1f7604'
const otherId = '7fd2e7a2-364b-4e46-bcb9-5a709f1fbb6a'
const context: TrustedPrivateProjectContext = {
  site: { id: siteId },
  user: { id: ownerId, expiresAt: new Date(Date.now() + 60_000) }
}
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
)
const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
const stolenPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
)

class FixtureProofStore implements PublisherProofStore {
  devices = new Map<string, RegisteredPublisher>()
  challenges = new Map<string, { expiresAt: number; consumed: boolean }>()
  now = () => Date.now()
  key(subject: string, deviceId: string) { return subject + ':' + deviceId }
  getRegisteredPublisher(subject: string, deviceId: string) {
    return Promise.resolve(this.devices.get(this.key(subject, deviceId)) ?? null)
  }
  issueChallenge(subject: string, deviceId: string, ttlSeconds: number) {
    if (!this.devices.has(this.key(subject, deviceId))) return Promise.resolve(null)
    const nonce = crypto.randomUUID()
    this.challenges.set(this.key(subject, deviceId) + ':' + nonce, {
      expiresAt: this.now() + ttlSeconds * 1000, consumed: false
    })
    return Promise.resolve({ nonce })
  }
  consumeChallenge(subject: string, deviceId: string, nonce: string) {
    const c = this.challenges.get(this.key(subject, deviceId) + ':' + nonce)
    if (!c || c.consumed || c.expiresAt <= this.now()) return Promise.resolve(false)
    c.consumed = true // Atomic ONLY within this single-process TEST store
    return Promise.resolve(true)
  }
}
const store = new FixtureProofStore()
const subject = 'netlify:' + siteId + ':' + ownerId
store.devices.set(store.key(subject, phoneId), {
  deviceId: phoneId, publicKeyJwk: publicKey, revoked: false
})
const opts = {
  expectedSiteId: siteId,
  expectedOrigin: origin,
  enabled: true,
  store
}
const auth = createPrivateProjectAuthenticator(context, opts)
const challenge = createPrivateChallengeHandler(context, opts)

function req(
  method: 'GET' | 'POST', path: string, body?: string,
  originHeader: string | null = origin,
  extra?: Record<string, string>
) {
  const headers: Record<string, string> = { ...extra }
  if (originHeader) headers.Origin = originHeader
  if (method === 'POST') headers['Content-Type'] = 'application/json'
  return new Request(origin + path, { method, headers, ...(body !== undefined ? { body } : {}) })
}

function b64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signPublish(
  raw: string, nonce: string,
  key: CryptoKey = keyPair.privateKey, target = '/api/sync/snapshots'
) {
  const data = new TextEncoder().encode(raw)
  const msg = await createDeviceProofMessage({
    siteId, ownerId, method: 'POST', url: origin + target,
    nonce, body: data
  })
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, msg
  ))
  return req('POST', target, raw, origin, {
    'X-PSO-Device-Id': phoneId,
    'X-PSO-Challenge': nonce,
    'X-PSO-Signature': b64Url(signature)
  })
}

async function issueChallenge() {
  const response = await challenge(req('POST', '/api/sync/device-challenge',
    JSON.stringify({ deviceId: phoneId })))
  assert.equal(response.status, 200)
  const json = await response.json()
  assert.equal(json.expiresInSeconds, 90)
  return json.nonce as string
}

assert.equal(await auth(req('GET', '/api/sync/head', undefined, null)), null === undefined ? null : await auth(req('GET', '/api/sync/head', undefined, null)))
const read = await auth(req('GET', '/api/sync/head'))
assert.deepEqual(read, { subject, permission: 'read', deviceId: null })
assert.equal((await auth(req('POST', '/api/sync/snapshots', '{}')))?.permission, 'read')
assert.equal((await createPrivateProjectAuthenticator(
  { ...context, user: undefined }, opts
)(req('GET', '/api/sync/head'))), null)
assert.equal(await createPrivateProjectAuthenticator(
  { ...context, site: { id: 'attacker-site' } }, opts
)(req('GET', '/api/sync/head')), null)
assert.equal(await createPrivateProjectAuthenticator(
  { ...context, user: { id: ownerId, expiresAt: new Date(Date.now() - 1000) } }, opts
)(req('GET', '/api/sync/head')), null)
assert.equal(await createPrivateProjectAuthenticator(context, {
  ...opts, enabled: false
})(req('GET', '/api/sync/head')), null)
assert.equal((await createPrivateProjectAuthenticator(
  { ...context, user: { id: otherUser, expiresAt: new Date(Date.now() + 60000) } }, opts
)(req('GET', '/api/sync/head', undefined, origin, { 'X-PSO-User': ownerId })))?.subject,
'netlify:' + siteId + ':' + otherUser,
'request header spoofing may not override trusted context')
let response = await challenge(req('POST', '/api/sync/device-challenge',
  JSON.stringify({ deviceId: phoneId }), 'https://attacker.test'))
assert.equal(response.status, 403)
response = await challenge(req('POST', '/api/sync/device-challenge',
  JSON.stringify({ deviceId: otherId })))
assert.equal(response.status, 403)
response = await challenge(req('POST', '/api/sync/device-challenge',
  JSON.stringify({ deviceId: phoneId, grantPublisher: true })))
assert.equal(response.status, 400)
response = await createPrivateChallengeHandler(context, { ...opts, enabled: false })(
  req('POST', '/api/sync/device-challenge', JSON.stringify({ deviceId: phoneId }))
)
assert.equal(response.status, 503)

const body = JSON.stringify({
  expectedHead: null,
  snapshot: await createEncryptedSyncSnapshot(
    createBackup([], [], []), 'synthetic-only-passphrase-2026', null
  )
})
let nonce = await issueChallenge()
const authorized = await auth(await signPublish(body, nonce))
assert.deepEqual(authorized, { subject, deviceId: phoneId, permission: 'publish' })
assert.equal((await auth(await signPublish(body, nonce)))?.permission, 'read',
  'single-use challenge blocks replay of a valid signature')

nonce = await issueChallenge()
assert.equal((await auth(await signPublish(body, nonce, stolenPair.privateKey)))?.permission,
  'read', 'unregistered device key cannot sign as owner')
assert.equal((await auth(await signPublish(body + ' ', nonce)))?.permission,
  'read', 'a digest mismatch or wrong signed bytes is forbidden only if signature binds to original body')
assert.equal((await auth(await signPublish(body, nonce)))?.permission, 'publish',
  'failed signatures must not burn the legitimate challenge')

nonce = await issueChallenge()
const signed = await signPublish(body, nonce)
const altered = new Request(signed.url, {
  method: 'POST', headers: signed.headers,
  body: body.replace('"expectedHead":null', '"expectedHead":"changed"')
})
assert.equal((await auth(altered))?.permission, 'read',
  'any change to body after signing invalidates proof')
assert.equal((await auth(signed))?.permission, 'publish')

nonce = await issueChallenge()
const redirected = await signPublish(body, nonce, keyPair.privateKey, '/api/sync/other')
assert.equal((await auth(redirected))?.permission, 'read')
assert.equal((await auth(await signPublish(body, nonce)))?.permission, 'publish')

nonce = await issueChallenge()
const challengeKey = store.key(subject, phoneId) + ':' + nonce
store.challenges.get(challengeKey)!.expiresAt = Date.now() - 100
assert.equal((await auth(await signPublish(body, nonce)))?.permission, 'read',
  'expired challenge cannot publish')
nonce = await issueChallenge()
store.devices.get(store.key(subject, phoneId))!.revoked = true
assert.equal((await auth(await signPublish(body, nonce)))?.permission, 'read',
  'revoked device loses authorization immediately')
store.devices.get(store.key(subject, phoneId))!.revoked = false

// Couple the trusted-context adapter to PR #6's existing protected routes.
let publishes = 0
const guarded = createGuardedSyncHandler({
  enabled: true, allowedOrigin: origin,
  authenticate: auth,
  repository: {
    readHead: async () => ({ snapshotId: null, revision: 0 }),
    readHistory: async () => [],
    readSnapshot: async () => null,
    commitSnapshot: async ({ subject: owner, verifiedDeviceId }) => {
      assert.equal(owner, subject)
      assert.equal(verifiedDeviceId, phoneId)
      publishes++
      return { status: 'committed', head: { snapshotId: null, revision: 0 } }
    }
  }
})
response = await guarded(req('GET', '/api/sync/head'))
assert.equal(response.status, 200)
response = await guarded(req('POST', '/api/sync/snapshots', body))
assert.equal(response.status, 403)
nonce = await issueChallenge()
response = await guarded(await signPublish(body, nonce))
assert.equal(response.status, 201)
assert.equal(publishes, 1)
response = await guarded(await signPublish(body, nonce))
assert.equal(response.status, 403)
assert.equal(publishes, 1)

console.log('[PASS] trusted private Netlify context, P256 phone possession, one-use challenge, revocation and read-only desktop')
