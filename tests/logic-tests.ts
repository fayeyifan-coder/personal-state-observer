import { evaluateCondition, evaluateShowWhen } from '../src/logic/conditionEvaluator'
import {
  getNextQuestion,
  getVisibleQuestions,
  phaseQuestions,
  sanitizeAnswers,
  QUESTIONS,
} from '../src/logic/questionEngine'
import { FIELD_MAP } from '../src/data/questions'
import { getLocalDateKey, formatDateKey, parseDateKey } from '../src/utils/dateUtils'

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`[PASS] ${message}`)
  } else {
    console.error(`[FAIL] ${message}`)
    process.exitCode = 1
  }
}

console.log('Running Logic Engine Tests...\n')

assert(FIELD_MAP.sleep_quality === 'sleepQuality', 'FIELD_MAP maps sleep_quality to sleepQuality')
assert(evaluateShowWhen({ all: [{ field: 'sleep_quality', op: 'lte', value: 3 }] }, { sleepQuality: 3 }) === true, 'sleepQuality=3 makes sleep_problem visible')
assert(evaluateShowWhen({ all: [{ field: 'sleep_quality', op: 'lte', value: 3 }] }, { sleepQuality: 4 }) === false, 'sleepQuality=4 hides sleep_problem')

const onsetReasonCondition = {
  all: [
    { field: 'sleep_quality', op: 'lte' as const, value: 3 },
    { field: 'sleep_problem', op: 'includes' as const, value: 'onset_slow' },
    { field: 'sleep_problem', op: 'notIncludes' as const, value: 'hunger' },
    { field: 'sleep_problem', op: 'notIncludes' as const, value: 'urination' },
    { field: 'sleep_problem', op: 'notIncludes' as const, value: 'physical' },
    { field: 'sleep_problem', op: 'notIncludes' as const, value: 'mind_busy' }
  ]
}

assert(evaluateShowWhen(onsetReasonCondition, { sleepQuality: 3, sleepProblem: ['onset_slow'] }) === true, 'onset_slow without exclusion reasons shows sleep_onset_reason')
assert(evaluateShowWhen(onsetReasonCondition, { sleepQuality: 3, sleepProblem: ['onset_slow', 'mind_busy'] }) === false, 'mind_busy hides sleep_onset_reason')
assert(evaluateCondition({ field: 'sleep_problem', op: 'notIncludes', value: 'hunger' }, { sleepProblem: 'not_an_array' }) === false, 'notIncludes returns false for non-array answers')

const dirtyAnswers = {
  sleepQuality: 4,
  sleepDurationMin: 450,
  sleepProblem: ['onset_slow'],
  sleepOnsetReason: 'caffeine',
  wakeFatigue: 4,
  dreamMemory: 2,
  dreamFatigue: 1,
  nightHungerEvent: 2,
  nightHungerIntake: 1,
  nightHungerRelief: 1,
  mood: 4,
  acneSeverity: 'moderate',
  acneCyst: 'present',
  acneLocations: ['cheeks'],
  bowelForm: 4
}

const sanitized = sanitizeAnswers(dirtyAnswers)
assert(sanitized.sleepQuality === 4, 'valid mother answer is preserved')
assert(sanitized.sleepDurationMin === 450, 'visible child answer is preserved')
assert(sanitized.sleepProblem === null, 'hidden sleepProblem is cleared to null')
assert(sanitized.sleepOnsetReason === null, 'hidden sleepOnsetReason is cleared to null')
assert(sanitized.wakeFatigue === null, 'hidden wakeFatigue is cleared to null')
assert(sanitized.dreamMemory === null, 'hidden dreamMemory is cleared to null')
assert(sanitized.dreamFatigue === null, 'cascaded hidden dreamFatigue is cleared to null')
assert(sanitized.nightHungerEvent === null, 'hidden nightHungerEvent is cleared to null')
assert(sanitized.nightHungerIntake === null, 'cascaded hidden nightHungerIntake is cleared to null')
assert(sanitized.nightHungerRelief === null, 'cascaded hidden nightHungerRelief is cleared to null')
assert(sanitized.acneSeverity === null, 'hidden acneSeverity is cleared when acne is absent')
assert(sanitized.acneCyst === null, 'hidden acneCyst is cleared when acne is absent')
assert(sanitized.acneLocations === null, 'hidden acneLocations is cleared when acne is absent')
assert(sanitized.bowelForm === null, 'hidden bowelForm is cleared when bowel count is absent')
assert(sanitized.mood === 4, 'unrelated branch answer is preserved')

