import assert from 'node:assert/strict'
import { createBackup } from '../src/services/backup'
import {
  createEncryptedSyncSnapshot,
  decryptAndVerifySyncSnapshot,
  assessIncomingSnapshot, canPreparePublish
} from '../src/services/syncProtocol'

/** Synthetic-only offline rollback drill; no real IndexedDB or Netlify data. */
const backup = createBackup([], [], [])
const phrase = 'offline-recovery-drill-synthetic-fixture-only'
const root = await createEncryptedSyncSnapshot(backup, phrase, null)
const later = await createEncryptedSyncSnapshot(
  backup, phrase, root.snapshotId
)
const restored = await decryptAndVerifySyncSnapshot(later, phrase)
assert.deepEqual(restored, backup, 'encrypted backup can be verified and read')

assert.equal(
  assessIncomingSnapshot(later.snapshotId, root),
  'diverged-or-rolled-back',
  'cloud rollback to an earlier head is not an automatic restore'
)
assert.equal(canPreparePublish(later.snapshotId, root.snapshotId), false,
  'phone cannot overwrite a rolled-back cloud head by pretending CAS is current'
)
assert.equal(
  assessIncomingSnapshot(root.snapshotId, later),
  'candidate-for-preview',
  'even a forward candidate requires decrypt-and-preview before local changes'
)
assert.equal(
  assessIncomingSnapshot(null, later), 'unverified-history',
  'a fresh PC cannot silently claim remote history is already verified'
)
assert.equal(
  assessIncomingSnapshot(later.snapshotId, later), 'same-snapshot'
)
assert.equal(canPreparePublish(later.snapshotId, later.snapshotId), true,
  'only a confirmed matching remote tip may prepare a new publish attempt'
)
// Tamper the unauthenticated envelope linkage after encryption; the inner
// authenticated link will disagree and decryption must fail closed.
await assert.rejects(
  decryptAndVerifySyncSnapshot({
    ...later, parentSnapshotId: crypto.randomUUID()
  }, phrase),
  /快照版本链与密文中的信息不一致/
)
await assert.rejects(
  decryptAndVerifySyncSnapshot(later, 'wrong-offline-recovery-phrase'),
  undefined,
  'wrong passphrase can never silently restore cloud ciphertext'
)
console.log('[PASS] offline synthetic recovery: encrypted decrypt/verify, cloud rollback, unknown PC history and tampering all require explicit preview')
