import {
  isUuid,
  parseSyncSnapshot,
  type SyncSnapshotV1
} from '../services/syncEnvelope'

/**
 * Only an authenticated SERVER adapter may construct this value.
 * In particular, deviceId must be backed by verified, revocable device
 * credentials. Neither a JSON body nor a client-supplied header is proof.
 */
export type VerifiedSyncSession = {
  subject: string
  deviceId: string | null
  permission: 'read' | 'publish'
}

export type SyncHead = {
  snapshotId: string | null
  revision: number
}

export type SyncCommit =
  | { status: 'committed'; head: SyncHead }
  | { status: 'already-committed'; head: SyncHead }
  | { status: 'stale'; head: SyncHead }
  | { status: 'forbidden' }

export interface SyncRepository {
  /** All methods MUST scope reads and writes to the verified subject. */
  readHead(subject: string): Promise<SyncHead>
  readSnapshot(subject: string, snapshotId: string): Promise<SyncSnapshotV1 | null>
  readHistory(subject: string): Promise<ReadonlyArray<{
    snapshotId: string
    parentSnapshotId: string | null
    revision: number
  }>>
  /**
   * An actual implementation MUST atomically verify the registered publisher
   * device, expected head and snapshot identity in a durable transaction.
   * Never implement this as a non-transactional read followed by write.
   */
  commitSnapshot(input: {
    subject: string
    verifiedDeviceId: string
    expectedHead: string | null
    snapshot: SyncSnapshotV1
  }): Promise<SyncCommit>
}

export type SyncServiceDependencies = {
  /** Validates Identity session AND device authorization server-side. */
  authenticate(request: Request): Promise<VerifiedSyncSession | null>
  repository: SyncRepository
  /** MUST match a dedicated, isolated HTTPS origin, never use '*' */
  allowedOrigin: string
  /** Explicit opt-in is mandatory even when the API code is present. */
  enabled: boolean
}

export const MAX_SYNC_REQUEST_BYTES = 35 * 1024 * 1024 + 4096

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

function fail(status: number, code: string): Response {
  return json({ error: code }, status)
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length !== null && (Number(length) > MAX_SYNC_REQUEST_BYTES || !/^\d+$/.test(length))) {
    throw new Error('too-large')
  }
  if (!request.body) throw new Error('invalid-body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SYNC_REQUEST_BYTES) {
        await reader.cancel()
        throw new Error('too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
  } catch {
    throw new Error('invalid-body')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePublishRequest(value: unknown): {
  expectedHead: string | null
  snapshot: SyncSnapshotV1
} {
  if (!isPlainObject(value) ||
    Object.keys(value).sort().join('|') !== 'expectedHead|snapshot' ||
    (value.expectedHead !== null && !isUuid(value.expectedHead))) {
    throw new Error('invalid-publish-request')
  }
  const snapshot = parseSyncSnapshot(value.snapshot)
  if (snapshot.parentSnapshotId !== value.expectedHead) {
    throw new Error('parent-mismatch')
  }
  return { expectedHead: value.expectedHead, snapshot }
}

/** API contract only. This is NOT a deployed Netlify Function. */
export function createGuardedSyncHandler(dependencies: SyncServiceDependencies) {
  return async (request: Request): Promise<Response> => {
    if (!dependencies.enabled) return fail(503, 'sync-disabled')
    if (!dependencies.allowedOrigin.startsWith('https://')) {
      return fail(503, 'invalid-server-configuration')
    }

    const url = new URL(request.url)
    const pathname = url.pathname
    const snapshotMatch = /^\/api\/sync\/snapshots\/([^/]+)$/.exec(pathname)
    const isHead = pathname === '/api/sync/head'
    const isHistory = pathname === '/api/sync/history'
    const isPublish = pathname === '/api/sync/snapshots' && request.method === 'POST'
    const isReadSnapshot = request.method === 'GET' && !!snapshotMatch
    if (!((request.method === 'GET' && (isHead || isHistory)) || isPublish || isReadSnapshot)) {
      return fail(404, 'not-found')
    }
    if (request.method === 'POST' &&
      (request.headers.get('origin') !== dependencies.allowedOrigin ||
       url.origin !== dependencies.allowedOrigin)) {
      return fail(403, 'origin-not-allowed')
    }
    let session: VerifiedSyncSession | null
    try {
      session = await dependencies.authenticate(request)
    } catch {
      return fail(401, 'unauthenticated')
    }
    if (!session || !session.subject || session.subject.length > 200 ||
      (session.permission !== 'read' && session.permission !== 'publish')) {
      return fail(401, 'unauthenticated')
    }
    try {
      if (request.method === 'GET' && isHead) {
        return json(await dependencies.repository.readHead(session.subject))
      }
      if (request.method === 'GET' && isHistory) {
        return json({ history: await dependencies.repository.readHistory(session.subject) })
      }
      if (isReadSnapshot) {
        const id = snapshotMatch![1]
        if (!isUuid(id)) return fail(400, 'invalid-snapshot-id')
        const snapshot = await dependencies.repository.readSnapshot(session.subject, id)
        return snapshot ? json(snapshot) : fail(404, 'snapshot-not-found')
      }
      if (isPublish) {
        if (session.permission !== 'publish' || !session.deviceId) {
          return fail(403, 'read-only-device')
        }
        if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) {
          return fail(415, 'json-required')
        }
        let body: ReturnType<typeof parsePublishRequest>
        try {
          body = parsePublishRequest(await readBoundedJson(request))
        } catch (error) {
          if (error instanceof Error && error.message === 'too-large') {
            return fail(413, 'request-too-large')
          }
          return fail(400, 'invalid-encrypted-snapshot')
        }
        const result = await dependencies.repository.commitSnapshot({
          subject: session.subject,
          verifiedDeviceId: session.deviceId,
          expectedHead: body.expectedHead,
          snapshot: body.snapshot
        })
        if (result.status === 'forbidden') return fail(403, 'publisher-device-not-authorized')
        if (result.status === 'stale') {
          return json({ error: 'stale-snapshot-head', head: result.head }, 409)
        }
        return json({
          status: result.status,
          head: result.head
        }, result.status === 'committed' ? 201 : 200)
      }
      return fail(404, 'not-found')
    } catch {
      // Never leak user identifiers, tokens, encrypted payload or raw errors.
      return fail(503, 'sync-storage-unavailable')
    }
  }
}
