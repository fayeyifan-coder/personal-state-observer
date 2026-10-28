import assert from 'node:assert/strict'
import { createBackup } from '../src/services/backup'
import { decryptAndVerifySyncSnapshot, createEncryptedSyncSnapshot, parseSyncSnapshot,
  assessIncomingSnapshot, canPreparePublish } from '../src/services/syncProtocol'

const phrase = 'synthetic-test-only-strong-passphrase-2026'
const fixture = createBackup([{
  id: 'test-day-2026-10-27', recordDate: '2026-10-27',
  recordingStatus: 'recorded', startedAt: null, completedAt: null,
  optedOutAt: null, updatedAt: '2026-10-28T00:00:00.000Z',
  currentPhase: null, lastQuestionId: null,
  morningStatus: 'recorded', eveningStatus: 'draft',
  answers: { mood: null, sleepQuality: 4, notes: 'synthetic-not-real-data' }
}], [{
  id: 'test-label', name: '虚构时期', kind: 'user_period',
  startDate: '2026-10-25', endDate: '2026-10-28',
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z'
}], [{
  id: 'test-device-2026-10-27', recordDate: '2026-10-27',
  source: 'manual', sleepDurationMin: null, steps: 2345,
  heartRateAvg: null, weightKg: null,
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z'
}])

const before = JSON.stringify(fixture)
const first = await createEncryptedSyncSnapshot(fixture, phrase, null)
assert.equal(first.parentSnapshotId, null)
assert.equal(parseSyncSnapshot(first).snapshotId, first.snapshotId)
assert.equal(JSON.stringify(first).includes('synthetic-not-real-data'), false)
assert.equal(JSON.stringify(first).includes('虚构时期'), false)
assert.equal(JSON.stringify(first).includes(phrase), false)
assert.deepEqual(await decryptAndVerifySyncSnapshot(first, phrase), fixture)
assert.equal(JSON.stringify(fixture), before, 'must not mutate source backup')

const second = await createEncryptedSyncSnapshot(fixture, phrase, first.snapshotId)
assert.notEqual(first.snapshotId, second.snapshotId)
assert.deepEqual(await decryptAndVerifySyncSnapshot(second, phrase), fixture)
assert.equal(assessIncomingSnapshot(null, first), 'candidate-for-preview')
assert.equal(assessIncomingSnapshot(first.snapshotId, first), 'same-snapshot')
assert.equal(assessIncomingSnapshot(first.snapshotId, second), 'candidate-for-preview')
assert.equal(assessIncomingSnapshot(null, second), 'unverified-history')
assert.equal(assessIncomingSnapshot(second.snapshotId, first), 'diverged-or-rolled-back')
assert.equal(assessIncomingSnapshot(crypto.randomUUID(), second), 'diverged-or-rolled-back')
assert.equal(canPreparePublish(null, null), true)
assert.equal(canPreparePublish(first.snapshotId, first.snapshotId), true)
assert.equal(canPreparePublish(null, first.snapshotId), false)
assert.equal(canPreparePublish(first.snapshotId, second.snapshotId), false)

// Rewriting visible chain metadata while retaining legitimate ciphertext must fail.
await assert.rejects(
  () => decryptAndVerifySyncSnapshot({ ...second, parentSnapshotId: null }, phrase),
  /版本链与密文中的信息不一致/
)
await assert.rejects(
  () => decryptAndVerifySyncSnapshot({ ...second, snapshotId: crypto.randomUUID() }, phrase),
  /版本链与密文中的信息不一致/
)
await assert.rejects(
  () => decryptAndVerifySyncSnapshot(second, 'wrong-secret'),
  /密码不正确/
)
assert.throws(
  () => parseSyncSnapshot({ ...second, dailyRecords: fixture.dailyRecords }),
  /额外字段/
)
assert.throws(
  () => parseSyncSnapshot({ ...second, encrypted: fixture }),
  /额外字段|加密格式/
)
assert.throws(
  () => parseSyncSnapshot({ ...second, encrypted: { ...second.encrypted, rawAnswers: fixture.dailyRecords } }),
  /额外字段/
)
assert.throws(
  () => parseSyncSnapshot({ ...second, snapshotId: '../other-user' }),
  /身份信息/
)
assert.throws(
  () => parseSyncSnapshot({ ...second, parentSnapshotId: second.snapshotId }),
  /身份信息/
)
assert.equal(canPreparePublish('not-a-uuid', 'not-a-uuid'), false)
// A bad password, a tampered parent, or an unknown history must not call restore.
assert.equal(Object.hasOwn(await decryptAndVerifySyncSnapshot(first, phrase), 'syncLink'), false)
console.log('[PASS] encrypted snapshot protocol: confidentiality, parent binding, replay/rollback preflight, invalid inputs')
