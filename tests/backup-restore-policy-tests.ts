import assert from 'node:assert/strict'
import { compareBackupCollections } from '../src/services/backupComparison'
import { canSafelyReplaceWithBackup, getRestoreBlockReasons, hasDuplicateBackupIds } from '../src/services/backupRestorePolicy'
import type { AppBackup, DailyRecord, DeviceDailyData, PeriodLabel } from '../src/types'

type Data = Pick<AppBackup, 'dailyRecords' | 'periodLabels' | 'deviceData'>
const blank = (): Data => ({ dailyRecords: [], periodLabels: [], deviceData: [] })
const day = (date: string, value = 3, id = 'day_' + date): DailyRecord => ({
  id, recordDate: date, recordingStatus: 'recorded',
  startedAt: null, completedAt: null, optedOutAt: null,
  updatedAt: '2026-10-28T00:00:00.000Z', currentPhase: null,
  lastQuestionId: null, answers: { mood: value }
})
const label = (id: string, name: string): PeriodLabel => ({
  id, name, startDate: '2026-10-01', endDate: '2026-10-28',
  kind: 'user_period', createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z'
})
const device = (date: string, steps = 100): DeviceDailyData => ({
  id: 'device_' + date, recordDate: date, source: 'manual',
  steps, sleepDurationMin: null, heartRateAvg: null, weightKg: null,
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z'
})
const compare = (local: Data, incoming: Data) => compareBackupCollections(local, incoming)
const canRestore = (local: Data, incoming: Data) =>
  canSafelyReplaceWithBackup(compare(local, incoming), incoming)

assert.equal(canRestore(blank(), { ...blank(), dailyRecords: [day('2026-10-27')] }), true,
  'empty target can safely restore a valid backup')
assert.equal(canRestore(
  { ...blank(), dailyRecords: [day('2026-10-27')] },
  { ...blank(), dailyRecords: [day('2026-10-27'), day('2026-10-28')] }
), true, 'an identical local subset is safe to replace')
assert.equal(canRestore(
  { ...blank(), dailyRecords: [day('2026-10-27'), day('2026-10-28')] },
  { ...blank(), dailyRecords: [day('2026-10-27')] }
), false, 'local-only day must not be silently deleted')
assert.equal(canRestore(
  { ...blank(), dailyRecords: [day('2026-10-27', 1)] },
  { ...blank(), dailyRecords: [day('2026-10-27', 5)] }
), false, 'same day with different answers is a conflict')
assert.equal(canRestore(
  blank(), { ...blank(), dailyRecords: [day('2026-10-27'), day('2026-10-27')] }
), false, 'duplicate logical date in the backup blocks restore')
assert.equal(canRestore(
  blank(), { ...blank(), dailyRecords: [
    day('2026-10-27', 2, 'duplicate-pk'), day('2026-10-28', 3, 'duplicate-pk')
  ] }
), false, 'duplicate IndexedDB primary key on different dates blocks restore')
assert.equal(hasDuplicateBackupIds({
  ...blank(), dailyRecords: [day('2026-10-27', 2, 'same-id'), day('2026-10-28', 4, 'same-id')]
}), true)
assert.equal(canRestore(
  { ...blank(), periodLabels: [label('period-a', 'Original')] },
  { ...blank(), periodLabels: [label('period-a', 'Changed')] }
), false, 'period label edits cannot be overwritten')
assert.equal(canRestore(
  { ...blank(), deviceData: [device('2026-10-27', 101)] },
  { ...blank(), deviceData: [device('2026-10-27', 102)] }
), false, 'device measurements cannot be overwritten')
assert.equal(canRestore(blank(), { dailyRecords: [], periodLabels: [], deviceData: undefined }), true,
  'legacy backup without deviceData remains readable')
const reasons = getRestoreBlockReasons(compare(
  { ...blank(), dailyRecords: [day('2026-10-27')] },
  { ...blank(), dailyRecords: [day('2026-10-28')] }
), { ...blank(), dailyRecords: [day('2026-10-28')] })
assert.deepEqual(reasons, ['local-only'])
// No changing inputs: compares and restore policy cannot write to IndexedDB.
const local = { ...blank(), dailyRecords: [day('2026-10-27', 2)] }
const copy = JSON.stringify(local)
canRestore(local, { ...blank(), dailyRecords: [day('2026-10-27', 5)] })
assert.equal(JSON.stringify(local), copy)

console.log('[PASS] backup restore policy: safe subset, local-only, conflicts, duplicate keys, old format')
