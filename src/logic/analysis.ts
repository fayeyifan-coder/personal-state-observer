import type { DailyRecord } from '../types'

export type Season = '春' | '夏' | '秋' | '冬'
export type AcneObservation = 'present' | 'absent' | 'missing'

export type NumericMetricSummary = {
  mean: number | null
  count: number
}

export type SeasonalObservation = {
  name: Season
  months: number[]
  hint: string
  records: DailyRecord[]
  activeDays: number
  recordedDays: number
  mood: NumericMetricSummary
  energy: NumericMetricSummary
  sleep: NumericMetricSummary
  acneObserved: number
  acneDays: number
  acneRate: number | null
  deviceDays: number
  moodDelta: number | null
  energyDelta: number | null
  sleepDelta: number | null
}

export type CycleRow = {
  day: number
  dateKey: string
  record?: DailyRecord
  mood: number | null
  energy: number | null
  sleep: number | null
  acne: AcneObservation
}

export type CycleSummary = {
  startDate: string
  endDate: string
  length: number
  rows: CycleRow[]
  complete: boolean
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateDiffDays(startDate: string, endDate: string): number {
  const start = parseDateKey(startDate)
  const end = parseDateKey(endDate)
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((endUtc - startUtc) / 86400000)
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + deltaDays)
  return formatDateKey(date)
}

export function average(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!numbers.length) return null
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
}

export function summarizeNumber(values: Array<number | null | undefined>): NumericMetricSummary {
  return {
    mean: average(values),
    count: values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).length,
  }
}

