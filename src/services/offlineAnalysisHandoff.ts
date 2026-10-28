import type { AppBackup } from '../types'

/** Product requirement: batch handoff to a PC, NOT automatic cloud sync. */
export type TransferCadenceDays = 7 | 14

export type PeriodicTransferStatus = {
  cadenceDays: TransferCadenceDays
  today: string
  lastConfirmedDesktopImportDate: string | null
  nextDueDate: string | null
  daysUntilDue: number | null
  due: boolean
  reason: 'never-imported' | 'scheduled' | 'clock-before-last-confirmation'
}

/** Validate actual calendar dates, not just YYYY-MM-DD-looking strings. */
function dateUtc(dateKey: string): number {
  if (!/^\d{4}-\d\d-\d\d$/.test(dateKey)) {
    throw Error('invalid-calendar-date')
  }
  const [y, m, d] = dateKey.split('-').map(Number)
  const value = Date.UTC(y, m - 1, d)
  const date = new Date(value)
  if (date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw Error('invalid-calendar-date')
  }
  return value
}

function dateKey(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10)
}

const DAY_MS = 86_400_000

/**
 * No timers, no network, no localStorage and NO automatic writing.
 * The last date means the user CONFIRMED the PC successfully inspected the
 * transferred file, not merely the phone exporting a file.
 *
 * UI can display "due" based on the current local calendar date. A device
 * clock earlier than that confirmation is suspicious, not an overdue event.
 */
export function periodicTransferStatus(
  today: string,
  lastConfirmedDesktopImportDate: string | null,
  cadenceDays: TransferCadenceDays = 14
): PeriodicTransferStatus {
  if (cadenceDays !== 7 && cadenceDays !== 14) throw Error('invalid-transfer-cadence')
  const now = dateUtc(today)
  if (lastConfirmedDesktopImportDate === null) {
    return {
      cadenceDays, today, lastConfirmedDesktopImportDate: null,
      nextDueDate: null, daysUntilDue: null,
      due: true, reason: 'never-imported'
    }
  }
  const previous = dateUtc(lastConfirmedDesktopImportDate)
  if (previous > now) {
    return {
      cadenceDays, today, lastConfirmedDesktopImportDate,
      nextDueDate: dateKey(previous + cadenceDays * DAY_MS),
      daysUntilDue: null, due: false,
      reason: 'clock-before-last-confirmation'
    }
  }
  const next = previous + cadenceDays * DAY_MS
  const daysUntilDue = Math.round((next - now) / DAY_MS)
  return {
    cadenceDays, today, lastConfirmedDesktopImportDate,
    nextDueDate: dateKey(next),
    daysUntilDue, due: daysUntilDue <= 0, reason: 'scheduled'
  }
}

const DEFAULT_METRICS = ['mood', 'energy', 'sleepDurationMin', 'sleepQuality'] as const
type BasicMetric = typeof DEFAULT_METRICS[number]
const DEVICE_METRICS = ['sleepDurationMin', 'steps', 'heartRateAvg', 'weightKg'] as const
type DeviceMetric = typeof DEVICE_METRICS[number]

type NumericObservation = {
  recordDate: string
  metrics: Partial<Record<BasicMetric, number>>
}
type DeviceObservation = {
  recordDate: string
  metrics: Partial<Record<DeviceMetric, number>>
}

export type NumericAnalysisDraft = {
  schema: 'pso-offline-numeric-analysis-draft-v1'
  period: { from: string; through: string }
  recordDays: number
  deviceDays: number
  observations: NumericObservation[]
  deviceObservations: DeviceObservation[]
  includesFreeText: false
  includesNamesOrRecordIds: false
  /** This is NOT approval to transmit it to any external AI provider. */
  requiresExplicitExternalApiConsent: true
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * A local-only, deliberately minimal per-day draft for later API analysis.
 * Does NOT call the API or read/write IndexedDB. No user-entered notes,
 * IDs, timestamps, period label names or unapproved answer fields are copied.
 * Dates and metrics remain sensitive personal health data; external sending
 * must be a separate preview-and-confirm action.
 *
 * Handoff cadence and analysis window are independent: transferring every
 * 14 days must NOT limit seasonal analysis to just 14 days.
 */
export function buildLocalNumericAnalysisDraft(
  backup: AppBackup,
  from: string,
  through: string
): NumericAnalysisDraft {
  const first = dateUtc(from)
  const last = dateUtc(through)
  if (first > last) throw Error('invalid-analysis-range')
  if (!backup || !Array.isArray(backup.dailyRecords) ||
    (backup.deviceData !== undefined && !Array.isArray(backup.deviceData))) {
    throw Error('invalid-backup-for-analysis')
  }
  const datesSeen = new Set<string>()
  const observations: NumericObservation[] = []
  for (const row of backup.dailyRecords) {
    const at = dateUtc(row.recordDate)
    if (at < first || at > last) continue
    if (datesSeen.has(row.recordDate)) throw Error('duplicate-analysis-day')
    datesSeen.add(row.recordDate)
    const metrics: NumericObservation['metrics'] = {}
    for (const key of DEFAULT_METRICS) {
      const value = numeric(row.answers?.[key])
      if (value !== undefined) metrics[key] = value
    }
    observations.push({ recordDate: row.recordDate, metrics })
  }
  const deviceSeen = new Set<string>()
  const deviceObservations: DeviceObservation[] = []
  for (const row of backup.deviceData ?? []) {
    const at = dateUtc(row.recordDate)
    if (at < first || at > last) continue
    if (deviceSeen.has(row.recordDate)) throw Error('duplicate-analysis-device-day')
    deviceSeen.add(row.recordDate)
    const metrics: DeviceObservation['metrics'] = {}
    for (const key of DEVICE_METRICS) {
      const value = numeric(row[key])
      if (value !== undefined) metrics[key] = value
    }
    deviceObservations.push({ recordDate: row.recordDate, metrics })
  }
  observations.sort((a, b) => a.recordDate.localeCompare(b.recordDate))
  deviceObservations.sort((a, b) => a.recordDate.localeCompare(b.recordDate))
  return {
    schema: 'pso-offline-numeric-analysis-draft-v1',
    period: { from, through },
    recordDays: observations.length,
    deviceDays: deviceObservations.length,
    observations, deviceObservations,
    includesFreeText: false,
    includesNamesOrRecordIds: false,
    requiresExplicitExternalApiConsent: true
  }
}
