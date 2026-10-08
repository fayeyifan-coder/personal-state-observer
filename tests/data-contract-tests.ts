import { QUESTIONS, OPTIONAL_QUESTIONS, FIELD_MAP, OPTIONS } from '../src/data/questions'
import type { CoreQuestion, OptionalQuestion } from '../src/types'

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`[PASS] ${message}`)
  } else {
    console.error(`[FAIL] ${message}`)
    process.exitCode = 1
  }
}

function getQuestion(id: string): CoreQuestion | OptionalQuestion | undefined {
  return [...QUESTIONS, ...OPTIONAL_QUESTIONS].find(question => question.id === id)
}

function assertPhase(questionId: string, expectedPhase: string): void {
  const question = getQuestion(questionId)
  assert(
    question?.phase === expectedPhase ||
      (question?.phase === undefined && expectedPhase === 'optional'),
    `${questionId} belongs to ${expectedPhase} observation`
  )
}

console.log('Running Data Contract Tests...\n')

const allQuestions = [...QUESTIONS, ...OPTIONAL_QUESTIONS]
const ids = allQuestions.map(question => question.id)

assert(new Set(ids).size === ids.length, 'question IDs are unique')
assert(allQuestions.length === 40, 'question model contains 40 questions')

const invalidPhases = QUESTIONS.filter(
  question => question.phase !== 'morning' && question.phase !== 'evening'
)
assert(
  invalidPhases.length === 0,
  'every core question belongs to exactly one observation phase'
)

assert(QUESTIONS[0]?.id === 'sleep_quality', 'morning observation starts with sleep quality')

assertPhase('mood', 'evening')
assertPhase('acne_presence', 'evening')
assertPhase('bowel_movement_count', 'evening')
assertPhase('protein_intake_g', 'evening')
assertPhase('basal_temperature_c', 'morning')
assertPhase('period_start', 'evening')

// These fields intentionally use their canonical camelCase storage keys as question IDs.
// They do not need a snake_case entry in FIELD_MAP.
const canonicalFields = ['mood', 'energy', 'drive'] as const
for (const field of canonicalFields) {
  assert(
    (FIELD_MAP[field] ?? field) === field,
    `canonical field resolves ${field}`
  )
}

const requiredMappedFields = [
  'sleep_quality',
  'sleep_duration_min',
  'sleep_problem',
  'sleep_onset_reason',
  'wake_fatigue',
  'dream_memory',
  'dream_fatigue',
  'bedtime_urination_delay',
  'night_hunger_event',
  'night_hunger_intake',
  'night_hunger_relief',
  'bedtime_temperature_feeling',
  'morning_appetite',
  'previous_evening_fullness',
  'nap_duration_min',
  'nap_quality',
  'bedtime_hunger',
  'physical_discomfort',
  'discomfort_area',
  'libido',
  'acne_presence',
  'acne_severity',
  'acne_cyst',
  'acne_locations',
  'cycle_gateway',
  'bleeding_level',
  'period_start',
  'discharge_amount',
  'discharge_character',
  'protein_intake_g',
  'bowel_movement_count',
  'bowel_form',
  'today_flag',
  'context_events',
  'note',
  'basal_temperature_c',
  'weight_kg'
] as const

for (const field of requiredMappedFields) {
  assert(
    typeof FIELD_MAP[field] === 'string' && FIELD_MAP[field].length > 0,
    `field map resolves ${field}`
  )
}

const expectedMappings: Record<string, string> = {
  period_start: 'periodStart',
  acne_presence: 'acnePresence',
  bowel_movement_count: 'bowelMovementCount',
  protein_intake_g: 'proteinIntakeG',
  basal_temperature_c: 'basalTemperatureC',
  weight_kg: 'weightKg'
}

for (const [questionId, fieldName] of Object.entries(expectedMappings)) {
  assert(
    FIELD_MAP[questionId] === fieldName,
    `${questionId} maps to ${fieldName}`
  )
}

for (const [key, options] of Object.entries(OPTIONS)) {
  const values = options.map(option => String(option.value))
  assert(
    new Set(values).size === values.length,
    `option values are unique for ${key}`
  )
}

assert(OPTIONS.periodStart !== undefined && OPTIONS.periodStart.length > 0, 'period_start has options')
assert(OPTIONS.acnePresence !== undefined && OPTIONS.acnePresence.length > 0, 'acne_presence has options')
assert(OPTIONS.acneSeverity !== undefined && OPTIONS.acneSeverity.length > 0, 'acne_severity has options')
assert(OPTIONS.acneCyst !== undefined && OPTIONS.acneCyst.length > 0, 'acne_cyst has options')
assert(OPTIONS.acneLocations !== undefined && OPTIONS.acneLocations.length > 0, 'acne_locations has options')
assert(OPTIONS.bowelCount !== undefined && OPTIONS.bowelCount.length > 0, 'bowel_count has options')
assert(OPTIONS.bowelForm !== undefined && OPTIONS.bowelForm.length > 0, 'bowel_form has options')

console.log('\nData Contract Tests Completed.')