export function getNumber(record: DailyRecord | undefined, field: string): number | null {
  const value = record?.answers[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isPeriodStart(record: DailyRecord | undefined): boolean {
  return record?.answers.periodStart === 'yes'
}

export function getAcneObservation(record: DailyRecord | undefined): AcneObservation {
  const value = record?.answers.acnePresence
  if (value === 'present') return 'present'
  if (value === 'absent') return 'absent'
  return 'missing'
}

export function getSeason(month: number): Season {
  if (month >= 3 && month <= 5) return '春'
  if (month >= 6 && month <= 8) return '夏'
  if (month >= 9 && month <= 11) return '秋'
  return '冬'
}

export function getSeasonDefinition(season: Season): { name: Season; months: number[]; hint: string } {
  if (season === '春') return { name: '春', months: [3, 4, 5], hint: '3–5 月' }
  if (season === '夏') return { name: '夏', months: [6, 7, 8], hint: '6–8 月' }
  if (season === '秋') return { name: '秋', months: [9, 10, 11], hint: '9–11 月' }
  return { name: '冬', months: [12, 1, 2], hint: '12–2 月' }
}

export function getSeasonMonthsLabel(season: Season): string {
  return season === '冬' ? '1–2 月、12 月' : getSeasonDefinition(season).hint
}

export function recordsForCalendarSeason(
  records: DailyRecord[],
  year: number,
  season: Season,
): DailyRecord[] {
  const definition = getSeasonDefinition(season)
  return records.filter(record => {
    const recordYear = Number(record.recordDate.slice(0, 4))
    const recordMonth = Number(record.recordDate.slice(5, 7))
    return recordYear === year && definition.months.includes(recordMonth)
  })
}

export function buildSeasonalObservation(
  records: DailyRecord[],
  deviceDates: ReadonlySet<string>,
  year: number,
  season: Season,
  yearMood: number | null,
  yearEnergy: number | null,
  yearSleep: number | null,
): SeasonalObservation {
  const definition = getSeasonDefinition(season)
  const seasonRecords = recordsForCalendarSeason(records, year, season)
  const mood = summarizeNumber(seasonRecords.map(record => getNumber(record, 'mood')))
  const energy = summarizeNumber(seasonRecords.map(record => getNumber(record, 'energy')))
  const sleep = summarizeNumber(seasonRecords.map(record => getNumber(record, 'sleepDurationMin')))
  const acneStates = seasonRecords.map(getAcneObservation).filter((state): state is Exclude<AcneObservation, 'missing'> => state !== 'missing')
  const acneDays = acneStates.filter(state => state === 'present').length

  return {
    ...definition,
    records: seasonRecords,
    activeDays: seasonRecords.length,
    recordedDays: seasonRecords.filter(record => record.recordingStatus === 'recorded').length,
    mood,
    energy,
    sleep,
    acneObserved: acneStates.length,
    acneDays,
    acneRate: acneStates.length ? acneDays / acneStates.length : null,
    deviceDays: seasonRecords.filter(record => deviceDates.has(record.recordDate)).length,
    moodDelta: mood.mean == null || yearMood == null ? null : mood.mean - yearMood,
    energyDelta: energy.mean == null || yearEnergy == null ? null : energy.mean - yearEnergy,
    sleepDelta: sleep.mean == null || yearSleep == null ? null : sleep.mean - yearSleep,
  }
}

export function getPeriodStartDates(records: DailyRecord[], referenceDate: string): string[] {
  return records
    .filter(record => record.recordDate <= referenceDate && isPeriodStart(record))
    .map(record => record.recordDate)
    .filter((date, index, all) => all.indexOf(date) === index)
    .sort((a, b) => b.localeCompare(a))
}

export function buildCycleSummary(
  records: DailyRecord[],
  startDate: string,
  nextStartDate: string | null,
  referenceDate: string,
  maxDays = 45,
): CycleSummary {
  const endDate = nextStartDate ? shiftDateKey(nextStartDate, -1) : referenceDate
  const rawLength = dateDiffDays(startDate, endDate) + 1
  const length = Math.max(1, Math.min(maxDays, rawLength))
  const recordMap = new Map(records.map(record => [record.recordDate, record]))

  const rows: CycleRow[] = Array.from({ length }, (_, index) => {
    const day = index + 1
    const dateKey = shiftDateKey(startDate, index)
    const record = recordMap.get(dateKey)
    return {
      day,
      dateKey,
      record,
      mood: getNumber(record, 'mood'),
      energy: getNumber(record, 'energy'),
      sleep: getNumber(record, 'sleepDurationMin'),
      acne: getAcneObservation(record),
    }
  })

  return {
    startDate,
    endDate: shiftDateKey(startDate, length - 1),
    length,
    rows,
    complete: Boolean(nextStartDate),
  }
}

export function buildComparableCycles(
  records: DailyRecord[],
  referenceDate: string,
  maxDays = 45,
): CycleSummary[] {
  const starts = getPeriodStartDates(records, referenceDate)
  return starts.map((startDate, index) => {
    const nextStartDate = index > 0 ? starts[index - 1] : null
    return buildCycleSummary(records, startDate, nextStartDate, referenceDate, maxDays)
  })
}

export function compareCyclesByDay(
  cycles: CycleSummary[],
  maxDays = 45,
): Array<{
  day: number
  mood: number | null
  energy: number | null
  sleep: number | null
  acneRate: number | null
  observedCycles: number
  acneObserved: number
}> {
  const maxDay = cycles.reduce((max, cycle) => Math.max(max, cycle.length), 0)
  return Array.from({ length: Math.min(maxDays, maxDay) }, (_, index) => {
    const day = index + 1
    const rows = cycles
      .map(cycle => cycle.rows.find(row => row.day === day))
      .filter((row): row is CycleRow => Boolean(row))
    const acneObserved = rows.filter(row => row.acne !== 'missing')
    const acneDays = acneObserved.filter(row => row.acne === 'present').length
    return {
      day,
      mood: average(rows.map(row => row.mood)),
      energy: average(rows.map(row => row.energy)),
      sleep: average(rows.map(row => row.sleep)),
      acneRate: acneObserved.length ? acneDays / acneObserved.length : null,
      observedCycles: rows.filter(row => Boolean(row.record)).length,
      acneObserved: acneObserved.length,
    }
  })
}
