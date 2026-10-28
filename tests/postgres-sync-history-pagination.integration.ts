/** S6: real disposable PG cursor-history regression. NEVER target a live DB. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createPostgresSyncRepository } from '../src/server/postgresSyncRepository'
import {
  createGuardedSyncHandler, SYNC_HISTORY_PAGE_SIZE
} from '../src/server/guardedSyncService'

if (process.env.PGHOST !== '127.0.0.1' ||
  process.env.PGPORT !== '5432' ||
  process.env.PGDATABASE !== 'sync_fixture_test') {
  throw Error('REFUSING history test except against disposable localhost PostgreSQL')
}
const pool = new pg.Pool({
  host: '127.0.0.1', port: 5432, database: 'sync_fixture_test',
  user: process.env.PGUSER || 'test_user',
  password: process.env.PGPASSWORD || 'test_password',
  max: 4
})
const site = 'https://history-pg-synthetic.example.test'
const tenantA = 'offline-synthetic-history-A'
const tenantB = 'offline-synthetic-history-B'
const repo = createPostgresSyncRepository(pool)

async function insertHistory(subject: string, count: number) {
  // No sensitive payload; just a synthetic JSON envelope placeholder.
  const input = Array.from({ length: count }, (_, i) => [
    subject, crypto.randomUUID(), i + 1, JSON.stringify({ synthetic: true })
  ])
  const values = input.flat()
  const sql = 'INSERT INTO sync_snapshots ' +
    '(subject, snapshot_id, revision, envelope) VALUES ' +
    input.map((_, i) => '(' +
      Array.from({ length: 4 }, (_, j) => '$' + (i*4+j+1)).join(',') +
      '::jsonb)'.replace(',$' + (i*4+4) + '::jsonb',
        ',$' + (i*4+4) + '::jsonb') +
      ')').join(',')
  // Placeholders for the last (envelope) column always carry the ::jsonb cast.
  await pool.query(sql, values)
}

try {
  await pool.query(readFileSync(
    'docs/sql-drafts/20261028151000_sync_schema.sql', 'utf8'
  ))
  await insertHistory(tenantA, 205)
  await insertHistory(tenantB, 3)

  const rows = await repo.readHistory(tenantA, { limit: 101 })
  assert.equal(rows.length, 101, 'one additional record proves there is more')
  assert.equal(rows[0].revision, 205)
  assert.equal(rows[100].revision, 105)
  const direct = await repo.readHistory(tenantA, {
    beforeRevision: 106, limit: 101
  })
  assert.equal(direct[0].revision, 105)
  assert.equal(direct[100].revision, 5)
  assert.equal((await repo.readHistory(tenantB, { limit: 101 })).length, 3)
  await assert.rejects(repo.readHistory(tenantA, {
    beforeRevision: -1, limit: 101
  }), /invalid-history-cursor/)
  await assert.rejects(repo.readHistory(tenantA, { limit: 102 }),
    /invalid-history-limit/)

  const handler = createGuardedSyncHandler({
    enabled: true, allowedOrigin: site,
    authenticate: async request => ({
      subject: request.headers.get('x-fixture-owner') === 'B' ? tenantB : tenantA,
      deviceId: null, permission: 'read'
    }),
    repository: repo
  })
  const read = async (url: string, owner: 'A' | 'B' = 'A') => {
    const response = await handler(new Request(site + url, {
      headers: { 'x-fixture-owner': owner }
    }))
    assert.equal(response.status, 200)
    return response.json()
  }

  let cursor: number | null = null
  let pages = 0
  const found: number[] = []
  do {
    const path = '/api/sync/history' +
      (cursor === null ? '' : '?before=' + cursor)
    const page = await read(path)
    assert.ok(page.history.length <= SYNC_HISTORY_PAGE_SIZE)
    found.push(...page.history.map((row: {revision:number}) => row.revision))
    pages++
    if (page.hasMore) {
      assert.ok(Number.isSafeInteger(page.nextBeforeRevision))
      cursor = page.nextBeforeRevision
    } else {
      assert.equal(page.nextBeforeRevision, null)
      cursor = null
    }
    if (pages > 5) throw Error('pagination-loop')
    if (!page.hasMore) break
  } while (true)
  assert.equal(pages, 3)
  assert.deepEqual(found, Array.from({length:205}, (_, i)=>205-i),
    'PG cursor pages cover every revision without omission or duplicate')

  const other = await read('/api/sync/history', 'B')
  assert.deepEqual(other.history.map((x: {revision:number}) => x.revision),
    [3, 2, 1], 'identity-scoped history cannot leak another tenant')
  assert.equal(other.hasMore, false)

  const bad = await handler(new Request(site + '/api/sync/history?before=1%20OR%201=1'))
  assert.equal(bad.status, 400)
  const total = await pool.query('SELECT count(*)::int AS total FROM sync_snapshots')
  assert.equal(total.rows[0].total, 208, 'GET pagination must never mutate records')
  console.log('[PASS] disposable PG: all 205 historic revisions paged in 3 isolated tenant-scoped requests; no writes')
} finally {
  await pool.end()
}
