import assert from 'node:assert/strict'
import { buildWorkspaceSnapshot, parseWorkspaceSnapshot } from '../src/services/workspaceSnapshot'
import type { DailyRecord } from '../src/types'

const makeDay = (
  date: string, answers: Record<string, unknown>,
  status: DailyRecord['recordingStatus'] = 'recorded'
): DailyRecord => ({
  id: 'SECRET_ROW_IDENTIFIER',
  recordDate: date,
  recordingStatus: status,
  startedAt: 'SECRET_START_TIME',
  completedAt: null, optedOutAt: null,
  updatedAt: 'SECRET_EDIT_TIME',
  currentPhase: null, lastQuestionId: 'SECRET_LAST_QUESTION_ID',
  answers
})
const daily: DailyRecord[] = [
  makeDay('2026-10-28', {
    mood: 2, energy: 3, sleepQuality: 4, sleepDurationMin: 330,
    note: 'PRIVATE_HEALTH_DIARY_DO_NOT_COPY',
    periodStart: 'yes', libido: 4,
    contextEvents: ['very_private_context'],
    proteinIntakeG: 0
  }),
  makeDay('2026-10-27', {
    mood: 5, energy: null, sleepQuality: 'unanswered',
    sleepDurationMin: 450,
    note: 'PRIVATE_NOTE_SHOULD_NOT_COPY'
  }, 'draft'),
  makeDay('2026-10-26', {
    mood: 3, sleepDurationMin: 290, // malformed old value: not a known bin
  }),
  makeDay('2026-10-25', { mood: 1 }, 'opted_out'),
  makeDay('2026-09-01', { mood: 5 })
]
const original = structuredClone(daily)
const options = {
  from: '2026-10-26',
  through: '2026-10-28',
  metrics: ['mood', 'energy', 'sleepQuality', 'sleepDurationBand'] as const,
  generatedAt: '2026-10-29T01:00:00.000Z'
}
const result = buildWorkspaceSnapshot(daily, options)
assert.equal(result.format, 'personal-workspace-snapshot')
assert.equal(result.schemaVersion, 1)
assert.equal(result.sourceApp, 'personal-state-observer')
assert.equal(result.data.totalRecordDays, 3)
assert.deepEqual(result.data.days, [
  { date: '2026-10-26', values: {
    mood: 3, energy: null, sleepQuality: null, sleepDurationBand: null
  }},
  { date: '2026-10-27', values: {
    mood: 5, energy: null, sleepQuality: null, sleepDurationBand: '7-8h'
  }},
  { date: '2026-10-28', values: {
    mood: 2, energy: 3, sleepQuality: 4, sleepDurationBand: '5-6h'
  }}
])
assert.deepEqual(result.data.observedDaysByMetric, {
  mood: 3, energy: 1, sleepQuality: 1, sleepDurationBand: 2
})
assert.deepEqual(result.data.metrics, options.metrics)
const json = JSON.stringify(result)
for(const forbidden of [
  'SECRET_ROW_IDENTIFIER', 'SECRET_START_TIME', 'SECRET_EDIT_TIME',
  'SECRET_LAST_QUESTION_ID', 'PRIVATE_HEALTH_DIARY_DO_NOT_COPY',
  'PRIVATE_NOTE_SHOULD_NOT_COPY', 'very_private_context',
  'periodStart', 'libido', 'contextEvents', 'proteinIntakeG',
  'sleepDurationMin'
]) {
  assert.equal(json.includes(forbidden), false,
    'forbidden private field must not be exported: ' + forbidden)
}
assert.deepEqual(daily, original, 'no source records mutated')
assert.deepEqual(parseWorkspaceSnapshot(JSON.parse(json)), result,
  'receiver preview verifies the exact v1 envelope')
assert.throws(() => parseWorkspaceSnapshot({ format:'personal-state-observer-backup' }),
  /unsupported-workspace-snapshot|invalid-workspace-snapshot/,
  'a full backup must NEVER be accepted as a workspace summary')
assert.throws(() => buildWorkspaceSnapshot(daily, { ...options, metrics: [] }),
  /select-workspace-metrics/)
assert.throws(() => buildWorkspaceSnapshot(daily, {
  ...options, metrics: ['note'] as unknown as typeof options.metrics
}), /select-workspace-metrics/)
assert.throws(() => buildWorkspaceSnapshot(daily, {
  ...options, from: '2026-10-29'
}), /invalid-workspace-interval/)
assert.throws(() => buildWorkspaceSnapshot(daily, {
  ...options, from: '2026-02-30'
}), /invalid-workspace-date/)
assert.throws(() => buildWorkspaceSnapshot([...daily, daily[0]], options),
  /duplicate-workspace-record-date/)
const tainted = JSON.parse(json)
tainted.privateNotes = 'UNAUTHORIZED_DATA'
assert.throws(() => parseWorkspaceSnapshot(tainted), /unexpected-workspace-fields/)
delete tainted.privateNotes
tainted.data.days[0].values.note = 'UNAUTHORIZED_DATA'
assert.throws(() => parseWorkspaceSnapshot(tainted), /unexpected-workspace-metric/)
delete tainted.data.days[0].values.note
tainted.data.days[0].date = tainted.data.days[1].date
assert.throws(() => parseWorkspaceSnapshot(tainted),
  /unsorted-or-duplicate-workspace-day/)
const wrongCount = JSON.parse(json)
wrongCount.data.observedDaysByMetric.mood = 333
assert.throws(() => parseWorkspaceSnapshot(wrongCount),
  /invalid-workspace-coverage/)
console.log('[PASS] Workspace v1: explicitly selected projections, dates, sleep as category, null coverage, no diary/raw cycle, read-only, strict import')
