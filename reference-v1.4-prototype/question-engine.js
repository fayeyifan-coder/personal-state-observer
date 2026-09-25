(function () {
  'use strict';

  function readValue(record, fieldMap, field) {
    const key = fieldMap[field] || field;
    return record[key];
  }

  function compare(actual, op, expected) {
    if (op === 'exists') return actual !== null && actual !== undefined;
    if (op === 'eq') return actual === expected;
    if (op === 'neq') return actual !== expected;
    if (op === 'includes') return Array.isArray(actual) && actual.includes(expected);
    if (op === 'notIncludes') return Array.isArray(actual) && !actual.includes(expected);
    if (actual === null || actual === undefined) return false;

    const a = Number(actual);
    const b = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;

    if (op === 'gt') return a > b;
    if (op === 'gte') return a >= b;
    if (op === 'lt') return a < b;
    if (op === 'lte') return a <= b;
    return false;
  }


  function validateQuestionStructure(questions) {
    const ids = new Set();
    const byId = new Map();
    for (const q of questions) {
      if (!q.id) throw new Error('question missing id');
      if (ids.has(q.id)) throw new Error(`duplicate question id: ${q.id}`);
      ids.add(q.id);
      byId.set(q.id, q);
    }
    for (const q of questions) {
      if (q.phaseBreak) continue;
      if (q.parentId == null) continue;
      if (!byId.has(q.parentId)) throw new Error(`missing mother node: ${q.id} -> ${q.parentId}`);
      if (q.parentId === q.id) throw new Error(`self-referencing question: ${q.id}`);

      const seen = new Set([q.id]);
      let current = q;
      while (current.parentId != null) {
        if (seen.has(current.parentId)) throw new Error(`question hierarchy cycle at: ${q.id}`);
        seen.add(current.parentId);
        current = byId.get(current.parentId);
        if (!current) throw new Error(`broken question hierarchy at: ${q.id}`);
      }
    }
    return true;
  }

  function getMotherQuestion(question, questions) {
    if (!question || question.parentId == null) return null;
    return questions.find(q => q.id === question.parentId) || null;
  }

  function getChildQuestions(questionId, questions) {
    return questions.filter(q => q.parentId === questionId);
  }

  function matchesGroup(record, fieldMap, group) {
    if (!group) return true;
    const all = group.all || [];
    const any = group.any || [];
    const allPass = all.every(c => compare(readValue(record, fieldMap, c.field), c.op, c.value));
    const anyPass = any.length === 0 || any.some(c => compare(readValue(record, fieldMap, c.field), c.op, c.value));
    return allPass && anyPass;
  }

  function isVisible(record, fieldMap, question) {
    return matchesGroup(record, fieldMap, question.showWhen);
  }

  function visibleQuestions(record, questions, fieldMap) {
    return questions.filter(q => q.phaseBreak || isVisible(record, fieldMap, q));
  }

  function getField(question, fieldMap) {
    return fieldMap[question.id] || question.id;
  }

  function getNext(record, currentId, questions, fieldMap) {
    const visible = visibleQuestions(record, questions, fieldMap);
    const start = currentId == null ? -1 : visible.findIndex(q => q.id === currentId);
    for (let i = start + 1; i < visible.length; i++) {
      if (!visible[i].phaseBreak) return visible[i];
    }
    return null;
  }

  function getPrevious(record, currentId, questions, fieldMap) {
    const visible = visibleQuestions(record, questions, fieldMap);
    const start = visible.findIndex(q => q.id === currentId);
    for (let i = start - 1; i >= 0; i--) {
      if (!visible[i].phaseBreak) return visible[i];
    }
    return null;
  }

  function getNextIncludingPhase(record, currentId, questions, fieldMap) {
    const visible = visibleQuestions(record, questions, fieldMap);
    const start = currentId == null ? -1 : visible.findIndex(q => q.id === currentId);
    for (let i = start + 1; i < visible.length; i++) return visible[i];
    return null;
  }

  function progress(record, currentId, questions, fieldMap) {
    const visible = visibleQuestions(record, questions, fieldMap).filter(q => !q.phaseBreak);
    const index = visible.findIndex(q => q.id === currentId);
    return { position: index < 0 ? 1 : index + 1, total: visible.length };
  }

  window.StateObserverEngine = {
    compare,
    matchesGroup,
    validateQuestionStructure,
    getMotherQuestion,
    getChildQuestions,
    isVisible,
    visibleQuestions,
    getField,
    getNext,
    getPrevious,
    getNextIncludingPhase,
    progress
  };
})();
