import assert from 'node:assert/strict'
import {
  periodicTransferStatus,
  buildLocalNumericAnalysisDraft
} from '../src/services/offlineAnalysisHandoff'
import type { AppBackup, DailyRecord } from '../src/types'

// Transfer confirmation is when the PC verified the file, NOT phone export.
// Never trigger an automatic request to a cloud server or delete the source.
const first = periodicTransferStatus('2026-10-28', null)
assert.deepEqual(first, {
  cadenceDays: 14, today: '2026-10-28',
  lastConfirmedDesktopImportDate: null,
  nextDueDate: null, daysUntilDue: null,
  due: true, reason: 'never-imported'
})
const weekly = periodicTransferStatus('2026-10-28', '2026-10-22', 7)
assert.equal(weekly.nextDueDate, '2026-10-29')
assert.equal(weekly.daysUntilDue, 1)
assert.equal(weekly.due, false)
assert.equal(periodicTransferStatus('2026-10-29', '2026-10-22', 7).due, true)
const fortnight = periodicTransferStatus('2026-11-05', '2026-10-22')
assert.equal(fortnight.nextDueDate, '2026-11-05')
assert.equal(fortnight.daysUntilDue, 0)
assert.equal(fortnight.due, true)
assert.equal(periodicTransferStatus('2026-11-20', '2026-11-05').daysUntilDue, -1)
assert.equal(
  periodicTransferStatus('2028-03-01', '2028-02-29', 7).nextDueDate,
  '2028-03-07'
)
assert.equal(
  periodicTransferStatus('2026-11-01', '2026-11-02').reason,
  'clock-before-last-confirmation'
)
for (const date of ['2026-02-29', '2026-13-01', 'not-a-date', '2026-12-00']) {
  assert.throws(() => periodicTransferStatus(date, null), /invalid-calendar-date/)
}
assert.throws(
  () => periodicTransferStatus('2026-10-28', null, 1 as 7),
  /invalid-transfer-cadence/
)

const record = (
  recordDate: string, answers: Record<string, unknown>
): DailyRecord => ({
  id: 'sensitive-unique-row-id', recordDate,
  recordingStatus: 'recorded', startedAt: null,
  completedAt: null, optedOutAt: null,
  updatedAt: 'sensitive-edit-timestamp',
  currentPhase: null, lastQuestionId: null, answers
})
const backup: AppBackup = {
  format: 'personal-state-observer-backup',
  formatVersion: 1, appVersion: '1.5',
  schemaVersion: '0.8', exportedAt: '2026-10-28T00:00:00.000Z',
  dailyRecords: [
    record('2026-10-26', {
      mood: 4, energy: 3, sleepDurationMin: 450, sleepQuality: 5,
      // Never copy free-text, unknown fields, or sensitive categorical data.
      personalNotes: 'PRIVATE_DIARY_SHOULD_NOT_LEAVE_DEVICE',
      periodStart: 'yes',
      unknownNumber: 333,
      sleepProblem: ['hunger'],
      focus: 'REDACT_ME'
    }),
    record('2026-10-25', {
      mood: 2, energy: 1, sleepQuality: 'not-a-number',
      personalNotes: 'PRIVATE_FREE_TEXT'
    }),
    record('2026-09-01', { mood: 5, energy: 5 })
  ],
  periodLabels: [
    { id: 'private-label-id', name: 'PRIVATE_PERIOD_LABEL_NAME',
      startDate: '2026-10-01', endDate: '2026-10-28',
      kind: 'user_period', createdAt: 'PRIVATE_TIME', updatedAt: 'PRIVATE_TIME' }
  ],
  deviceData: [
    { id: 'private-device-id', recordDate: '2026-10-25',
      source: 'manual', sleepDurationMin: 420, steps: 3600,
      heartRateAvg: null, weightKg: 51, createdAt: 'PRIVATE_TIMESTAMP',
      updatedAt: 'PRIVATE_TIMESTAMP' }
  ]
}
const original = structuredClone(backup)
const draft = buildLocalNumericAnalysisDraft(backup, '2026-10-01', '2026-10-28')
assert.equal(draft.recordDays, 2)
assert.equal(draft.deviceDays, 1)
assert.equal(draft.includesFreeText, false)
assert.equal(draft.requiresExplicitExternalApiConsent, true)
assert.deepEqual(draft.observations, [
  { recordDate: '2026-10-25', metrics: { mood: 2, energy: 1 } },
  { recordDate: '2026-10-26', metrics: {
    mood: 4, energy: 3, sleepDurationMin: 450, sleepQuality: 5
  } }
])
assert.deepEqual(draft.deviceObservations, [
  { recordDate: '2026-10-25',
    metrics: { sleepDurationMin: 420, steps: 3600, weightKg: 51 } }
])
const serialized = JSON.stringify(draft)
for (const secret of [
  'PRIVATE_DIARY_SHOULD_NOT_LEAVE_DEVICE',
  'PRIVATE_PERIOD_LABEL_NAME',
  'private-label-id',
  'sensitive-unique-row-id',
  'sensitive-edit-timestamp',
  'PRIVATE_TIMESTAMP',
  'periodStart',
  'unknownNumber',
  'sleepProblem'
]) {
  assert.equal(serialized.includes(secret), false, 'excluded sensitive field: ' + secret)
}
assert.deepEqual(backup, original, 'read-only draft never mutates source record')
const yearDraft = buildLocalNumericAnalysisDraft(
  backup, '2026-01-01', '2026-12-31'
)
assert.equal(yearDraft.recordDays, 3,
  '14-day transfer interval must never cap requested long-term analysis window')
assert.throws(
  () => buildLocalNumericAnalysisDraft(backup, '2026-11-01', '2026-10-01'),
  /invalid-analysis-range/
)
assert.throws(
  () => buildLocalNumericAnalysisDraft({
    ...backup, dailyRecords: [...backup.dailyRecords, backup.dailyRecords[0]]
  }, '2026-10-01', '2026-10-28'), /duplicate-analysis-day/
)
assert.throws(
  () => buildLocalNumericAnalysisDraft({
    ...backup, deviceData: [backup.deviceData![0], backup.deviceData![0]]
  }, '2026-10-01', '2026-10-28'), /duplicate-analysis-device-day/
)

console.log('[PASS] local 7/14-day cadence, user-verified PC receipt, annual analysis independence, no raw notes/IDs, no API call or IndexedDB mutation')
