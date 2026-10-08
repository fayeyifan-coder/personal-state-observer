// src/app/createDailyRecord.ts
import type { DailyRecord } from '../types'

export function createDailyRecord(recordDate: string): DailyRecord {
  const now = new Date().toISOString()

  return {
    id: `day_${recordDate}`,
    recordDate,
    recordingStatus: 'draft',
    startedAt: null,
    completedAt: null,
    optedOutAt: null,
    updatedAt: now,
    currentPhase: null,
    lastQuestionId: null,
    morningStatus: 'not_started',
    morningStartedAt: null,
    morningCompletedAt: null,
    morningOptedOutAt: null,
    morningLastQuestionId: null,
    eveningStatus: 'not_started',
    eveningStartedAt: null,
    eveningCompletedAt: null,
    eveningOptedOutAt: null,
    eveningLastQuestionId: null,
    answers: {}
  }
}
