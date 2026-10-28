import assert from 'node:assert/strict'
import {
  MAX_SYNC_HTTP_BODY_BYTES, checkEncryptedPublishSize,
  serializedSyncJsonBytes
} from '../src/services/syncTransportLimits'
import {
  createGuardedSyncHandler,
  MAX_SYNC_REQUEST_BYTES, MAX_SYNC_RESPONSE_BYTES,
  type SyncRepository
} from '../src/server/guardedSyncService'
import type { SyncSnapshotV1 } from '../src/services/syncEnvelope'
import { MAX_ENCRYPTED_BACKUP_FILE_BYTES } from '../src/services/encryptedBackup'

const origin = 'https://synthetic-private.example.test'
const uuid = crypto.randomUUID()
const tiny: SyncSnapshotV1 = {
  format: 'personal-state-observer-sync-snapshot',
  version: 1,
  snapshotId: uuid,
  parentSnapshotId: null,
  encrypted: {
    format: 'personal-state-observer-encrypted-backup',
    version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256',
    iterations: 600000,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'A'.repeat(24)
  }
}
// The offline exported encrypted file may still be much larger than a hosted
// Netlify Function body. Do NOT shrink the local backup format or storage.
assert.equal(MAX_SYNC_REQUEST_BYTES, 5 * 1024 * 1024)
assert.equal(MAX_SYNC_RESPONSE_BYTES, MAX_SYNC_REQUEST_BYTES)
assert.equal(MAX_SYNC_HTTP_BODY_BYTES, MAX_SYNC_REQUEST_BYTES)
assert.ok(MAX_ENCRYPTED_BACKUP_FILE_BYTES > MAX_SYNC_REQUEST_BYTES)
assert.equal(checkEncryptedPublishSize(null, tiny).fits, true)

// A base64 fixture with a long opaque payload; no real health data, no KDF.
const empty: SyncSnapshotV1 = { ...tiny,
  encrypted: { ...tiny.encrypted, ciphertext: '' }
}
const overhead = serializedSyncJsonBytes({ expectedHead: null, snapshot: empty })
const nearLimitCipherLength = Math.floor((MAX_SYNC_REQUEST_BYTES - overhead) / 4) * 4
const near = {
  ...tiny, encrypted: { ...tiny.encrypted, ciphertext: 'A'.repeat(nearLimitCipherLength) }
}
const over = {
  ...near, encrypted: {
    ...near.encrypted, ciphertext: near.encrypted.ciphertext + 'AAAA'
  }
}
const nearSize = checkEncryptedPublishSize(null, near)
const overSize = checkEncryptedPublishSize(null, over)
assert.equal(nearSize.fits, true)
assert.ok(nearSize.bytes <= MAX_SYNC_REQUEST_BYTES)
assert.ok(nearSize.bytes > MAX_SYNC_REQUEST_BYTES - 4)
assert.equal(overSize.fits, false)
assert.ok(overSize.bytes > MAX_SYNC_REQUEST_BYTES)
assert.equal(
  serializedSyncJsonBytes({ emoji: '🕊️' }),
  new TextEncoder().encode(JSON.stringify({ emoji: '🕊️' })).byteLength,
  'size must be UTF-8 wire bytes, not JS string length'
)

let authorizationChecks = 0
let commits = 0
let stored: SyncSnapshotV1 | null = null
const repo: SyncRepository = {
  readHead: async () => ({ snapshotId: null, revision: 0 }),
  readHistory: async () => [],
  readSnapshot: async () => stored,
  commitSnapshot: async () => {
    commits++
    return { status: 'committed', head: { snapshotId: uuid, revision: 1 } }
  }
}
const handler = createGuardedSyncHandler({
  enabled: true, allowedOrigin: origin,
  authenticate: async () => {
    authorizationChecks++
    return { subject: 'synthetic-only-subject', deviceId: 'fixture-phone',
      permission: 'publish' }
  },
  repository: repo
})
const post = (snapshot: SyncSnapshotV1, extra: Record<string, string> = {}) =>
  new Request(origin + '/api/sync/snapshots', {
    method: 'POST',
    headers: {
      'Origin': origin, 'Content-Type': 'application/json', ...extra
    },
    body: JSON.stringify({ expectedHead: null, snapshot })
  })

// Netlify might reject these at its own edge even earlier. The handler must
// still be safe when invoked directly in synthetic local/CI regression tests.
let response = await handler(post(over, {
  'Content-Length': String(overSize.bytes)
}))
assert.equal(response.status, 413)
assert.equal((await response.json()).error, 'request-too-large')
assert.equal(authorizationChecks, 0,
  'declared oversize request must not consume a publish challenge')
assert.equal(commits, 0)

response = await handler(post(over))
assert.equal(response.status, 413,
  'streamed oversize body rejected even without Content-Length')
assert.equal(commits, 0)

response = await handler(post(over, { 'Content-Length': String(nearSize.bytes) }))
assert.equal(response.status, 413,
  'lying small declared size cannot bypass streaming byte check')
assert.equal(commits, 0)

response = await handler(post(near))
assert.equal(response.status, 201,
  'bounded near-limit JSON still follows existing publish workflow')
assert.equal(commits, 1)

// A POST over its limit does not necessarily mean the smaller snapshot
// subobject is also too large. Model a genuinely oversized legacy DB row.
const legacyOversized = {
  ...over, encrypted: {
    ...over.encrypted, ciphertext: over.encrypted.ciphertext + 'A'.repeat(2048)
  }
}
assert.ok(serializedSyncJsonBytes(legacyOversized) > MAX_SYNC_RESPONSE_BYTES)
stored = legacyOversized as SyncSnapshotV1
response = await handler(new Request(origin + '/api/sync/snapshots/' + uuid))
assert.equal(response.status, 503, 'legacy >5 MiB rows cannot exceed buffered response limit')
assert.equal((await response.json()).error, 'snapshot-exceeds-host-limit')
stored = near as SyncSnapshotV1
// A near-limit *publish request* has extra JSON; its returned snapshot fits.
response = await handler(new Request(origin + '/api/sync/snapshots/' + uuid))
assert.equal(response.status, 200)
assert.equal((await response.json()).snapshotId, uuid)
assert.equal(commits, 1, 'reads must never mutate stored snapshots')

console.log('[PASS] Netlify buffered payload: 5 MiB request/response margin, streaming and hinted length rejection, preserved local backup limits')
