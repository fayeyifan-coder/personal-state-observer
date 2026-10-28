import assert from 'node:assert/strict'
import { FIELD_MAP, OPTIONAL_QUESTIONS } from '../src/data/questions'
import {
  getFirstQuestion, getField, getNextQuestion, getResumeQuestionId,
  getVisibleQuestions, phaseQuestions, sanitizeAnswers
} from '../src/logic/questionEngine'

// All cases are synthetic. No personal JSON is committed to this repository.
const removed = ['basal_temperature_c', 'weight_kg', 'protein_intake_g']
const removedFields = ['basalTemperatureC', 'weightKg', 'proteinIntakeG']
const allIds = [...phaseQuestions('morning'), ...phaseQuestions('evening')]
  .map(question => question.id)
for (const id of removed) {
  assert.equal(allIds.includes(id), false, id + ' must not appear in daily questions')
}
assert.equal(OPTIONAL_QUESTIONS.length, 0, 'removed morning optional measurements')
for (let i = 0; i < removed.length; i++) {
  assert.equal(getField(removed[i]), removedFields[i],
    'legacy field name mapping must remain readable')
  assert.equal(FIELD_MAP[removed[i]], removedFields[i])
}

const oldAnswers = {
  sleepQuality: 5,
  sleepDurationMin: 450,
  bedtimeTemperatureFeeling: 0,
  morningAppetite: 3,
  basalTemperatureC: null,
  weightKg: null,
  proteinIntakeG: null
}
const copy = structuredClone(oldAnswers)
assert.deepEqual(sanitizeAnswers(oldAnswers), oldAnswers,
  'existing answers retain removed fields, even if null')
assert.deepEqual(oldAnswers, copy, 'sanitizing never mutates stored input')

const priorMeasured = { ...oldAnswers,
  basalTemperatureC: 36.4, weightKg: 52, proteinIntakeG: 60
}
assert.deepEqual(sanitizeAnswers(priorMeasured), priorMeasured,
  'if any historic day had valid numeric data, preserve it')

const morning = getVisibleQuestions(oldAnswers, undefined, 'morning')
assert.deepEqual(morning.map(q => q.id), [
  'sleep_quality', 'sleep_duration_min',
  'bedtime_temperature_feeling', 'morning_appetite'
])
assert.equal(getNextQuestion(oldAnswers, 'morning_appetite', 'morning'), null,
  'completing last retained morning question must mark phase finished')
assert.equal(getResumeQuestionId(oldAnswers, 'weight_kg', 'morning'),
  'morning_appetite', 'old completed morning resumes at editable last question')
assert.equal(getResumeQuestionId(oldAnswers, 'basal_temperature_c', 'morning'),
  'morning_appetite')
assert.equal(getResumeQuestionId({
  ...oldAnswers, morningAppetite: undefined
}, 'weight_kg', 'morning'), 'morning_appetite',
'if current questionnaire has an unanswered item, resume there')
assert.equal(getFirstQuestion(oldAnswers, 'morning'), null,
  'historically completed morning has no new compulsory gaps')

// Conditional questions MUST remain: zero observed answers can mean the user
// never met their showWhen condition, not that the question is unused.
const conditional = getVisibleQuestions({
  sleepQuality: 2, sleepDurationMin: 330,
  sleepProblem: ['hunger'],
  nightHungerEvent: 3,
  nightHungerIntake: 1
}, undefined, 'morning')
assert.equal(conditional.some(q => q.id === 'night_hunger_relief'), true)
for (const keep of [
  'mood', 'energy', 'drive', 'acne_presence', 'cycle_gateway',
  'bowel_movement_count', 'today_flag', 'context_events', 'note'
]) assert.ok(allIds.includes(keep), 'existing important question preserved: ' + keep)
const evening = getVisibleQuestions({}, undefined, 'evening')
assert.equal(evening.some(q => q.id === 'protein_intake_g'), false)
assert.ok(evening.some(q => q.id === 'bowel_movement_count'),
  'flow continues directly to bowel count after menstrual questions')

// Old backups can contain retired lastQuestionId. The page must have a valid
// visible fallback even when every retained answer was already recorded.
assert.equal(getResumeQuestionId({}, null, 'morning'), 'sleep_quality')
assert.equal(getResumeQuestionId({ mood: 4 }, 'note', 'evening'), 'note',
  'existing visible last-question IDs still work unchanged')
console.log('[PASS] 3 unused questions hidden; backup field names/history kept; legacy edit and conditional paths work')
