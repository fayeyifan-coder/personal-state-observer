const fs = require('fs');
const vm = require('vm');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('./questions.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('./question-engine.js', 'utf8'), context);
const { QUESTIONS, FIELD_MAP } = context.window.StateObserverQuestions;
const E = context.window.StateObserverEngine;

// Structural validation: every non-root question has an explicit mother node, and the hierarchy has no cycles.
assert(E.validateQuestionStructure(QUESTIONS), 'question hierarchy should be valid');
assert(E.getMotherQuestion(QUESTIONS.find(q => q.id === 'night_hunger_relief'), QUESTIONS)?.id === 'night_hunger_intake', 'relief question should belong to intake question');
assert(E.getChildQuestions('sleep_problem', QUESTIONS).map(q => q.id).includes('bedtime_urination_delay'), 'sleep problem should have urination detail as a child question');

function visibleIds(record) {
  return E.visibleQuestions(record, QUESTIONS, FIELD_MAP).filter(q => !q.phaseBreak).map(q => q.id);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertOrder(ids, a, b, msg) { assert(ids.indexOf(a) < ids.indexOf(b), msg); }

// 1. Very good sleep: only duration, no detail branches.
let r = { sleepQuality: 5, sleepDurationMin: 450, sleepProblem: [] };
let ids = visibleIds(r);
assert(ids.includes('sleep_duration_min'), 'good sleep should ask duration');
assert(!ids.includes('sleep_problem'), 'good sleep should not ask sleep problem');
assert(!ids.includes('bedtime_urination_delay'), 'good sleep should not ask bedtime urination');
assert(!ids.includes('night_hunger_event'), 'good sleep should not ask night hunger');
assert(!ids.includes('sleep_onset_reason'), 'good sleep should not ask onset reason');

// 2. Average/bad sleep + urination: branch opens only after the broad problem is selected.
r = { sleepQuality: 3, sleepDurationMin: 390, sleepProblem: ['urination'] };
ids = visibleIds(r);
assert(ids.includes('sleep_problem'), 'average sleep should ask sleep problems');
assert(ids.includes('wake_fatigue'), 'average sleep should ask wake fatigue');
assert(ids.includes('bedtime_urination_delay'), 'urination selection should open bedtime urination detail');
assert(!ids.includes('night_hunger_event'), 'without hunger selection, night hunger stays hidden');

// 3. Onset slow + hunger: do not ask the redundant “what made you unable to sleep?” question.
r = { sleepQuality: 2, sleepProblem: ['onset_slow', 'hunger'] };
ids = visibleIds(r);
assert(!ids.includes('sleep_onset_reason'), 'direct hunger cause should suppress redundant onset-reason question');
assert(ids.includes('night_hunger_event'), 'hunger event should still open');

// 4. Onset slow without a direct cause: onset reason appears.
r = { sleepQuality: 2, sleepProblem: ['onset_slow'] };
ids = visibleIds(r);
assert(ids.includes('sleep_onset_reason'), 'unexplained slow onset should ask for a reason');

// 5. 4am hunger path: event -> intake -> relief.
r = { sleepQuality: 1, sleepDurationMin: 240, sleepProblem: ['hunger'] };
ids = visibleIds(r);
assert(ids.includes('night_hunger_event'), 'hunger selection should open hunger event');
assert(!ids.includes('night_hunger_intake'), 'intake should wait until hunger affected sleep');
r.nightHungerEvent = 3;
ids = visibleIds(r);
assert(ids.includes('night_hunger_intake'), 'strong hunger event should ask intake');
r.nightHungerIntake = 2;
ids = visibleIds(r);
assert(ids.includes('night_hunger_relief'), 'eating should open relief question');

// 6. Parent change collapses all sleep detail branches.
r = { sleepQuality: 1, sleepProblem: ['hunger', 'urination', 'dream_tired'], nightHungerEvent: 3, nightHungerIntake: 2, dreamMemory: 2 };
let before = visibleIds(r);
assert(before.includes('bedtime_urination_delay') && before.includes('night_hunger_event') && before.includes('dream_memory'), 'branches should exist before parent change');
r.sleepQuality = 5;
let after = visibleIds(r);
assert(!after.includes('sleep_problem') && !after.includes('bedtime_urination_delay') && !after.includes('night_hunger_event') && !after.includes('dream_memory'), 'good sleep should collapse branches');

// 7. Optional “today flag” is no longer in the core flow.
assert(!visibleIds({}).includes('today_flag'), 'today flag should be optional, not a core question');

console.log('PASS: question hierarchy + 7 compressed-question scenarios');

// 8. Dream fatigue must never escape its sleep-problem branch.
r = { sleepQuality: 5, sleepProblem: [], dreamMemory: 2 };
ids = visibleIds(r);
assert(!ids.includes('dream_memory') && !ids.includes('dream_fatigue'), 'good sleep must hide dream details');
r = { sleepQuality: 2, sleepProblem: ['dream_tired'], dreamMemory: 2 };
ids = visibleIds(r);
assert(ids.includes('dream_fatigue'), 'dream fatigue should show only inside the relevant branch');

// 9. Bedtime temperature refers to the previous night, not “right now before bed”.
assert(QUESTIONS.find(q => q.id === 'bedtime_temperature_feeling').text.includes('昨晚睡前'), 'bedtime temperature should describe the previous night');

// 10. Optional cycle gateway has no vague dead-end “related discomfort” option.
const cycleGateway = context.window.StateObserverQuestions.OPTIONAL_QUESTIONS.find(q => q.id === 'cycle_gateway');
assert(cycleGateway.options.every(o => o.value !== 'related_discomfort'), 'cycle gateway should avoid a vague dead-end option');

console.log('PASS: question hierarchy + 10 compressed-question scenarios');
