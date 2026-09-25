import { FIELD_MAP, QUESTIONS } from '../data/questions'
import { matchesGroup } from './conditionEvaluator'

export type Question = {
  id: string
  parentId?: string | null
  phase?: string
  phaseBreak?: boolean
  showWhen?: { all?: { field: string; op: string; value?: unknown }[]; any?: { field: string; op: string; value?: unknown }[] }
  [key: string]: unknown
}

const questionList = QUESTIONS as Question[]

export function getField(questionId: string) {
  return (FIELD_MAP as Record<string, string>)[questionId] ?? questionId
}

export function isVisible(answers: Record<string, unknown>, question: Question) {
  return matchesGroup(answers, question.showWhen)
}

export function visibleQuestions(answers: Record<string, unknown>) {
  return questionList.filter(q => q.phaseBreak || isVisible(answers, q))
}

export function getNextQuestion(answers: Record<string, unknown>, currentId: string | null) {
  const visible = visibleQuestions(answers).filter(q => !q.phaseBreak)
  const index = currentId ? visible.findIndex(q => q.id === currentId) : -1
  return visible[index + 1] ?? null
}

export function getPreviousQuestion(answers: Record<string, unknown>, currentId: string | null) {
  const visible = visibleQuestions(answers).filter(q => !q.phaseBreak)
  const index = visible.findIndex(q => q.id === currentId)
  return index > 0 ? visible[index - 1] : null
}

export function sanitizeAnswers(answers: Record<string, unknown>) {
  const clean = { ...answers }
  for (const q of questionList) {
    if (!isVisible(clean, q) && q.id in clean) delete clean[getField(q.id)]
  }
  return clean
}

export { questionList as QUESTIONS }
