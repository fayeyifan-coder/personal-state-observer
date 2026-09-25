export type Condition = { field: string; op: string; value?: unknown }
export type ConditionGroup = { all?: Condition[]; any?: Condition[] }

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

export function matchesGroup(record: Record<string, unknown>, group?: ConditionGroup | null): boolean {
  if (!group) return true
  const all = group.all ?? []
  const any = group.any ?? []
  const allPass = all.every(c => compare(record[c.field], c.op, c.value))
  const anyPass = any.length === 0 || any.some(c => compare(record[c.field], c.op, c.value))
  return allPass && anyPass
}
