import type { AppBackup, DailyRecord, DeviceDailyData, PeriodLabel } from '../types'

type BackupCollections = Pick<AppBackup, 'dailyRecords' | 'periodLabels' | 'deviceData'>

export type CollectionComparison = {
  /** Only present on the device which is currently being inspected. */
  localOnly: string[]
  /** Only present in the backup the user is considering importing. */
  incomingOnly: string[]
  identical: string[]
  /** Same logical identity, different contents; no winner is inferred. */
  conflicts: string[]
  duplicateLocalKeys: string[]
  duplicateIncomingKeys: string[]
}

export type BackupComparison = {
  dailyRecords: CollectionComparison
  periodLabels: CollectionComparison
  deviceData: CollectionComparison
}

/** Compare JSON-like backup entities without relying on object property insertion order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

function indexBy<T>(items: readonly T[], identity: (item: T) => string) {
  const indexed = new Map<string, T>()
  const duplicates = new Set<string>()
  for (const item of items) {
    const key = identity(item)
    if (indexed.has(key)) duplicates.add(key)
    else indexed.set(key, item)
  }
  return { indexed, duplicates }
}

function compareCollection<T>(
  local: readonly T[],
  incoming: readonly T[],
  identity: (item: T) => string
): CollectionComparison {
  const left = indexBy(local, identity)
  const right = indexBy(incoming, identity)
  const result: CollectionComparison = {
    localOnly: [], incomingOnly: [], identical: [], conflicts: [],
    duplicateLocalKeys: [...left.duplicates].sort(),
    duplicateIncomingKeys: [...right.duplicates].sort()
  }

  for (const [key, item] of left.indexed) {
    if (left.duplicates.has(key) || right.duplicates.has(key)) continue
    if (!right.indexed.has(key)) result.localOnly.push(key)
    else if (stableJson(item) === stableJson(right.indexed.get(key))) result.identical.push(key)
    else result.conflicts.push(key)
  }
  for (const key of right.indexed.keys()) {
    if (left.duplicates.has(key) || right.duplicates.has(key)) continue
    if (!left.indexed.has(key)) result.incomingOnly.push(key)
  }
  result.localOnly.sort()
  result.incomingOnly.sort()
  result.identical.sort()
  result.conflicts.sort()
  return result
}

/**
 * Read-only preview. This function does NOT merge, restore, upload or delete data.
 * It also does not assign precedence to updatedAt or the importing device.
 * An entry's logical key is its date, except PeriodLabel which uses its stable id.
 */
export function compareBackupCollections(
  local: BackupCollections,
  incoming: BackupCollections
): BackupComparison {
  return {
    dailyRecords: compareCollection<DailyRecord>(
      local.dailyRecords, incoming.dailyRecords, record => record.recordDate
    ),
    periodLabels: compareCollection<PeriodLabel>(
      local.periodLabels, incoming.periodLabels, label => label.id
    ),
    deviceData: compareCollection<DeviceDailyData>(
      local.deviceData ?? [], incoming.deviceData ?? [], day => day.recordDate
    )
  }
}
