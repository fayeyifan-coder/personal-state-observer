import type { DailyRecord } from '../types'

export function createDailyRecord(recordDate: string): DailyRecord {
  const now = new Date().toISOString()
  return {
    id: `day_${recordDate}`,
    recordDate,
    recordingStatus: 'draft',
    startedAt: now,
    completedAt: null,
    optedOutAt: null,
    updatedAt: now,
    currentPhase: 'today',
    lastQuestionId: null,
    answers: {}
  }
}
