import type { BackupComparison, CollectionComparison } from './backupComparison'

export type RestoreBlockReason = 'local-only' | 'conflicts' | 'duplicate-keys'

function isBlocked(collection: CollectionComparison): boolean {
  return collection.localOnly.length > 0 ||
    collection.conflicts.length > 0 ||
    collection.duplicateLocalKeys.length > 0 ||
    collection.duplicateIncomingKeys.length > 0
}

/**
 * This is a conservative *replacement* policy, not a merging strategy:
 * a replacement is allowed only if it would lose no distinct local entities.
 */
export function canSafelyReplaceWithBackup(comparison: BackupComparison): boolean {
  return !isBlocked(comparison.dailyRecords) &&
    !isBlocked(comparison.periodLabels) &&
    !isBlocked(comparison.deviceData)
}

export function getRestoreBlockReasons(comparison: BackupComparison): RestoreBlockReason[] {
  const groups = [comparison.dailyRecords, comparison.periodLabels, comparison.deviceData]
  const result: RestoreBlockReason[] = []
  if (groups.some(group => group.localOnly.length > 0)) result.push('local-only')
  if (groups.some(group => group.conflicts.length > 0)) result.push('conflicts')
  if (groups.some(group => group.duplicateLocalKeys.length > 0 || group.duplicateIncomingKeys.length > 0)) result.push('duplicate-keys')
  return result
}
