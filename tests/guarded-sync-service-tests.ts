import assert from 'node:assert/strict'
import { createBackup } from '../src/services/backup'
import { createEncryptedSyncSnapshot } from '../src/services/syncProtocol'
import {
  createGuardedSyncHandler,
  type VerifiedSyncSession,
  type SyncRepository,
  type SyncHead,
  type SyncCommit
} from '../src/server/guardedSyncService'
import type { SyncSnapshotV1 } from '../src/services/syncEnvelope'

const origin = 'https://synthetic-only.example.test'
const password = 'synthetic-unique-test-passphrase-2026'
const first = await createEncryptedSyncSnapshot(createBackup([], [], []), password, null)
const nextOne = await createEncryptedSyncSnapshot(createBackup([], [], []), password, first.snapshotId)
const nextTwo = await createEncryptedSyncSnapshot(createBackup([], [], []), password, first.snapshotId)

type UserState = {
  head: SyncHead
  publisherDeviceId: string
  snapshots: Map<string, SyncSnapshotV1>
  history: { snapshotId: string; parentSnapshotId: string | null; revision: number }[]
}

/** TEST ONLY. Production MUST use durable database transactions for CAS. */
class MemoryFixtureStore implements SyncRepository {
  private users = new Map<string, UserState>()

  registerFixtureUser(subject: string, publisherDeviceId: string) {
    if (this.users.has(subject)) throw new Error('fixture-user-already-registered')
    this.users.set(subject, {
      publisherDeviceId, head: { snapshotId: null, revision: 0 },
      snapshots: new Map(), history: []
    })
  }
  async readHead(subject: string): Promise<SyncHead> {
    const state = this.users.get(subject)
    return state ? { ...state.head } : { snapshotId: null, revision: 0 }
  }
  async readSnapshot(subject: string, snapshotId: string) {
    return this.users.get(subject)?.snapshots.get(snapshotId) ?? null
  }
  async readHistory(subject: string) {
    return [...(this.users.get(subject)?.history ?? [])]
  }
  async commitSnapshot(input: {
    subject: string
    verifiedDeviceId: string
    expectedHead: string | null
    snapshot: SyncSnapshotV1
  }): Promise<SyncCommit> {
    // No await between head comparison and commit: atomic within this fixture
    // process ONLY. This is NOT a substitute for production DB CAS.
    const state = this.users.get(input.subject)
    if (!state || input.verifiedDeviceId !== state.publisherDeviceId) {
      return { status: 'forbidden' }
    }
    const existing = state.snapshots.get(input.snapshot.snapshotId)
    if (existing &&
      JSON.stringify(existing) === JSON.stringify(input.snapshot) &&
      existing.parentSnapshotId === input.expectedHead) {
      return { status: 'already-committed', head: { ...state.head } }
    }
    if (existing || state.head.snapshotId !== input.expectedHead) {
      return { status: 'stale', head: { ...state.head } }
    }
    state.snapshots.set(input.snapshot.snapshotId, input.snapshot)
    state.head = {
      snapshotId: input.snapshot.snapshotId, revision: state.head.revision + 1
    }
    state.history.push({
      snapshotId: input.snapshot.snapshotId,
      parentSnapshotId: input.snapshot.parentSnapshotId,
      revision: state.head.revision
    })
    return { status: 'committed', head: { ...state.head } }
  }
}

const store = new MemoryFixtureStore()
store.registerFixtureUser('synthetic-user-A', 'verified-phone-A')
store.registerFixtureUser('synthetic-user-B', 'verified-phone-B')
const principal = {
  phone: { subject: 'synthetic-user-A', deviceId: 'verified-phone-A', permission: 'publish' },
  desktop: { subject: 'synthetic-user-A', deviceId: 'verified-desktop-A', permission: 'read' },
  stolen: { subject: 'synthetic-user-A', deviceId: 'unregistered-phone', permission: 'publish' },
  otherUser: { subject: 'synthetic-user-B', deviceId: 'verified-phone-B', permission: 'publish' }
} as const satisfies Record<string, VerifiedSyncSession>

const verifiedSessions = new WeakMap<Request, VerifiedSyncSession>()
const authenticate = async (request: Request) => verifiedSessions.get(request) ?? null
const handler = createGuardedSyncHandler({
  enabled: true,
  allowedOrigin: origin,
  authenticate,
  repository: store
})
const disabledHandler = createGuardedSyncHandler({
  enabled: false, allowedOrigin: origin, authenticate, repository: store
})

function request(
  method: 'GET' | 'POST', path: string,
  body?: unknown, session?: VerifiedSyncSession,
  requestOrigin: string | null = origin
): Request {
  const headers = new Headers()
  if (requestOrigin) headers.set('Origin', requestOrigin)
  if (method === 'POST') headers.set('Content-Type', 'application/json')
  const req = new Request(origin + path, {
    method, headers,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  })
  if (session) verifiedSessions.set(req, session)
  return req
}
const publish = (snapshot: SyncSnapshotV1, expectedHead: string | null) =>
  ({ expectedHead, snapshot })

