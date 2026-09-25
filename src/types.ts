export type RecordingStatus = 'draft' | 'recorded' | 'opted_out'

export type DailyRecord = {
  id: string
  recordDate: string
  recordingStatus: RecordingStatus
  startedAt: string | null
  completedAt: string | null
  optedOutAt: string | null
  updatedAt: string
  currentPhase: 'today' | 'sleep' | 'daytime' | 'optional' | null
  lastQuestionId: string | null
  answers: Record<string, unknown>
}

export type PeriodLabel = {
  id: string
  name: string
  startDate: string
  endDate: string
  kind: 'user_period'
  createdAt: string
  updatedAt: string
}

export type AppBackup = {
  format: 'personal-state-observer-backup'
  formatVersion: 1
  appVersion: string
  schemaVersion: string
  exportedAt: string
  dailyRecords: DailyRecord[]
  periodLabels: PeriodLabel[]
}
