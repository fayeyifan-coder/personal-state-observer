import { FIELD_MAP, OPTIONAL_QUESTIONS, QUESTIONS } from '../data/questions'
import { matchesGroup } from './conditionEvaluator'
import type { CoreQuestion, Question } from '../types'

const questionList: CoreQuestion[] = QUESTIONS
const allQuestions: Question[] = [...QUESTIONS, ...OPTIONAL_QUESTIONS]

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
  answers: Record<string, unknown>
): CoreQuestion[] {
  return questionList.filter(q => q.phaseBreak || isVisible(answers, q))
}

export function getVisibleQuestions(
  answers: Record<string, unknown>,
  questionsBase: CoreQuestion[] = questionList
): CoreQuestion[] {
  return questionsBase.filter(q => isVisible(answers, q))
}

export function getNextQuestion(
  answers: Record<string, unknown>,
  currentId: string | null
): CoreQuestion | null {
  const visible = visibleQuestions(answers).filter(q => !q.phaseBreak)
  const index = currentId ? visible.findIndex(q => q.id === currentId) : -1
  return visible[index + 1] ?? null
}

export function getPreviousQuestion(
  answers: Record<string, unknown>,
  currentId: string | null
): CoreQuestion | null {
  const visible = visibleQuestions(answers).filter(q => !q.phaseBreak)
  const index = visible.findIndex(q => q.id === currentId)
  return index > 0 ? visible[index - 1] : null
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