assert(getNextQuestion({ sleepQuality: 4 }, 'sleep_quality', 'morning')?.id === 'sleep_duration_min', 'morning flow follows sleep_quality → sleep_duration_min')
assert(getNextQuestion({ bedtimeTemperatureFeeling: 0 }, 'bedtime_temperature_feeling', 'morning')?.id === 'morning_appetite', 'morning flow continues into morning appetite')
assert(getNextQuestion({}, 'sleep_problem', 'evening')?.id === 'mood', 'evening flow starts with mood')

const localBoundary = new Date('2023-10-31T23:00:00Z')
assert(
  getLocalDateKey(localBoundary) ===
    `${localBoundary.getFullYear()}-${String(localBoundary.getMonth() + 1).padStart(2, '0')}-${String(localBoundary.getDate()).padStart(2, '0')}`,
  'getLocalDateKey uses local calendar date'
)

const parsed = parseDateKey('2026-09-25')
assert(getLocalDateKey(parsed) === '2026-09-25', 'parseDateKey round-trips a date key locally')
assert(formatDateKey('2026-09-25') === '2026年09月25日', 'formatDateKey formats the date key')

assert(QUESTIONS.length === 40, 'unified question flow contains 40 questions')
assert(QUESTIONS[0]?.id === 'sleep_quality', 'unified question flow starts with morning sleep observation')
assert(QUESTIONS[0]?.phase === 'morning', 'first question belongs to morning observation')
assert(QUESTIONS.some(q => q.id === 'mood' && q.phase === 'evening'), 'mood belongs to evening observation')
assert(QUESTIONS.some(q => q.id === 'acne_presence' && q.phase === 'evening'), 'acne belongs to evening observation')
assert(QUESTIONS.some(q => q.id === 'bowel_movement_count' && q.phase === 'evening'), 'bowel count belongs to evening observation')
assert(QUESTIONS.some(q => q.id === 'protein_intake_g' && q.phase === 'evening'), 'protein intake belongs to evening observation')
assert(QUESTIONS.some(q => q.id === 'basal_temperature_c' && q.phase === 'morning'), 'basal temperature belongs to morning observation')
assert(QUESTIONS.some(q => q.id === 'period_start' && q.phase === 'evening'), 'period start marker belongs to evening observation')

const morning = phaseQuestions('morning')
const evening = phaseQuestions('evening')
assert(morning.length + evening.length === QUESTIONS.length, 'every question belongs to exactly one observation phase')
assert(morning[0]?.id === 'sleep_quality', 'morning phase begins with sleep quality')
assert(evening[0]?.id === 'mood', 'evening phase begins with mood')

const visibleCycle = getVisibleQuestions({ cycleGateway: 'bleeding' }, undefined, 'evening')
assert(visibleCycle.some(q => q.id === 'bleeding_level'), 'bleeding_level is visible for bleeding gateway')
assert(!visibleCycle.some(q => q.id === 'discharge_amount'), 'discharge_amount is hidden for bleeding gateway')

const visibleDiscomfort = getVisibleQuestions({ physicalDiscomfort: 3 }, undefined, 'evening')
assert(visibleDiscomfort.some(q => q.id === 'discomfort_area'), 'discomfort_area is visible when physical discomfort is high')

const visibleAcne = getVisibleQuestions({ acnePresence: 'present' }, undefined, 'evening')
assert(visibleAcne.some(q => q.id === 'acne_severity'), 'acne_severity is visible when acne is present')
assert(visibleAcne.some(q => q.id === 'acne_cyst'), 'acne_cyst is visible when acne is present')
assert(visibleAcne.some(q => q.id === 'acne_locations'), 'acne_locations is visible when acne is present')

const visibleBowel = getVisibleQuestions({ bowelMovementCount: 1 }, undefined, 'evening')
assert(visibleBowel.some(q => q.id === 'bowel_form'), 'bowel_form is visible when bowel count is greater than 0')

const numberAnswers = sanitizeAnswers({ basalTemperatureC: 36.5, weightKg: 57.2 })
assert(numberAnswers.basalTemperatureC === 36.5, 'basal temperature number answer is preserved')
assert(numberAnswers.weightKg === 57.2, 'weight number answer is preserved')

console.log('\nTests Completed.')
