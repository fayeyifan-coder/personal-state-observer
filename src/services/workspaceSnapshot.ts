import type { DailyRecord } from '../types'

/**
 * Personal Workspace P2 source contract. This is a manually generated,
 * unencrypted, HEALTH-SENSITIVE read-only derivative. Never auto-upload,
 * auto-sync or treat it as a backup/restore file.
 */
export const WORKSPACE_METRIC_LABELS = {
  mood: '情绪',
  energy: '精力',
  drive: '行动启动',
  sleepQuality: '睡眠质量',
  sleepDurationBand: '睡眠时长区间'
} as const
export type WorkspaceMetric = keyof typeof WORKSPACE_METRIC_LABELS

const SOURCE_FIELD: Record<WorkspaceMetric, string> = {
  mood: 'mood',
  energy: 'energy',
  drive: 'drive',
  sleepQuality: 'sleepQuality',
  sleepDurationBand: 'sleepDurationMin'
}

// Form stores representative minute codes for bins, NOT measured minutes.
// For example, 330 means the 5–6h CHOICE, not exactly 330 minutes.
export const SLEEP_BANDS = {
  240: '<5h',
  330: '5-6h',
  390: '6-7h',
  450: '7-8h',
  510: '8-9h',
  600: '>9h'
} as const

type DayMetrics = Partial<Record<WorkspaceMetric, number | string | null>>
export type WorkspaceSnapshotV1 = {
  format: 'personal-workspace-snapshot'
  schemaVersion: 1
  sourceApp: 'personal-state-observer'
  generatedAt: string
  sourceVersion: '1.5'
  data: {
    interval: { from: string; through: string }
    metrics: WorkspaceMetric[]
    totalRecordDays: number
    observedDaysByMetric: Record<string, number>
    days: Array<{ date: string; values: DayMetrics }>
  }
}

function parseDateKey(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('invalid-workspace-date')
  const [year, month, day] = value.split('-').map(Number)
  const ms = Date.UTC(year, month - 1, day)
  const date = new Date(ms)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day) throw Error('invalid-workspace-date')
  return ms
}

function metricValue(row: DailyRecord, metric: WorkspaceMetric): number | string | null {
  const raw = row.answers[SOURCE_FIELD[metric]]
  if (metric === 'sleepDurationBand') {
    if (typeof raw !== 'number') return null
    return SLEEP_BANDS[raw as keyof typeof SLEEP_BANDS] ?? null
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) ||
    raw < 1 || raw > 5) return null
  // 1–5 ratings are ordinal, not objective measurements.
  return raw
}

export function buildWorkspaceSnapshot(
  records: readonly DailyRecord[],
  options: {
    from: string
    through: string
    metrics: readonly WorkspaceMetric[]
    generatedAt: string
  }
): WorkspaceSnapshotV1 {
  const from = parseDateKey(options.from)
  const through = parseDateKey(options.through)
  if (from > through) throw Error('invalid-workspace-interval')
  if (!Number.isFinite(Date.parse(options.generatedAt))) {
    throw Error('invalid-workspace-generated-at')
  }
  const metrics = [...new Set(options.metrics)]
  if (metrics.length === 0 || metrics.some(metric =>
    !Object.prototype.hasOwnProperty.call(WORKSPACE_METRIC_LABELS, metric))) {
    throw Error('select-workspace-metrics')
  }

  const seen = new Set<string>()
  const days: WorkspaceSnapshotV1['data']['days'] = []
  const observedDaysByMetric: Record<string, number> =
    Object.fromEntries(metrics.map(metric => [metric, 0]))

  for (const row of records) {
    const at = parseDateKey(row.recordDate)
    if (at < from || at > through) continue
    if (seen.has(row.recordDate)) throw Error('duplicate-workspace-record-date')
    seen.add(row.recordDate)
    if (row.recordingStatus === 'opted_out') continue
    const values: DayMetrics = {}
    for (const metric of metrics) {
      const value = metricValue(row, metric)
      // Preserve null as missing; never mistake unanswered for a zero rating.
      values[metric] = value
      if (value !== null) observedDaysByMetric[metric]++
    }
    days.push({ date: row.recordDate, values })
  }
  days.sort((a, b) => a.date.localeCompare(b.date))
  return {
    format: 'personal-workspace-snapshot',
    schemaVersion: 1,
    sourceApp: 'personal-state-observer',
    generatedAt: options.generatedAt,
    sourceVersion: '1.5',
    data: {
      interval: { from: options.from, through: options.through },
      metrics, totalRecordDays: days.length, observedDaysByMetric, days
    }
  }
}

