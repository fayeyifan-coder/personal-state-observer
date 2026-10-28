import type { EncryptedBackupV1 } from './encryptedBackup'
import { MAX_ENCRYPTED_BACKUP_FILE_BYTES } from './encryptedBackup'

// No Dexie, no backupRepository, no DOM: safe to import in future Netlify Functions.
export const SYNC_SNAPSHOT_FORMAT = 'personal-state-observer-sync-snapshot' as const
export const SYNC_SNAPSHOT_VERSION = 1 as const

// These are opaque random identifiers, not dates, record titles, or user IDs.
export type SyncSnapshotV1 = {
  format: typeof SYNC_SNAPSHOT_FORMAT
  version: typeof SYNC_SNAPSHOT_VERSION
  snapshotId: string
  parentSnapshotId: string | null
  encrypted: EncryptedBackupV1
}

export type EncryptedSyncLink = {
  format: typeof SYNC_SNAPSHOT_FORMAT
  snapshotId: string
  parentSnapshotId: string | null
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENCRYPTED_FIELDS = [
  'cipher', 'ciphertext', 'format', 'iterations', 'iv', 'kdf', 'salt', 'version'
].sort()
const SNAPSHOT_FIELDS = [
  'encrypted', 'format', 'parentSnapshotId', 'snapshotId', 'version'
].sort()

function assertExactKeys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join('|') !== expected.join('|')) {
    throw new Error('同步文件包含不支持的额外字段，已拒绝。')
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value)
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The server must accept only this encrypted envelope; it never needs
 * the plaintext AppBackup, decryption passphrase, observation dates or names.
 * This is structural validation only, not proof of decryption or integrity.
 */
export function parseSyncSnapshot(value: unknown): SyncSnapshotV1 {
  if (!isObject(value)) throw new Error('同步快照格式不正确。')
  assertExactKeys(value, SNAPSHOT_FIELDS)
  if (value.format !== SYNC_SNAPSHOT_FORMAT || value.version !== 1 ||
    !isUuid(value.snapshotId) ||
    (value.parentSnapshotId !== null && !isUuid(value.parentSnapshotId)) ||
    value.parentSnapshotId === value.snapshotId) {
    throw new Error('同步快照的版本或身份信息不正确。')
  }
  if (!isObject(value.encrypted)) throw new Error('同步快照未加密，已拒绝。')
  assertExactKeys(value.encrypted, ENCRYPTED_FIELDS)
  const encrypted = value.encrypted
  if (encrypted.format !== 'personal-state-observer-encrypted-backup' ||
    encrypted.version !== 1 || encrypted.cipher !== 'AES-256-GCM' ||
    encrypted.kdf !== 'PBKDF2-SHA-256' || encrypted.iterations !== 600000 ||
    typeof encrypted.salt !== 'string' || typeof encrypted.iv !== 'string' ||
    typeof encrypted.ciphertext !== 'string' ||
    encrypted.salt.length !== 24 || encrypted.iv.length !== 16 ||
    encrypted.ciphertext.length < 24 ||
    encrypted.ciphertext.length > MAX_ENCRYPTED_BACKUP_FILE_BYTES ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted.ciphertext) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted.salt) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted.iv)) {
    throw new Error('同步快照的加密格式不正确。')
  }
  return value as SyncSnapshotV1
}

export type IncomingSnapshotDecision =
  | 'same-snapshot'
  | 'candidate-for-preview'
  | 'unverified-history'
  | 'diverged-or-rolled-back'

/**
 * This NEVER approves an automatic restore. 'candidate-for-preview' still
 * requires decrypt, data-diff preview and transactionally guarded import.
 * If local lineage is unknown, we cannot infer recency from clocks.
 */
export function assessIncomingSnapshot(
  locallyConfirmedSnapshotId: string | null,
  candidate: Pick<SyncSnapshotV1, 'snapshotId' | 'parentSnapshotId'>
): IncomingSnapshotDecision {
  if (locallyConfirmedSnapshotId !== null && !isUuid(locallyConfirmedSnapshotId)) {
    throw new Error('本地确认的快照标识无效。')
  }
  if (!isUuid(candidate.snapshotId) ||
    (candidate.parentSnapshotId !== null && !isUuid(candidate.parentSnapshotId))) {
    throw new Error('候选快照标识无效。')
  }
  if (candidate.snapshotId === locallyConfirmedSnapshotId) return 'same-snapshot'
  if (candidate.parentSnapshotId === locallyConfirmedSnapshotId) {
    return 'candidate-for-preview'
  }
  if (locallyConfirmedSnapshotId === null) return 'unverified-history'
  return 'diverged-or-rolled-back'
}

/**
 * Phone side may publish only if it has verified the server's current tip.
 * Final publish must re-check the tip ATOMICALLY in the server's database;
 * this client-side check alone must never be treated as a CAS guarantee.
 */
export function canPreparePublish(
  confirmedPhoneBase: string | null,
  lastFetchedRemoteTip: string | null
): boolean {
  return confirmedPhoneBase === lastFetchedRemoteTip &&
    (confirmedPhoneBase === null || isUuid(confirmedPhoneBase))
}
