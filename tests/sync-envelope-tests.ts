import assert from 'node:assert/strict'
import { parseSyncSnapshot, assessIncomingSnapshot, canPreparePublish }
  from '../src/services/syncEnvelope'

// Server-safe structural checks run without importing Dexie or any browser database.
const id = '85a01234-62df-4f1b-8ebc-47b573760123'
const candidate = {
  format: 'personal-state-observer-sync-snapshot',
  version: 1,
  snapshotId: id,
  parentSnapshotId: null,
  encrypted: {
    format: 'personal-state-observer-encrypted-backup',
    version: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: 600000,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  }
}
assert.equal(parseSyncSnapshot(candidate).snapshotId, id)
assert.equal(assessIncomingSnapshot(null, candidate), 'candidate-for-preview')
assert.equal(canPreparePublish(null, null), true)
assert.equal('indexedDB' in globalThis, false, 'parser must remain usable outside browser storage')
assert.throws(() => parseSyncSnapshot({ ...candidate, privateHealthAnswer: 'sensitive' }), /额外字段/)
assert.throws(() => parseSyncSnapshot({ ...candidate, encrypted: {
  ...candidate.encrypted, exportedPlaintext: { mood: 5 }
} }), /额外字段/)
assert.throws(() => parseSyncSnapshot({ ...candidate, parentSnapshotId: id }), /身份信息/)
console.log('[PASS] sync envelope is server-importable and rejects extra plaintext')
