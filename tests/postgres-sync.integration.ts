// Runs only against an ephemeral GitHub Actions PostgreSQL service.
// NEVER point this at the user's Netlify database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createBackup } from '../src/services/backup'
import { createEncryptedSyncSnapshot } from '../src/services/syncProtocol'
import { createPostgresSyncRepository } from '../src/server/postgresSyncRepository'

const host = process.env.PGHOST
const db = process.env.PGDATABASE
if (host !== '127.0.0.1' || db !== 'sync_fixture_test') {
  throw new Error('REFUSING TO CONNECT: integration test must use isolated local fixture database')
}
const pool = new pg.Pool({
  host, port: 5432, database: db,
  user: process.env.PGUSER || 'test_user',
  password: process.env.PGPASSWORD || 'test_password',
  max: 6
})
const repo = createPostgresSyncRepository(pool)
const phrase = 'offline-fixture-password-2026'
const empty = createBackup([], [], [])
const subjectA = 'synthetic-subject-A'
const subjectB = 'synthetic-subject-B'
const phoneA = 'synthetic-verified-phone-A'
const phoneB = 'synthetic-verified-phone-B'
try {
  const schema = readFileSync(
    'docs/sql-drafts/20261028151000_sync_schema.sql', 'utf8'
  )
  await pool.query(schema)
  await pool.query(
    'INSERT INTO sync_publisher_devices(subject, device_id) VALUES ($1,$2),($3,$4)',
    [subjectA, phoneA, subjectB, phoneB]
  )

  assert.deepEqual(await repo.readHead(subjectA), { snapshotId: null, revision: 0 })
  const first = await createEncryptedSyncSnapshot(empty, phrase, null)
  assert.deepEqual(await repo.commitSnapshot({
    subject: subjectA, verifiedDeviceId: phoneA,
    expectedHead: null, snapshot: first
  }), {
    status: 'committed',
    head: { snapshotId: first.snapshotId, revision: 1 }
  })
  const stored = await repo.readSnapshot(subjectA, first.snapshotId)
  assert.deepEqual(stored, first)
  assert.equal(JSON.stringify(stored).includes(phrase), false)
  assert.equal(await repo.readSnapshot(subjectB, first.snapshotId), null)
  assert.deepEqual(await repo.readHead(subjectB), { snapshotId: null, revision: 0 })

  let retry = await repo.commitSnapshot({
    subject: subjectA, verifiedDeviceId: phoneA, expectedHead: null, snapshot: first
  })
  assert.equal(retry.status, 'already-committed')
  assert.equal(retry.head?.revision, 1)

  const rejected = await repo.commitSnapshot({
    subject: subjectA, verifiedDeviceId: 'synthetic-unregistered-desktop',
    expectedHead: first.snapshotId,
    snapshot: await createEncryptedSyncSnapshot(empty, phrase, first.snapshotId)
  })
  assert.equal(rejected.status, 'forbidden')

  const left = await createEncryptedSyncSnapshot(empty, phrase, first.snapshotId)
  const right = await createEncryptedSyncSnapshot(empty, phrase, first.snapshotId)
  // Concurrent commits are issued on distinct PG clients/connections.
  const results = await Promise.all([left, right].map(snapshot =>
    repo.commitSnapshot({
      subject: subjectA, verifiedDeviceId: phoneA,
      expectedHead: first.snapshotId, snapshot
    })))
  assert.deepEqual(results.map(r => r.status).sort(), ['committed', 'stale'])
  const current = await repo.readHead(subjectA)
  assert.equal(current.revision, 2)
  assert.ok(current.snapshotId === left.snapshotId || current.snapshotId === right.snapshotId)
  assert.equal((await repo.readHistory(subjectA)).length, 2)

  // An old request's exact retry remains idempotent even after head advanced.
  retry = await repo.commitSnapshot({
    subject: subjectA, verifiedDeviceId: phoneA, expectedHead: null, snapshot: first
  })
  assert.equal(retry.status, 'already-committed')
  assert.equal(retry.head?.revision, 2)

  const forged = { ...first, encrypted: { ...first.encrypted, iv: 'AAAAAAAAAAAAAAAA' } }
  assert.equal((await repo.commitSnapshot({
    subject: subjectA, verifiedDeviceId: phoneA,
    expectedHead: null, snapshot: forged
  })).status, 'stale')

  // Revocation takes effect; the old device cannot publish again.
  await pool.query(
    'UPDATE sync_publisher_devices SET revoked_at = now() WHERE subject=$1 AND device_id=$2',
    [subjectA, phoneA]
  )
  assert.equal((await repo.commitSnapshot({
    subject: subjectA, verifiedDeviceId: phoneA,
    expectedHead: current.snapshotId,
    snapshot: await createEncryptedSyncSnapshot(empty, phrase, current.snapshotId)
  })).status, 'forbidden')

  const secondTenant = await createEncryptedSyncSnapshot(empty, phrase, null)
  assert.equal((await repo.commitSnapshot({
    subject: subjectB, verifiedDeviceId: phoneB, expectedHead: null,
    snapshot: secondTenant
  })).status, 'committed')
  assert.deepEqual(await repo.readSnapshot(subjectB, secondTenant.snapshotId), secondTenant)
  assert.equal(await repo.readSnapshot(subjectA, secondTenant.snapshotId), null)

  const rows = await pool.query(
    'SELECT count(*)::int AS total FROM sync_snapshots WHERE subject = $1', [subjectA]
  )
  assert.equal(rows.rows[0].total, 2)
  console.log('[PASS] real Postgres transaction CAS, repeat, isolation, revocation and immutable encrypted payloads')
} finally {
  await pool.end()
}
