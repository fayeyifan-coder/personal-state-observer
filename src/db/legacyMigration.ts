// src/db/legacyMigration.ts
import type { DailyRecord, ObservationPhase } from '../types'

export type LegacyDailyRecord = Record<string, unknown>

const METADATA_KEYS = new Set<string>([
  'id',
  'recordDate',
  'recordingStatus',
  'startedAt',
  'completedAt',
  'optedOutAt',
  'updatedAt',
  'currentPhase',
  'lastQuestionId',
  'morningStartedAt',
  'morningCompletedAt',
  'morningLastQuestionId',
  'eveningStartedAt',
  'eveningCompletedAt',
  'eveningLastQuestionId'
])

// V1.4 的旧 phase 名称不能直接写入 V1.5 的 ObservationPhase。
// 这里按“观察发生在什么时候”迁移：昨夜数据由早晨回顾，今天/白天/睡前数据由晚上总结。
const LEGACY_PHASE_MAP: Record<string, ObservationPhase> = {
  '今天': 'evening',
  '昨夜': 'morning',
  '白天 / 睡前': 'evening',
  morning: 'morning',
  evening: 'evening'
}

function isValidRecordDate(dateString: unknown): dateString is string {
  if (typeof dateString !== 'string') return false

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  )
}

function isValidRecordingStatus(
  status: unknown
): status is DailyRecord['recordingStatus'] {
  return status === 'draft' || status === 'recorded' || status === 'opted_out'
}

function parseOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value

  throw new Error(
    `Migration Failed: Invalid ${fieldName}, expected string or null/undefined.`
  )
}

export function normalizeLegacyDailyRecord(
  legacy: LegacyDailyRecord
): DailyRecord {
  if (!isValidRecordDate(legacy.recordDate)) {
    throw new Error(
      `Migration Failed: Invalid or missing recordDate '${legacy.recordDate}'.`
    )
  }

  if (!isValidRecordingStatus(legacy.recordingStatus)) {
    throw new Error(
      `Migration Failed: Invalid or missing recordingStatus '${legacy.recordingStatus}'.`
    )
  }

  let currentPhase: DailyRecord['currentPhase'] = null

  if (legacy.currentPhase !== undefined && legacy.currentPhase !== null) {
    if (
      typeof legacy.currentPhase === 'string' &&
      legacy.currentPhase in LEGACY_PHASE_MAP
    ) {
      currentPhase = LEGACY_PHASE_MAP[legacy.currentPhase]
    } else {
      throw new Error(
        `Migration Failed: Invalid currentPhase '${legacy.currentPhase}'.`
      )
    }
  }

  if (typeof legacy.updatedAt !== 'string') {
    throw new Error(
      'Migration Failed: Missing or invalid updatedAt. Expected string.'
    )
  }

  const id =
    typeof legacy.id === 'string'
      ? legacy.id
      : `day_${legacy.recordDate}`

  const answers: Record<string, unknown> = {}

  const record: DailyRecord = {
    id,
    recordDate: legacy.recordDate,
    recordingStatus: legacy.recordingStatus,
    startedAt: parseOptionalString(legacy.startedAt, 'startedAt'),
    completedAt: parseOptionalString(legacy.completedAt, 'completedAt'),
    optedOutAt: parseOptionalString(legacy.optedOutAt, 'optedOutAt'),
    updatedAt: legacy.updatedAt,
    currentPhase,
    lastQuestionId: parseOptionalString(legacy.lastQuestionId, 'lastQuestionId'),
    morningStartedAt: null,
    morningCompletedAt: null,
    morningLastQuestionId: null,
    eveningStartedAt: null,
    eveningCompletedAt: null,
    eveningLastQuestionId: null,
    answers
  }

  // 兼容已经带两时段字段的中间版本数据。
  record.morningStartedAt = parseOptionalString(legacy.morningStartedAt, 'morningStartedAt')
  record.morningCompletedAt = parseOptionalString(legacy.morningCompletedAt, 'morningCompletedAt')
  record.morningLastQuestionId = parseOptionalString(legacy.morningLastQuestionId, 'morningLastQuestionId')
  record.eveningStartedAt = parseOptionalString(legacy.eveningStartedAt, 'eveningStartedAt')
  record.eveningCompletedAt = parseOptionalString(legacy.eveningCompletedAt, 'eveningCompletedAt')
  record.eveningLastQuestionId = parseOptionalString(legacy.eveningLastQuestionId, 'eveningLastQuestionId')

  for (const [key, value] of Object.entries(legacy)) {
    if (!METADATA_KEYS.has(key)) {
      answers[key] = value
    }
  }

  return record
}
