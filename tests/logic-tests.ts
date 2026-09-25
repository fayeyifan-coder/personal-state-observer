import { evaluateCondition, evaluateShowWhen } from '../src/logic/conditionEvaluator'
import { getNextQuestion, sanitizeAnswers } from '../src/logic/questionEngine'
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

assert(
  FIELD_MAP.sleep_quality === 'sleepQuality',
  'FIELD_MAP maps sleep_quality to sleepQuality'
)

assert(
  evaluateShowWhen(
    { all: [{ field: 'sleep_quality', op: 'lte', value: 3 }] },
    { sleepQuality: 3 }
  ) === true,
  'sleepQuality=3 makes sleep_problem visible'
)

assert(
  evaluateShowWhen(
    { all: [{ field: 'sleep_quality', op: 'lte', value: 3 }] },
    { sleepQuality: 4 }
  ) === false,
  'sleepQuality=4 hides sleep_problem'
)

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

assert(
  evaluateShowWhen(onsetReasonCondition, {
    sleepQuality: 3,
    sleepProblem: ['onset_slow']
  }) === true,
  'onset_slow without exclusion reasons shows sleep_onset_reason'
)

assert(
  evaluateShowWhen(onsetReasonCondition, {
    sleepQuality: 3,
    sleepProblem: ['onset_slow', 'mind_busy']
  }) === false,
  'mind_busy hides sleep_onset_reason'
)

assert(
  evaluateCondition(
    { field: 'sleep_problem', op: 'notIncludes', value: 'hunger' },
    { sleepProblem: 'not_an_array' }
  ) === false,
  'notIncludes returns false for non-array answers'
)

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
  mood: 4
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
assert(sanitized.mood === 4, 'unrelated branch answer is preserved')

const next = getNextQuestion({ mood: 4 }, 'mood')
assert(next?.id === 'energy', 'getNextQuestion follows the core question order')

const localBoundary = new Date('2023-10-31T23:00:00Z')
assert(
  getLocalDateKey(localBoundary) ===
    `${localBoundary.getFullYear()}-${String(localBoundary.getMonth() + 1).padStart(2, '0')}-${String(localBoundary.getDate()).padStart(2, '0')}`,
  'getLocalDateKey uses local calendar date'
)

const parsed = parseDateKey('2026-09-25')
assert(getLocalDateKey(parsed) === '2026-09-25', 'parseDateKey round-trips a date key locally')
assert(formatDateKey('2026-09-25') === '2026年09月25日', 'formatDateKey formats the date key')

console.log('\nTests Completed.')
