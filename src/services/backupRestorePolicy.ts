import type { AppBackup } from '../types'
import type { BackupComparison, CollectionComparison } from './backupComparison'

type BackupCollections = Pick<AppBackup, 'dailyRecords' | 'periodLabels' | 'deviceData'>
export type RestoreBlockReason = 'local-only' | 'conflicts' | 'duplicate-keys'

function isBlocked(collection: CollectionComparison): boolean {
  return collection.localOnly.length > 0 ||
    collection.conflicts.length > 0 ||
    collection.duplicateLocalKeys.length > 0 ||
    collection.duplicateIncomingKeys.length > 0
}

function hasDuplicatePrimaryIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map(item => item.id)).size !== items.length
}

/**
 * Replacement safety is different from merge safety.
 * A backup with duplicate IndexedDB primary keys could silently discard data
 * even if recordDate/label identity comparisons appeared safe.
 */
export function hasDuplicateBackupIds(incoming: BackupCollections): boolean {
  return hasDuplicatePrimaryIds(incoming.dailyRecords) ||
    hasDuplicatePrimaryIds(incoming.periodLabels) ||
    hasDuplicatePrimaryIds(incoming.deviceData ?? [])
}

/** Only permit a full replacement when no distinct local entity would be lost. */
export function canSafelyReplaceWithBackup(
  comparison: BackupComparison,
  incoming: BackupCollections
): boolean {
  return !isBlocked(comparison.dailyRecords) &&
    !isBlocked(comparison.periodLabels) &&
    !isBlocked(comparison.deviceData) &&
    !hasDuplicateBackupIds(incoming)
}

export function getRestoreBlockReasons(
  comparison: BackupComparison,
  incoming: BackupCollections
): RestoreBlockReason[] {
  const groups = [comparison.dailyRecords, comparison.periodLabels, comparison.deviceData]
  const result: RestoreBlockReason[] = []
  if (groups.some(group => group.localOnly.length > 0)) result.push('local-only')
  if (groups.some(group => group.conflicts.length > 0)) result.push('conflicts')
  if (groups.some(group => group.duplicateLocalKeys.length > 0 || group.duplicateIncomingKeys.length > 0) ||
    hasDuplicateBackupIds(incoming)) result.push('duplicate-keys')
  return result
}
