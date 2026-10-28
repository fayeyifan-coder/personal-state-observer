import type { AppBackup } from '../types'
import { parseBackup } from './backup'
import { encryptBackup, decryptBackup } from './encryptedBackup'
import {
  SYNC_SNAPSHOT_FORMAT, SYNC_SNAPSHOT_VERSION,
  parseSyncSnapshot, isUuid, isObject,
  type SyncSnapshotV1, type EncryptedSyncLink
} from './syncEnvelope'

export {
  SYNC_SNAPSHOT_FORMAT, SYNC_SNAPSHOT_VERSION, parseSyncSnapshot,
  assessIncomingSnapshot, canPreparePublish
} from './syncEnvelope'
export type { SyncSnapshotV1, IncomingSnapshotDecision } from './syncEnvelope'

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

