import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import {
  createPendingPairingWorkflow, pairingProofMessage
} from '../src/server/manualPairingProtocol'
import { createPostgresManualPairingStore } from '../src/server/postgresManualPairingStore'
import { createPostgresPublisherProofStore } from '../src/server/postgresPublisherProofStore'

if (process.env.PGHOST !== '127.0.0.1' ||
    process.env.PGDATABASE !== 'sync_fixture_test') {
  throw Error('Refusing to connect to any non-disposable PostgreSQL database')
}
const pool = new pg.Pool({
  host: '127.0.0.1', port: 5432, database: 'sync_fixture_test',
  user: process.env.PGUSER || 'test_user',
  password: process.env.PGPASSWORD || 'test_password',
  max: 8
})
const store = createPostgresManualPairingStore(pool)
const proof = createPostgresPublisherProofStore(pool)
const siteId = 'd4b4bdc8-faa2-42d6-a459-d1d1e5d1126b'
const ownerId = 'e5993652-792a-4e21-976f-98b1556224ea'
const subject = 'netlify:' + siteId + ':' + ownerId
const ctx = { site: { id: siteId },
  user: { id: ownerId, expiresAt: new Date(Date.now() + 300_000) } }
const workflow = createPendingPairingWorkflow(ctx, {
  expectedSiteId: siteId, enabled: true, store
})

async function makeKey() {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  )
  return { keys, publicJwk: await crypto.subtle.exportKey('jwk', keys.publicKey) }
}
async function sign(pending: NonNullable<Awaited<ReturnType<typeof workflow.request>>>,
  id: string, privateKey: CryptoKey) {
  const bytes = pairingProofMessage({
    siteId: pending.siteId, ownerId: pending.ownerId,
    requestId: pending.requestId, nonce: pending.nonce,
    deviceId: id, fingerprint: pending.fingerprint
  })
  const signed = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes
  ))
  return btoa(Array.from(signed, x => String.fromCharCode(x)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

try {
  // Fixture runner must use a new, isolated Postgres service.
  await pool.query(readFileSync('docs/sql-drafts/20261028151000_sync_schema.sql', 'utf8'))
  await pool.query(readFileSync('docs/sql-drafts/20261028163500_device_proof_schema.sql', 'utf8'))
  await pool.query(readFileSync('docs/sql-drafts/20261028191000_pending_pairing.sql', 'utf8'))

  const first = await makeKey()
  const phoneA = crypto.randomUUID(), phoneB = crypto.randomUUID()
  const pending = await workflow.request(phoneA, first.publicJwk)
  assert.ok(pending, 'authenticated user can request a pending registration')
  assert.equal(await proof.getRegisteredPublisher(subject, phoneA), null,
    'no auto-register on request')
  assert.equal(await workflow.request(phoneB, first.publicJwk), null,
    'other device cannot replace existing pending candidate')
  assert.equal(await store.approveByOperator(subject, pending!.requestId,
    pending!.fingerprint), 'not-proven')
  assert.equal(await workflow.prove(pending!.requestId,
    await sign(pending!, phoneA, first.keys.privateKey)), true)
  assert.equal(await workflow.prove(pending!.requestId,
    await sign(pending!, phoneA, first.keys.privateKey)), false,
    'proof is one-time')
  assert.equal(await proof.getRegisteredPublisher(subject, phoneA), null,
    'cryptographic proof still does not self-approve')
  assert.equal(await store.approveByOperator(subject, pending!.requestId,
    'f'.repeat(64)), 'invalid-or-expired', 'operator must compare fingerprint')
  assert.equal(await store.approveByOperator('netlify:' + siteId + ':other-owner',
    pending!.requestId, pending!.fingerprint), 'invalid-or-expired',
    'approval scoped to verified owner')
  const candidate = await store.read(subject, pending!.requestId)
  assert.equal(candidate?.provedAt instanceof Date, true)
  assert.equal(candidate?.fingerprint, pending!.fingerprint)

  const competing = await Promise.all([
    store.approveByOperator(subject, pending!.requestId, pending!.fingerprint),
    store.approveByOperator(subject, pending!.requestId, pending!.fingerprint)
  ])
  assert.deepEqual(competing.sort(), ['approved', 'invalid-or-expired'],
    'two concurrent approvals of same candidate cannot double-register')
  assert.equal((await proof.getRegisteredPublisher(subject, phoneA))?.revoked, false)
  assert.equal(await workflow.request(phoneB, first.publicJwk), null,
    'second phone cannot enroll while original active')
  assert.ok((await proof.issueChallenge(subject, phoneA, 90))?.nonce,
    'approved device can obtain challenge')

  assert.equal(await store.revokeByOperator(subject, phoneB), false,
    'wrong phone cannot revoke current publisher')
  assert.equal(await store.revokeByOperator(subject, phoneA), true,
    'operator can revoke approved device')
  assert.equal((await proof.getRegisteredPublisher(subject, phoneA))?.revoked, true)
  assert.equal(await proof.issueChallenge(subject, phoneA, 90), null,
    'revoked phone cannot receive new publishing challenge')
  assert.equal(await store.revokeByOperator(subject, phoneA), false,
    'duplicate revoke is safely declined')

  const other = await makeKey()
  const replacement = await workflow.request(phoneB, other.publicJwk)
  assert.ok(replacement, 'replacing phone requires fresh pairing after revocation')
  assert.equal(await workflow.prove(replacement!.requestId,
    await sign(replacement!, phoneB, first.keys.privateKey)), false,
    'old phone key cannot prove replacement')
  assert.equal(await workflow.prove(replacement!.requestId,
    await sign(replacement!, phoneB, other.keys.privateKey)), true)
  assert.equal(await store.approveByOperator(subject, replacement!.requestId,
    replacement!.fingerprint), 'approved')
  assert.equal((await proof.getRegisteredPublisher(subject, phoneB))?.revoked, false)
  assert.equal((await proof.getRegisteredPublisher(subject, phoneA))?.revoked, true)

  const results = await pool.query(
    'SELECT count(*)::int AS active FROM sync_publisher_devices ' +
    'WHERE subject=$1 AND revoked_at IS NULL', [subject]
  )
  assert.equal(results.rows[0].active, 1)
  console.log('[PASS] ephemeral Postgres: manual paired proof, concurrent operator approval, revocation and replacement')
} finally {
  await pool.end()
}
