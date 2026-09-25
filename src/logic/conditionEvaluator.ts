import { FIELD_MAP } from '../data/questions'
import type { Condition, ShowWhen } from '../types'

export function compare(actual: unknown, op: string, expected?: unknown): boolean {
  if (op === 'exists') return actual !== null && actual !== undefined
  if (op === 'eq') return actual === expected
  if (op === 'neq') return actual !== expected
  if (op === 'includes') return Array.isArray(actual) && actual.includes(expected)
  if (op === 'notIncludes') return Array.isArray(actual) && !actual.includes(expected)
  if (actual === null || actual === undefined) return false

  const a = Number(actual)
  const b = Number(expected)
  if (Number.isNaN(a) || Number.isNaN(b)) return false

  if (op === 'gt') return a > b
  if (op === 'gte') return a >= b
  if (op === 'lt') return a < b
  if (op === 'lte') return a <= b
  return false
}

export function evaluateCondition(
  condition: Condition,
  answers: Record<string, unknown>
): boolean {
  const mappedField = FIELD_MAP[condition.field] ?? condition.field
  return compare(answers[mappedField], condition.op, condition.value)
}

export function matchesGroup(
  answers: Record<string, unknown>,
  group?: ShowWhen | null
): boolean {
  if (!group) return true

  const all = group.all ?? []
  const any = group.any ?? []
  const allPass = all.every(condition => evaluateCondition(condition, answers))
  const anyPass = any.length === 0 || any.some(condition => evaluateCondition(condition, answers))

  return allPass && anyPass
}

export function evaluateShowWhen(
  showWhen: ShowWhen | undefined,
  answers: Record<string, unknown>
): boolean {
  return matchesGroup(answers, showWhen)
}
