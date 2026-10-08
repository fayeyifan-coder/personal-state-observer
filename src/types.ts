// src/types.ts

export type QuestionType =
  | 'choice'
  | 'multiChoice'
  | 'text'
  | 'number'

export type AnswerValue =
  | string
  | number
  | boolean
  | Array<string | number>
  | null

export type Operator =
  | 'exists'
  | 'eq'
  | 'neq'
  | 'includes'
  | 'notIncludes'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export interface Condition {
  field: string
  op: Operator
  value?: unknown
}

export interface ShowWhen {
  all?: Condition[]
  any?: Condition[]
}

export interface Option {
  label: string
  value: string | number
  icon?: string
  description?: string
  [key: string]: unknown
}

export type ObservationPhase = 'morning' | 'evening'

export type ObservationStatus = 'not_started' | 'draft' | 'recorded' | 'opted_out'

export interface CoreQuestion {
  id: string
  parentId?: string | null
  phase?: ObservationPhase
  phaseBreak?: boolean
  text: string
  helper?: string
  type: QuestionType
  options?: Option[]
  showWhen?: ShowWhen
  [key: string]: unknown
}

export interface OptionalQuestion {
  id: string
  label: string
  type: QuestionType
  phase?: ObservationPhase
  options?: Option[]
  unit?: string
  maxLength?: number
  showWhen?: ShowWhen
  [key: string]: unknown
}

export type Question = CoreQuestion | OptionalQuestion

export type RecordingStatus =
  | 'draft'
  | 'recorded'
  | 'opted_out'

export type DailyRecord = {
  id: string
  recordDate: string
  recordingStatus: RecordingStatus
  startedAt: string | null
  completedAt: string | null
  optedOutAt: string | null
  updatedAt: string
  currentPhase: ObservationPhase | null
  lastQuestionId: string | null

  // V1.5 两时段观察：同一天仍然只有一条 DailyRecord。
  morningStatus?: ObservationStatus
  morningStartedAt?: string | null
  morningCompletedAt?: string | null
  morningOptedOutAt?: string | null
  morningLastQuestionId?: string | null
  eveningStatus?: ObservationStatus
  eveningStartedAt?: string | null
  eveningCompletedAt?: string | null
  eveningOptedOutAt?: string | null
  eveningLastQuestionId?: string | null

  answers: Record<string, unknown>
}

export type DeviceDataSource = 'manual' | 'huawei-health'

export type DeviceDailyData = {
  id: string
  recordDate: string
  source: DeviceDataSource
  sleepDurationMin: number | null
  steps: number | null
  heartRateAvg: number | null
  weightKg: number | null
  createdAt: string
  updatedAt: string
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
  deviceData?: DeviceDailyData[]
}
