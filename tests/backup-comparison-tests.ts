import assert from 'node:assert/strict'
import { compareBackupCollections } from '../src/services/backupComparison'
import type { AppBackup, DailyRecord, DeviceDailyData, PeriodLabel } from '../src/types'

type Collections = Pick<AppBackup, 'dailyRecords' | 'periodLabels' | 'deviceData'>
const blank = (): Collections => ({ dailyRecords: [], periodLabels: [], deviceData: [] })
const day = (date: string, answers: Record<string, unknown> = {}): DailyRecord => ({
  id: 'day_' + date, recordDate: date, recordingStatus: 'recorded',
  startedAt: null, completedAt: null, optedOutAt: null,
  updatedAt: '2026-10-28T01:00:00.000Z', currentPhase: null, lastQuestionId: null, answers
})
const label = (id: string, name: string): PeriodLabel => ({
  id, name, startDate: '2026-10-01', endDate: '2026-10-28',
  kind: 'user_period', createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z'
})
const deviceDay = (date: string, steps: number): DeviceDailyData => ({
  id: 'device_' + date, recordDate: date, source: 'manual',
  sleepDurationMin: null, steps, heartRateAvg: null, weightKg: null,
  createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z'
})

// First backup on the second device: no false conflicts.
const fresh = compareBackupCollections(blank(), {
  dailyRecords: [day('2026-10-27')], periodLabels: [], deviceData: undefined
})
assert.deepEqual(fresh.dailyRecords.incomingOnly, ['2026-10-27'])
assert.deepEqual(fresh.dailyRecords.conflicts, [])

// Different JSON key order must not create a false conflict.
const localDay = day('2026-10-27', { sleepQuality: 3, mood: 5 })
const incomingDay = day('2026-10-27', { mood: 5, sleepQuality: 3 })
const same = compareBackupCollections({ ...blank(), dailyRecords: [localDay] }, {
  ...blank(), dailyRecords: [incomingDay]
})
assert.deepEqual(same.dailyRecords.identical, ['2026-10-27'])
assert.deepEqual(same.dailyRecords.conflicts, [])

// Same date with different content is a conflict, regardless of timestamps.
const source = { ...blank(), dailyRecords: [localDay, day('2026-10-26')] }
const destination = {
  ...blank(),
  dailyRecords: [day('2026-10-27', { mood: 1 }), day('2026-10-25')]
}
const compare = compareBackupCollections(source, destination)
assert.deepEqual(compare.dailyRecords.localOnly, ['2026-10-26'])
assert.deepEqual(compare.dailyRecords.incomingOnly, ['2026-10-25'])
assert.deepEqual(compare.dailyRecords.conflicts, ['2026-10-27'])
assert.equal(source.dailyRecords[0].answers.mood, 5) // no mutation

// Labels use ids; device measurements are one per date.
const extra = compareBackupCollections({
  dailyRecords: [], periodLabels: [label('a', 'Original')],
  deviceData: [deviceDay('2026-10-27', 100)]
}, {
  dailyRecords: [], periodLabels: [label('a', 'Changed'), label('b', 'New')],
  deviceData: [deviceDay('2026-10-27', 200)]
})
assert.deepEqual(extra.periodLabels.conflicts, ['a'])
assert.deepEqual(extra.periodLabels.incomingOnly, ['b'])
assert.deepEqual(extra.deviceData.conflicts, ['2026-10-27'])

// Broken files with duplicate logical identities must never be treated as safe.
const duplicate = compareBackupCollections({ ...blank(), dailyRecords: [day('2026-10-27'), day('2026-10-27')] }, {
  ...blank(), dailyRecords: [day('2026-10-26'), day('2026-10-26')]
})
assert.deepEqual(duplicate.dailyRecords.duplicateLocalKeys, ['2026-10-27'])
assert.deepEqual(duplicate.dailyRecords.duplicateIncomingKeys, ['2026-10-26'])
assert.deepEqual(duplicate.dailyRecords.localOnly, [])
assert.deepEqual(duplicate.dailyRecords.incomingOnly, [])

console.log('[PASS] read-only backup comparison: additions, identical, conflicts, duplicates, no mutation')
