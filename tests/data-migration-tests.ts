import { normalizeLegacyDailyRecord } from '../src/db/legacyMigration'
import type { LegacyDailyRecord } from '../src/db/legacyMigration'

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`)
  } else {
    console.error(`[FAIL] ${message}`)
    process.exitCode = 1
  }
}

function expectThrow(fn: () => void, expectedMessage: string) {
  try {
    fn()
    assert(false, `Expected function to throw: ${expectedMessage}`)
  } catch (error) {
    assert(error instanceof Error, `Threw error for: ${expectedMessage}`)
  }
}

function runTests() {
  console.log('Running Data Migration Tests...\n')

  const isoTime = new Date().toISOString()

  const validLegacyRecord: LegacyDailyRecord = {
    recordDate: '2023-11-01',
    recordingStatus: 'recorded',
    startedAt: isoTime,
    completedAt: isoTime,
    updatedAt: isoTime,
    currentPhase: '今天',
    lastQuestionId: 'note',
    mood: 'good',
    sleepQuality: 3,
    sleepProblem: [],
    customLegacyField: 'keep-me',
    schemaVersion: '0.6'
  }

  const normalized = normalizeLegacyDailyRecord(validLegacyRecord)

  assert(normalized.recordDate === '2023-11-01', 'recordDate 保留在根部')
  assert(
    normalized.recordingStatus === 'recorded',
    'recordingStatus 保留在根部'
  )
  assert(normalized.startedAt === isoTime, 'startedAt 保持原有字符串')
  assert(normalized.updatedAt === isoTime, 'updatedAt 保持原有字符串')
  assert(
    normalized.answers.recordDate === undefined,
    'answers 中没有 recordDate'
  )
  assert(
    normalized.answers.updatedAt === undefined,
    'answers 中没有 updatedAt'
  )

  assert(normalized.answers.mood === 'good', 'mood 原样进入 answers')
  assert(
    normalized.answers.sleepQuality === 3,
    'sleepQuality 原样进入 answers'
  )

  const sleepProblem = normalized.answers.sleepProblem
  assert(
    Array.isArray(sleepProblem) && sleepProblem.length === 0,
    'sleepProblem: [] 原样保留'
  )

  assert(
    normalized.answers.customLegacyField === 'keep-me',
    '未知字段原样保留'
  )
  assert(
    normalized.answers.schemaVersion === '0.6',
    '旧版 schemaVersion 原样保留'
  )

  assert(
    normalized.id === 'day_2023-11-01',
    '缺失 id 时生成 day_YYYY-MM-DD'
  )

  const recordWithId = normalizeLegacyDailyRecord({
    ...validLegacyRecord,
    id: 'custom-123'
  })
  assert(recordWithId.id === 'custom-123', '已有 id 时原样保留')

  assert(
    normalized.currentPhase === 'today',
    "currentPhase: '今天' → 'today'"
  )

  const sleepPhaseRecord = normalizeLegacyDailyRecord({
    ...validLegacyRecord,
    currentPhase: '昨夜'
  })
  assert(
    sleepPhaseRecord.currentPhase === 'sleep',
    "currentPhase: '昨夜' → 'sleep'"
  )

  const daytimeRecord = normalizeLegacyDailyRecord({
    ...validLegacyRecord,
    currentPhase: '白天 / 睡前'
  })
  assert(
    daytimeRecord.currentPhase === 'daytime',
    "currentPhase: '白天 / 睡前' → 'daytime'"
  )

  const nullPhaseRecord = normalizeLegacyDailyRecord({
    ...validLegacyRecord,
    currentPhase: null
  })
  assert(nullPhaseRecord.currentPhase === null, 'currentPhase: null → null')

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        currentPhase: 'unknown'
      }),
    'unknown currentPhase'
  )

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        recordDate: '2023-02-31'
      }),
    'invalid calendar date'
  )

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        recordDate: '2023-99-01'
      }),
    'invalid month'
  )

  try {
    normalizeLegacyDailyRecord({
      ...validLegacyRecord,
      recordDate: '2024-02-29'
    })
    assert(true, '2024-02-29 合法闰年日期正常通过')
  } catch {
    assert(false, '2024-02-29 不应抛错')
  }

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        updatedAt: undefined
      }),
    'missing updatedAt'
  )

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        updatedAt: 1700000000
      }),
    'numeric updatedAt'
  )

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        startedAt: 1700000000
      }),
    'numeric startedAt'
  )

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        recordingStatus: 'pending'
      }),
    'invalid recordingStatus'
  )

  expectThrow(
    () =>
      normalizeLegacyDailyRecord({
        ...validLegacyRecord,
        recordDate: undefined
      }),
    'missing recordDate'
  )

  console.log('\nTests Completed.')
}

runTests()