/**
 * Strict v1 import verification for eventual Workspace P2.
 * Malformed/old/future snapshots fail closed and NEVER call restoreBackup.
 */
export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshotV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('invalid-workspace-snapshot')
  }
  const input = value as Partial<WorkspaceSnapshotV1>
  if (input.format !== 'personal-workspace-snapshot' ||
    input.schemaVersion !== 1 || input.sourceApp !== 'personal-state-observer' ||
    input.sourceVersion !== '1.5' ||
    typeof input.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.generatedAt))) {
    throw Error('unsupported-workspace-snapshot')
  }
  const topKeys = Object.keys(input)
  if (topKeys.length !== 6 ||
    topKeys.some(key => ![
      'format', 'schemaVersion', 'sourceApp', 'generatedAt',
      'sourceVersion', 'data'
    ].includes(key))) {
    throw Error('unexpected-workspace-fields')
  }
  const data = input.data
  if (data && (Object.keys(data).length !== 5 ||
    Object.keys(data).some(key => ![
      'interval', 'metrics', 'totalRecordDays',
      'observedDaysByMetric', 'days'
    ].includes(key)))) {
    throw Error('unexpected-workspace-data-fields')
  }
  if (!data || !Array.isArray(data.metrics) || !Array.isArray(data.days) ||
    !data.interval || typeof data.interval.from !== 'string' ||
    typeof data.interval.through !== 'string' ||
    !Number.isSafeInteger(data.totalRecordDays) ||
    data.totalRecordDays !== data.days.length ||
    !data.observedDaysByMetric || typeof data.observedDaysByMetric !== 'object') {
    throw Error('invalid-workspace-snapshot')
  }
  const first = parseDateKey(data.interval.from)
  const last = parseDateKey(data.interval.through)
  if (first > last) throw Error('invalid-workspace-interval')
  const metrics = data.metrics as WorkspaceMetric[]
  if (!metrics.length || new Set(metrics).size !== metrics.length ||
    metrics.some(metric => !Object.hasOwn(WORKSPACE_METRIC_LABELS, metric))) {
    throw Error('invalid-workspace-metrics')
  }
  const counts: Record<string, number> =
    Object.fromEntries(metrics.map(metric => [metric, 0]))
  let prev = ''
  for (const day of data.days) {
    if (!day || typeof day.date !== 'string' || !day.values ||
      typeof day.values !== 'object' || Array.isArray(day.values)) {
      throw Error('invalid-workspace-day')
    }
    const at = parseDateKey(day.date)
    if (at < first || at > last || day.date <= prev) {
      throw Error('unsorted-or-duplicate-workspace-day')
    }
    prev = day.date
    if (Object.keys(day).some(k => k !== 'date' && k !== 'values')) {
      throw Error('unexpected-workspace-day-fields')
    }
    const keys = Object.keys(day.values)
    if (keys.length !== metrics.length ||
      keys.some(k => !metrics.includes(k as WorkspaceMetric))) {
      throw Error('unexpected-workspace-metric')
    }
    for (const metric of metrics) {
      const metricRaw = day.values[metric]
      if (metricRaw === undefined) throw Error('missing-workspace-metric')
      if (metricRaw !== null) {
        if (metric === 'sleepDurationBand') {
          if (!Object.values(SLEEP_BANDS).includes(metricRaw as typeof SLEEP_BANDS[keyof typeof SLEEP_BANDS])) {
            throw Error('invalid-workspace-band')
          }
        } else if (typeof metricRaw !== 'number' || !Number.isInteger(metricRaw) ||
          metricRaw < 1 || metricRaw > 5) {
          throw Error('invalid-workspace-rating')
        }
        counts[metric]++
      }
    }
  }
  if (Object.keys(data.observedDaysByMetric).length !== metrics.length ||
    metrics.some(m => counts[m] !== data.observedDaysByMetric[m])) {
    throw Error('invalid-workspace-coverage')
  }
  return input as WorkspaceSnapshotV1
}
