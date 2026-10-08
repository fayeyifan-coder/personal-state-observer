// src/logic/questionEngine.ts
import { FIELD_MAP, OPTIONAL_QUESTIONS, QUESTIONS } from '../data/questions'
import { matchesGroup } from './conditionEvaluator'
import type { CoreQuestion, ObservationPhase, OptionalQuestion, Question } from '../types'

function normalizeOptionalQuestion(question: OptionalQuestion): CoreQuestion {
  return {
    id: question.id,
    parentId: null,
    phase: question.phase ?? 'morning',
    text: question.label,
    type: question.type,
    options: question.options,
    showWhen: question.showWhen,
    ...(question.unit !== undefined ? { unit: question.unit } : {}),
    ...(question.maxLength !== undefined ? { maxLength: question.maxLength } : {})
  }
}

const questionList: CoreQuestion[] = [
  ...QUESTIONS,
  ...OPTIONAL_QUESTIONS.map(normalizeOptionalQuestion)
]

const allQuestions: Question[] = questionList

type PhaseFilter = ObservationPhase | 'all'

export function getField(questionId: string): string {
  return FIELD_MAP[questionId] ?? questionId
}

export function isVisible(
  answers: Record<string, unknown>,
  question: Question
): boolean {
  return matchesGroup(answers, question.showWhen)
}

export function visibleQuestions(
  answers: Record<string, unknown>,
  phase: PhaseFilter = 'all'
): CoreQuestion[] {
  return questionList.filter(q =>
    !q.phaseBreak &&
    (phase === 'all' || q.phase === phase) &&
    isVisible(answers, q)
  )
}

export function getVisibleQuestions(
  answers: Record<string, unknown>,
  questionsBase: CoreQuestion[] = questionList,
  phase: PhaseFilter = 'all'
): CoreQuestion[] {
  return questionsBase.filter(q =>
    !q.phaseBreak &&
    (phase === 'all' || q.phase === phase) &&
    isVisible(answers, q)
  )
}

export function getNextQuestion(
  answers: Record<string, unknown>,
  currentId: string | null,
  phase: PhaseFilter = 'all'
): CoreQuestion | null {
  const visible = visibleQuestions(answers, phase)
  const index = currentId ? visible.findIndex(q => q.id === currentId) : -1

  return visible[index + 1] ?? null
}

export function getFirstQuestion(
  answers: Record<string, unknown>,
  phase: PhaseFilter = 'all'
): CoreQuestion | null {
  return visibleQuestions(answers, phase).find(question => {
    const value = answers[getField(question.id)]
    return value === undefined || value === null
  }) ?? null
}

export function getPreviousQuestion(
  answers: Record<string, unknown>,
  currentId: string | null,
  phase: PhaseFilter = 'all'
): CoreQuestion | null {
  const visible = visibleQuestions(answers, phase)
  const index = visible.findIndex(q => q.id === currentId)

  return index > 0 ? visible[index - 1] : null
}

export function phaseQuestions(
  phase: ObservationPhase
): CoreQuestion[] {
  return questionList.filter(q => q.phase === phase)
}

export function sanitizeAnswers(
  answers: Record<string, unknown>
): Record<string, unknown> {
  const clean = { ...answers }
  let changed = true

  while (changed) {
    changed = false

    for (const question of allQuestions) {
      const field = getField(question.id)

      if (!(field in clean) || clean[field] === null) continue

      if (!isVisible(clean, question)) {
        clean[field] = null
        changed = true
      }
    }
  }

  return clean
}

export { questionList as QUESTIONS }
