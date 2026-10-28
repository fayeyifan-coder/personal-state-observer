/**
 * S1: full SERVER-CONTRACT regression, without deploying any route or using
 * a user-controlled database. Every identity, key, and payload is synthetic.
 *
 * Never point this test at Netlify Database or a real record store.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createBackup } from '../src/services/backup'
import { createEncryptedSyncSnapshot } from '../src/services/syncProtocol'
import { createPendingPairingWorkflow, pairingProofMessage } from '../src/server/manualPairingProtocol'
import { createPostgresManualPairingStore } from '../src/server/postgresManualPairingStore'
import { createPostgresPublisherProofStore } from '../src/server/postgresPublisherProofStore'
import { createPostgresSyncRepository } from '../src/server/postgresSyncRepository'
import { createGuardedSyncHandler } from '../src/server/guardedSyncService'
import {
  createPrivateChallengeHandler, createPrivateProjectAuthenticator,
  createDeviceProofMessage
} from '../src/server/privateProjectDeviceAuth'
import { createPinnedVerifiedPairingEvidenceIssuer } from '../src/server/issuerKeyReadiness'
import {
  createSignedOperatorPairingGate, operatorCommandBytes,
  type OperatorCommand
} from '../src/server/signedOperatorPairingGate'
import {
  makeEvidenceIssuerTrust, verifySignedPairingEvidence,
  requestFromVerifiedEvidence
} from '../tools/trusted-pairing-evidence.mjs'

if (process.env.PGHOST !== '127.0.0.1' ||
    process.env.PGDATABASE !== 'sync_fixture_test' ||
    process.env.PGPORT !== '5432') {
  throw Error('REFUSE: S1 integration test requires local disposable PostgreSQL')
}
const pool = new pg.Pool({
  host: '127.0.0.1', port: 5432, database: 'sync_fixture_test',
  user: process.env.PGUSER || 'test_user',
  password: process.env.PGPASSWORD || 'test_password',
  max: 10
})
const origin = 'https://synthetic-pso-private.netlify.app'
const siteId = 'e480913d-4dd1-4467-b94b-a253725b1411'
const ownerId = '3c8109b0-6abc-4d46-bc13-1a1459f99d8d'
const otherOwnerId = '81096f53-c650-4fab-a069-2d3dce42d6c8'
const subject = 'netlify:' + siteId + ':' + ownerId
const nowPlus = () => new Date(Date.now() + 300_000)
const context = {
  site: { id: siteId },
  user: { id: ownerId, expiresAt: nowPlus() }
}
const otherContext = {
  site: { id: siteId },
  user: { id: otherOwnerId, expiresAt: nowPlus() }
}
const toBase64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url')
const phone = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const phoneJwk = await crypto.subtle.exportKey('jwk', phone.publicKey)
const otherPhone = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const deviceId = crypto.randomUUID()
const operator = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const issuerKey = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const operatorPublicKey = await crypto.subtle.exportKey('jwk', operator.publicKey)
const trust = makeEvidenceIssuerTrust(
  siteId, await crypto.subtle.exportKey('jwk', issuerKey.publicKey)
)
const pairingStore = createPostgresManualPairingStore(pool)
const publisherStore = createPostgresPublisherProofStore(pool)
const snapshots = createPostgresSyncRepository(pool)
const pairing = createPendingPairingWorkflow(context, {
  expectedSiteId: siteId, enabled: true, store: pairingStore
})
// Only a synthetic CI fixture: this local pin is derived from the temporary
// test key. Real hosting MUST establish its pin through another trusted channel.
const issuer = await createPinnedVerifiedPairingEvidenceIssuer(pool, {
  siteId, signingKey: issuerKey.privateKey,
  publicKeyJwk: trust.publicJwk,
  independentlyPinnedFingerprint: trust.fingerprint
}, { enabled: true })
const gate = createSignedOperatorPairingGate(pool, {
  enabled: true, expectedSiteId: siteId, operatorPublicKey
})
const authOptions = {
  enabled: true, expectedSiteId: siteId, expectedOrigin: origin,
  store: publisherStore
}
const challenge = createPrivateChallengeHandler(context, authOptions)
const handler = createGuardedSyncHandler({
  enabled: true, allowedOrigin: origin,
  authenticate: createPrivateProjectAuthenticator(context, authOptions),
  repository: snapshots
})
const otherHandler = createGuardedSyncHandler({
  enabled: true, allowedOrigin: origin,
  authenticate: createPrivateProjectAuthenticator(otherContext, authOptions),
  repository: snapshots
})
const request = (
  method: 'GET' | 'POST', path: string, body?: string,
  headers: Record<string, string> = {}
): Request => new Request(origin + path, {
  method, headers: { Origin: origin, ...headers },
  ...(body === undefined ? {} : { body })
})
const read = (path: string) => request('GET', path)
const commandFor = (receipt: NonNullable<Awaited<ReturnType<typeof issuer.issue>>>):
  OperatorCommand => {
  assert.equal(verifySignedPairingEvidence(receipt, trust), true)
  const evidence = requestFromVerifiedEvidence(receipt, trust)
  return {
    ...evidence,
    nonce: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString()
  }
}
const signedOperator = async (cmd: OperatorCommand) => toBase64(
  await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    operator.privateKey, operatorCommandBytes(cmd)
  )
)
async function issueChallenge(): Promise<string> {
  const response = await challenge(request(
    'POST', '/api/sync/device-challenge',
    JSON.stringify({ deviceId }),
    { 'Content-Type': 'application/json' }
  ))
  assert.equal(response.status, 200)
  const json = await response.json()
  assert.equal(json.expiresInSeconds, 90)
  return String(json.nonce)
}
async function publishRequest(body: string, nonce: string,
  privateKey = phone.privateKey): Promise<Request> {
  const bytes = new TextEncoder().encode(body)
  const proof = await createDeviceProofMessage({
    siteId, ownerId, method: 'POST',
    url: origin + '/api/sync/snapshots', nonce, body: bytes
  })
  const signature = toBase64(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, proof
  ))
  return request('POST', '/api/sync/snapshots', body, {
    'Content-Type': 'application/json',
    'X-PSO-Device-Id': deviceId,
    'X-PSO-Challenge': nonce,
    'X-PSO-Signature': signature
  })
}
const backup = createBackup([], [], [])
const phrase = 'synthetic-e2e-non-production-passphrase'
const toBody = async (parent: string | null) => JSON.stringify({
  expectedHead: parent,
  snapshot: await createEncryptedSyncSnapshot(backup, phrase, parent)
})

try {
  for (const name of [
    '20261028151000_sync_schema.sql',
    '20261028163500_device_proof_schema.sql',
    '20261028191000_pending_pairing.sql',
    '20261028203000_operator_signed_actions.sql'
  ]) {
    await pool.query(readFileSync('docs/sql-drafts/' + name, 'utf8'))
  }

  // Netlify identity alone lets a desktop READ, but not grant publish rights.
  assert.equal((await handler(read('/api/sync/head'))).status, 200)
  assert.equal((await otherHandler(read('/api/sync/head'))).status, 200)
  const before = await handler(request(
    'POST', '/api/sync/snapshots', await toBody(null),
    { 'Content-Type': 'application/json' }
  ))
  assert.equal(before.status, 403)
  assert.equal((await challenge(request(
    'POST', '/api/sync/device-challenge',
    JSON.stringify({ deviceId }), { 'Content-Type': 'application/json' }
  ))).status, 403)
  assert.equal((await snapshots.readHead(subject)).snapshotId, null)

  const pending = await pairing.request(deviceId, phoneJwk)
  assert.ok(pending)
  assert.equal(await issuer.issue(context, 'approve-publisher', pending!.requestId), null,
    'unproved phone must not receive a server-signed receipt')
  assert.equal(await publisherStore.getRegisteredPublisher(subject, deviceId), null)
  const proofBytes = pairingProofMessage({
    siteId, ownerId, requestId: pending!.requestId,
    nonce: pending!.nonce, deviceId, fingerprint: pending!.fingerprint
  })
  const proofSig = toBase64(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, phone.privateKey, proofBytes
  ))
  assert.equal(await pairing.prove(pending!.requestId, proofSig), true)
  assert.equal(await publisherStore.getRegisteredPublisher(subject, deviceId), null,
    'phone possession proof alone cannot authorize an upload')

  const receipt = await issuer.issue(context, 'approve-publisher', pending!.requestId)
  assert.ok(receipt)
  const approve = commandFor(receipt!)
  const approvalSig = await signedOperator(approve)
  assert.equal(await gate.apply({ ...approve, fingerprint: 'f'.repeat(64) },
    approvalSig), 'rejected', 'operator approval must bind exact phone fingerprint')
  assert.equal(await gate.apply(approve, approvalSig), 'approved')
  assert.equal(await gate.apply(approve, approvalSig), 'replayed')
  assert.equal((await publisherStore.getRegisteredPublisher(subject, deviceId))?.revoked,
    false)

  // Read-only desktop still cannot become the publisher using the same login.
  assert.equal((await handler(request(
    'POST', '/api/sync/snapshots', await toBody(null),
    { 'Content-Type': 'application/json' }
  ))).status, 403)
  const firstBody = await toBody(null)
  const firstNonce = await issueChallenge()
  assert.equal((await handler(await publishRequest(
    firstBody, firstNonce, otherPhone.privateKey
  ))).status, 403, 'unregistered key cannot publish')
  assert.equal((await handler(await publishRequest(firstBody, firstNonce))).status, 201,
    'legitimate phone can reuse a challenge after failed forged proof')
  assert.equal((await handler(await publishRequest(firstBody, firstNonce))).status, 403,
    'single-use publishing nonce blocks replay')

  const first = JSON.parse(firstBody).snapshot
  const head = await (await handler(read('/api/sync/head'))).json()
  assert.deepEqual(head, { snapshotId: first.snapshotId, revision: 1 })
  assert.deepEqual(await (await handler(read(
    '/api/sync/snapshots/' + first.snapshotId
  ))).json(), first)
  const dbSnapshot = await snapshots.readSnapshot(subject, first.snapshotId)
  assert.deepEqual(dbSnapshot, first)
  assert.equal(JSON.stringify(dbSnapshot).includes(phrase), false,
    'PostgreSQL must never store the encryption passphrase')
  assert.equal((await otherHandler(read(
    '/api/sync/snapshots/' + first.snapshotId
  ))).status, 404, 'cross-account encrypted snapshots are not readable')
  assert.deepEqual(await (await otherHandler(read('/api/sync/head'))).json(),
    { snapshotId: null, revision: 0 })

  // Exact repeated body with separate valid proof is idempotent.
  const retryNonce = await issueChallenge()
  assert.equal((await handler(await publishRequest(firstBody, retryNonce))).status, 200)
  const retryHead = await (await handler(read('/api/sync/head'))).json()
  assert.deepEqual(retryHead, head)

  const left = await toBody(first.snapshotId)
  const right = await toBody(first.snapshotId)
  const [nonceLeft, nonceRight] = await Promise.all([
    issueChallenge(), issueChallenge()
  ])
  const [a, b] = await Promise.all([
    handler(await publishRequest(left, nonceLeft)),
    handler(await publishRequest(right, nonceRight))
  ])
  assert.deepEqual([a.status, b.status].sort(), [201, 409],
    'only one concurrent compare-and-swap can advance the remote head')
  const current = await (await handler(read('/api/sync/head'))).json()
  assert.equal(current.revision, 2)
  assert.equal((await (await handler(read('/api/sync/history'))).json()).history.length,
    2)

  const revokedBeforeChallenge = await issueChallenge()
  const revokeEvidence = await issuer.issue(context, 'revoke-publisher', deviceId)
  assert.ok(revokeEvidence)
  const revoke = commandFor(revokeEvidence!)
  assert.equal(await gate.apply(revoke, await signedOperator(revoke)), 'revoked')
  assert.equal((await publisherStore.getRegisteredPublisher(subject, deviceId))?.revoked,
    true)
  assert.equal((await handler(await publishRequest(
    await toBody(current.snapshotId), revokedBeforeChallenge
  ))).status, 403, 'even pre-issued challenges die after revocation')
  assert.equal((await challenge(request(
    'POST', '/api/sync/device-challenge',
    JSON.stringify({ deviceId }), { 'Content-Type': 'application/json' }
  ))).status, 403, 'revoked device cannot get a new publish challenge')
  assert.equal((await handler(read('/api/sync/head'))).status, 200,
    'computer read-only access remains possible after revocation')
  assert.deepEqual(await (await handler(read('/api/sync/head'))).json(), current)
  console.log('[PASS] S1 synthetic PG E2E: proof, trusted receipt, operator approval, phone-only encrypted CAS, read-only desktop, isolation, replay, concurrency and revocation')
} finally {
  await pool.end()
}
