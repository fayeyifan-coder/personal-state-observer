import {
  average,
  buildComparableCycles,
  buildSeasonalObservation,
  compareCyclesByDay,
  dateDiffDays,
  getAcneObservation,
  getSeason,
  getSeasonMonthsLabel,
  isPeriodStart,
  recordsForCalendarSeason,
  shiftDateKey,
} from '../src/logic/analysis'
import type { DailyRecord } from '../src/types'

declare const process: { exitCode?: number }

function assert(condition: boolean, message: string): void {
  if (condition) console.log(`[PASS] ${message}`)
  else {
    console.error(`[FAIL] ${message}`)
    process.exitCode = 1
  }
}

function record(date: string, answers: Record<string, unknown>): DailyRecord {
  return {
    id: `day_${date}`,
    recordDate: date,
    recordingStatus: 'recorded',
    startedAt: null,
    completedAt: null,
    optedOutAt: null,
    updatedAt: `${date}T12:00:00.000Z`,
    currentPhase: null,
    lastQuestionId: null,
    answers,
  }
}

console.log('Running Analysis Tests...\n')

assert(average([1, null, 3, undefined]) === 2, 'average ignores missing values')
assert(average([null, undefined]) === null, 'average returns null when no numeric values exist')
assert(dateDiffDays('2026-10-01', '2026-10-08') === 7, 'date difference is calendar-day based')
assert(shiftDateKey('2026-10-31', 1) === '2026-11-01', 'date shifting crosses month boundaries correctly')
assert(shiftDateKey('2027-01-01', -1) === '2026-12-31', 'date shifting crosses year boundaries correctly')

assert(getSeason(3) === '春', 'March is spring')
assert(getSeason(6) === '夏', 'June is summer')
assert(getSeason(9) === '秋', 'September is autumn')
assert(getSeason(12) === '冬', 'December is winter')
assert(getSeasonMonthsLabel('冬') === '1–2 月、12 月', 'winter month label crosses calendar year without pretending continuity')

const acneMissing = record('2026-10-01', {})
const acneAbsent = record('2026-10-02', { acnePresence: 'absent' })
const acnePresent = record('2026-10-03', { acnePresence: 'present' })
assert(getAcneObservation(acneMissing) === 'missing', 'missing acne answer stays missing')
assert(getAcneObservation(acneAbsent) === 'absent', 'explicit acne absence is preserved')
assert(getAcneObservation(acnePresent) === 'present', 'explicit acne presence is preserved')

const cycleRecords = [
  record('2026-09-28', { periodStart: 'yes' }),
  record('2026-09-29', { mood: 2, acnePresence: 'absent' }),
  record('2026-09-30', { mood: 4, acnePresence: 'present' }),
  record('2026-10-01', { mood: 3 }),
  record('2026-10-26', { periodStart: 'yes' }),
  record('2026-10-27', { mood: 5, acnePresence: 'present' }),
]

assert(isPeriodStart(cycleRecords[0]), 'period start marker is detected')
const cycles = buildComparableCycles(cycleRecords, '2026-10-28')
assert(cycles.length === 2, 'two period starts produce two comparable cycles')
assert(cycles[0].startDate === '2026-10-26', 'latest cycle is first when sorted descending')
assert(cycles[0].complete === false, 'latest cycle is incomplete until the next start is observed')
assert(cycles[1].startDate === '2026-09-28', 'previous cycle is retained for comparison')
assert(cycles[1].endDate === '2026-10-25', 'cycle end is the day before the next cycle start')
assert(cycles[1].rows[0].day === 1 && cycles[1].rows[0].dateKey === '2026-09-28', 'cycle day 1 is aligned to its start date')
assert(cycles[1].rows[2].dateKey === '2026-09-30', 'cycle days cross month boundaries correctly')

const comparison = compareCyclesByDay(cycles)
const day2 = comparison.find(row => row.day === 2)
assert(day2?.mood === 3.5, 'cycle day comparison averages available mood values')
assert(day2?.acneRate === 0.5, 'cycle day acne rate excludes missing observations')
assert(day2?.acneObserved === 2, 'cycle day acne denominator counts explicit observations only')

const seasonalRecords = [
  record('2026-03-01', { mood: 4, energy: 4, sleepDurationMin: 480, acnePresence: 'absent' }),
  record('2026-03-02', { mood: 2, energy: 2, sleepDurationMin: 360 }),
  record('2026-04-01', { mood: 3, energy: 3, sleepDurationMin: 420, acnePresence: 'present' }),
  record('2026-12-01', { mood: 5, energy: 5, sleepDurationMin: 540, acnePresence: 'present' }),
  record('2026-01-01', { mood: 1, energy: 1, sleepDurationMin: 300, acnePresence: 'absent' }),
]

const spring = recordsForCalendarSeason(seasonalRecords, 2026, '春')
const winter = recordsForCalendarSeason(seasonalRecords, 2026, '冬')
assert(spring.length === 3, 'spring includes March through May within the calendar year')
assert(winter.length === 2, 'winter includes January, February, and December within the calendar year')

const springStats = buildSeasonalObservation(
  seasonalRecords,
  new Set(['2026-03-01', '2026-12-01']),
  2026,
  '春',
  average(seasonalRecords.map(item => typeof item.answers.mood === 'number' ? item.answers.mood : null)),
  average(seasonalRecords.map(item => typeof item.answers.energy === 'number' ? item.answers.energy : null)),
  average(seasonalRecords.map(item => typeof item.answers.sleepDurationMin === 'number' ? item.answers.sleepDurationMin : null)),
)
assert(springStats.mood.count === 3, 'seasonal mood count reflects only numeric observations')
assert(springStats.acneObserved === 2, 'seasonal acne denominator excludes missing answers')
assert(springStats.acneDays === 1, 'seasonal acne numerator counts explicit presence')
assert(springStats.acneRate === 0.5, 'seasonal acne rate uses explicit observations as denominator')
assert(springStats.deviceDays === 1, 'seasonal device coverage counts matching dates')

console.log('\nAnalysis Tests Completed.')
