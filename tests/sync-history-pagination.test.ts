import assert from 'node:assert/strict'
import {
  createGuardedSyncHandler, SYNC_HISTORY_PAGE_SIZE,
  type SyncRepository
} from '../src/server/guardedSyncService'

const origin = 'https://synthetic-history.example.test'
const phone = 'synthetic-owner-A', other = 'synthetic-owner-B'
const makeRow = (revision: number) => ({
  snapshotId: crypto.randomUUID(), parentSnapshotId: null, revision
})
const fullHistory = Array.from({ length: 205 }, (_, index) =>
  makeRow(205 - index)
)
const otherHistory = [makeRow(3), makeRow(2), makeRow(1)]
let reads = 0
let commits = 0
const store: SyncRepository = {
  readHead: async () => ({ snapshotId: null, revision: 0 }),
  readSnapshot: async () => null,
  readHistory: async (subject, options) => {
    reads++
    const source = subject === phone ? fullHistory : otherHistory
    return source
      .filter(row => options?.beforeRevision === undefined ||
        row.revision < options.beforeRevision)
      .slice(0, options?.limit ?? 100)
  },
  commitSnapshot: async () => {
    commits++
    return { status: 'forbidden' }
  }
}
const handler = createGuardedSyncHandler({
  enabled: true,
  allowedOrigin: origin,
  authenticate: async (req) => {
    if (req.headers.get('x-test-unauthorized')) return null
    return {
      subject: req.headers.get('x-test-other') ? other : phone,
      deviceId: null, permission: 'read'
    }
  },
  repository: store
})
const get = (path: string, headers?: Record<string, string>) =>
  handler(new Request(origin + path, { headers }))
const historyPath = '/api/sync/history'

let result = await get(historyPath)
assert.equal(result.status, 200)
const first = await result.json()
assert.equal(first.history.length, SYNC_HISTORY_PAGE_SIZE)
assert.deepEqual(first.history.map((r: {revision:number}) => r.revision),
  Array.from({ length: 100 }, (_, i) => 205-i))
assert.equal(first.hasMore, true)
assert.equal(first.nextBeforeRevision, 106)

result = await get(historyPath + '?before=106')
assert.equal(result.status, 200)
const second = await result.json()
assert.equal(second.history.length, 100)
assert.equal(second.history[0].revision, 105)
assert.equal(second.history[99].revision, 6)
assert.equal(second.hasMore, true)
assert.equal(second.nextBeforeRevision, 6)

result = await get(historyPath + '?before=6')
assert.equal(result.status, 200)
const last = await result.json()
assert.equal(last.history.length, 5)
assert.equal(last.history[0].revision, 5)
assert.equal(last.history[4].revision, 1)
assert.equal(last.hasMore, false)
assert.equal(last.nextBeforeRevision, null)
const revisions = [
  ...first.history, ...second.history, ...last.history
].map(row => row.revision)
assert.equal(new Set(revisions).size, 205, 'no snapshots skipped or duplicated')
assert.deepEqual(revisions, Array.from({ length: 205 }, (_, i) => 205-i))

result = await get(historyPath, { 'x-test-other': 'true' })
assert.deepEqual((await result.json()).history, otherHistory,
  'other owner sees only their own revisions')
const beforeBad = reads
for (const query of [
  '?before=0', '?before=-1', '?before=1.5', '?before=NaN',
  '?before=', '?before=Infinity', '?before=01', '?before=9007199254740992',
  '?before=1&before=2', '?before=101&debug=true', '?limit=50000'
]) {
  result = await get(historyPath + query)
  assert.equal(result.status, 400, 'reject query ' + query)
  assert.equal((await result.json()).error, 'invalid-history-cursor')
}
assert.equal(reads, beforeBad, 'invalid cursor must be refused before DB query')
result = await get(historyPath, { 'x-test-unauthorized': 'yes' })
assert.equal(result.status, 401)

// Explicitly guard a malfunctioning or substituted store that would return
// absurd metadata even for a bounded page. No oversized Function response.
const hugeHistory: SyncRepository = {
  ...store,
  readHistory: async () => [{
    snapshotId: 'A'.repeat(5*1024*1024+200),
    parentSnapshotId: null, revision: 1
  }]
}
const guardedHuge = createGuardedSyncHandler({
  enabled: true, allowedOrigin: origin,
  authenticate: async () => ({ subject: phone, deviceId: null, permission: 'read' }),
  repository: hugeHistory
})
result = await guardedHuge(new Request(origin + historyPath))
assert.equal(result.status, 503)
assert.equal((await result.json()).error, 'history-exceeds-host-limit')
assert.equal(commits, 0, 'history reads can never publish or restore')
console.log('[PASS] synthetic history: 205 revisions fully paged, no silent truncation/skip/tenant leak, invalid cursor rejected, bounded response')
