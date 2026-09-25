export type QuestionType =
  | 'choice'
  | 'multiChoice'
  | 'text'
  | 'number'

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
  [key: string]: unknown
}

export interface CoreQuestion {
  id: string
  parentId?: string | null
  phase?: string
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
  options?: Option[]
  unit?: string
  maxLength?: number
  showWhen?: ShowWhen
  [key: string]: unknown
}

export type Question = CoreQuestion | OptionalQuestion

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
