import type { AppBackup } from '../types'
import { parseBackup } from './backup'
import {
  encryptBackup,
  decryptBackup,
  MAX_ENCRYPTED_BACKUP_FILE_BYTES,
  type EncryptedBackupV1
} from './encryptedBackup'

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

type EncryptedSyncLink = {
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

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
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

/**
 * Creates an encrypted, opaque snapshot. The parent linkage is also inside
 * the authenticated ciphertext. A server cannot rewrite the chain without
 * decryption being rejected on the receiving device.
 */
export async function createEncryptedSyncSnapshot(
  backup: AppBackup,
  passphrase: string,
  parentSnapshotId: string | null
): Promise<SyncSnapshotV1> {
  if (parentSnapshotId !== null && !isUuid(parentSnapshotId)) {
    throw new Error('上一次已确认的快照标识不正确。')
  }
  const snapshotId = crypto.randomUUID()
  const syncLink: EncryptedSyncLink = {
    format: SYNC_SNAPSHOT_FORMAT, snapshotId, parentSnapshotId
  }
  const taggedBackup = { ...backup, syncLink }
  const encrypted = await encryptBackup(taggedBackup as AppBackup, passphrase)
  return parseSyncSnapshot({
    format: SYNC_SNAPSHOT_FORMAT,
    version: SYNC_SNAPSHOT_VERSION,
    snapshotId,
    parentSnapshotId,
    encrypted
  })
}

/** Always decrypt and validate the bound chain before comparing local records. */
export async function decryptAndVerifySyncSnapshot(
  candidate: unknown,
  passphrase: string
): Promise<AppBackup> {
  const snapshot = parseSyncSnapshot(candidate)
  const plaintext = await decryptBackup(snapshot.encrypted, passphrase)
  if (!isObject(plaintext) || !isObject(plaintext.syncLink)) {
    throw new Error('加密快照缺少经验证的来源信息。')
  }
  const link = plaintext.syncLink
  if (link.format !== SYNC_SNAPSHOT_FORMAT ||
    link.snapshotId !== snapshot.snapshotId ||
    link.parentSnapshotId !== snapshot.parentSnapshotId ||
    Object.keys(link).sort().join('|') !==
      ['format', 'parentSnapshotId', 'snapshotId'].sort().join('|')) {
    throw new Error('快照版本链与密文中的信息不一致，拒绝接收。')
  }

  // Strip transport-only metadata. The regular backup remains compatible.
  const { syncLink: _syncLink, ...clean } = plaintext
  void _syncLink
  return parseBackup(clean)
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