let response = await handler(request('GET', '/api/sync/head'))
assert.equal(response.status, 401, 'unauthenticated readers must be blocked')
assert.equal(response.headers.get('cache-control'), 'no-store')
assert.equal((await response.json()).error, 'unauthenticated')

response = await disabledHandler(request('GET', '/api/sync/head', undefined, principal.phone))
assert.equal(response.status, 503, 'endpoint defaults disabled when not enabled')

response = await handler(request('GET', '/api/sync/head', undefined, principal.desktop))
assert.deepEqual(await response.json(), { snapshotId: null, revision: 0 })

response = await handler(request('POST', '/api/sync/snapshots',
  publish(first, null), principal.desktop))
assert.equal(response.status, 403, 'desktop is always read-only')

response = await handler(request('POST', '/api/sync/snapshots',
  publish(first, null), principal.phone, 'https://attacker.test'))
assert.equal(response.status, 403, 'cross-site POST not allowed')
response = await handler(request('POST', '/api/sync/snapshots',
  publish(first, null), principal.phone, null))
assert.equal(response.status, 403, 'POST missing Origin is denied')

response = await handler(request('POST', '/api/sync/snapshots',
  { ...publish(first, null), dailyRecords: ['sensitive'] }, principal.phone))
assert.equal(response.status, 400, 'plaintext field in outer request refused')

response = await handler(request('POST', '/api/sync/snapshots',
  publish({ ...first, encrypted: { ...first.encrypted, secret: 'test' } }, null), principal.phone))
assert.equal(response.status, 400, 'extra plaintext inside encrypted envelope refused')

response = await handler(request('POST', '/api/sync/snapshots',
  publish(first, null), principal.stolen))
assert.equal(response.status, 403, 'unregistered device must not publish')

response = await handler(request('POST', '/api/sync/snapshots',
  publish(first, null), principal.phone))
assert.equal(response.status, 201, 'first fixture snapshot is committed')
assert.deepEqual(await response.json(), {
  status: 'committed', head: { snapshotId: first.snapshotId, revision: 1 }
})

// An identical retry remains safe, and cannot create duplicate history entries.
response = await handler(request('POST', '/api/sync/snapshots',
  publish(first, null), principal.phone))
assert.equal(response.status, 200)
assert.equal((await response.json()).status, 'already-committed')

response = await handler(request('POST', '/api/sync/snapshots',
  publish({ ...first, encrypted: { ...first.encrypted, ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA' } }, null),
  principal.phone))
assert.equal(response.status, 409, 'same snapshot ID with different bytes cannot replace it')

response = await handler(request('POST', '/api/sync/snapshots',
  publish(nextOne, null), principal.phone))
assert.equal(response.status, 400, 'body declared parent must match authenticated envelope parent')

// Concurrent candidate commits: only one can become the next head.
const two = await Promise.all([nextOne, nextTwo].map(snapshot =>
  handler(request('POST', '/api/sync/snapshots',
    publish(snapshot, first.snapshotId), principal.phone))))
assert.deepEqual(two.map(x => x.status).sort(), [201, 409],
  'two concurrent writes with the same parent cannot both succeed')

response = await handler(request('GET', '/api/sync/history', undefined, principal.desktop))
const history = (await response.json()).history
assert.equal(history.length, 2)
assert.deepEqual(history.map((row: { revision: number }) => row.revision), [1, 2])

response = await handler(request('GET', '/api/sync/snapshots/' + first.snapshotId,
  undefined, principal.desktop))
assert.equal(response.status, 200)
const retrieved = await response.json()
assert.equal(retrieved.snapshotId, first.snapshotId)
assert.equal(JSON.stringify(retrieved).includes('synthetic-unique-test-passphrase'), false)

response = await handler(request('GET', '/api/sync/snapshots/' + first.snapshotId,
  undefined, principal.otherUser))
assert.equal(response.status, 404, 'other authenticated user cannot retrieve someone else data')

response = await handler(request('GET', '/api/sync/head', undefined, principal.otherUser))
assert.deepEqual(await response.json(), { snapshotId: null, revision: 0 })

response = await handler(request('GET', '/api/sync/snapshots/invalid',
  undefined, principal.desktop))
assert.equal(response.status, 400)

response = await handler(request('POST', '/api/sync/snapshots',
  publish(first, null), principal.otherUser))
assert.equal(response.status, 201, 'other user has independent private head')

const brokenStore: SyncRepository = {
  readHead: async () => { throw Error('private DB credentials') },
  readSnapshot: (subject, id) => store.readSnapshot(subject, id),
  readHistory: subject => store.readHistory(subject),
  commitSnapshot: input => store.commitSnapshot(input)
}
const errorHandler = createGuardedSyncHandler({
  enabled: true, allowedOrigin: origin, authenticate, repository: brokenStore
})
response = await errorHandler(request('GET', '/api/sync/head', undefined, principal.desktop))
assert.equal(response.status, 503)
assert.doesNotMatch(await response.text(), /credentials|synthetic-user-A/,
  'server errors must not reveal internal details or user identity')

console.log('[PASS] server sync: default off, auth, origin, device binding, tenant isolation, CAS, retry, history, fail-closed errors')
