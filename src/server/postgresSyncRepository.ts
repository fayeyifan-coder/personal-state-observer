import {
  parseSyncSnapshot,
  type SyncSnapshotV1
} from '../services/syncEnvelope'
import type {
  SyncCommit, SyncHead, SyncRepository
} from './guardedSyncService'

// Compatible with getDatabase().pool's pg.Pool-like query interface.
// No Netlify package, credentials, I/O or database migration is executed here.
type DatabaseRow = Record<string, unknown>
export interface PostgresClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: DatabaseRow[] }>
  release(): void
}
export interface PostgresPool {
  connect(): Promise<PostgresClient>
}

function requireSubject(subject: string): void {
  if (!subject || subject.length > 200 || /[\u0000-\u001f]/.test(subject)) {
    throw new Error('invalid-verified-subject')
  }
}

function readRevision(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new Error('invalid-db-revision')
  }
  return n
}

function readHead(row?: DatabaseRow): SyncHead {
  if (!row) return { snapshotId: null, revision: 0 }
  const id = row.snapshot_id
  if (id !== null && typeof id !== 'string') throw new Error('invalid-db-head')
  return { snapshotId: id, revision: readRevision(row.revision) }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    const pairs = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    return '{' + pairs.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('invalid-json-value')
  return encoded
}

/**
 * Postgres implementation of SyncRepository.
 * Every commit uses one locked subject-head row for atomic, serializable
 * compare-and-swap semantics across independent server instances.
 *
 * No device auto-registration. An authorized admin pairing flow must
 * provision/revoke sync_publisher_devices separately.
 */
export function createPostgresSyncRepository(pool: PostgresPool): SyncRepository {
  return {
    async readHead(subject: string): Promise<SyncHead> {
      requireSubject(subject)
      const client = await pool.connect()
      try {
        const { rows } = await client.query(
          'SELECT snapshot_id, revision FROM sync_heads WHERE subject = $1',
          [subject]
        )
        return readHead(rows[0])
      } finally {
        client.release()
      }
    },

    async readSnapshot(subject: string, snapshotId: string): Promise<SyncSnapshotV1 | null> {
      requireSubject(subject)
      const client = await pool.connect()
      try {
        const { rows } = await client.query(
          'SELECT envelope FROM sync_snapshots WHERE subject = $1 AND snapshot_id = $2',
          [subject, snapshotId]
        )
        return rows.length ? parseSyncSnapshot(rows[0].envelope) : null
      } finally {
        client.release()
      }
    },

    async readHistory(subject: string) {
      requireSubject(subject)
      const client = await pool.connect()
      try {
        const { rows } = await client.query(
          'SELECT snapshot_id, parent_snapshot_id, revision FROM sync_snapshots ' +
          'WHERE subject = $1 ORDER BY revision DESC LIMIT 100', [subject]
        )
        return rows.map(row => ({
          snapshotId: String(row.snapshot_id),
          parentSnapshotId: row.parent_snapshot_id === null ? null : String(row.parent_snapshot_id),
          revision: readRevision(row.revision)
        }))
      } finally {
        client.release()
      }
    },

    async commitSnapshot(input): Promise<SyncCommit> {
      requireSubject(input.subject)
      const snapshot = parseSyncSnapshot(input.snapshot)
      if (snapshot.parentSnapshotId !== input.expectedHead) {
        throw new Error('parent-mismatch')
      }
      const client = await pool.connect()
      let started = false
      try {
        await client.query('BEGIN')
        started = true
        // Seed the subject's CAS mutex. PK prevents duplicate mutex rows
        // on first concurrent upload. This is NOT a device authorization.
        await client.query(
          'INSERT INTO sync_heads (subject, snapshot_id, revision) ' +
          'VALUES ($1, NULL, 0) ON CONFLICT (subject) DO NOTHING',
          [input.subject]
        )
        const locked = await client.query(
          'SELECT snapshot_id, revision FROM sync_heads ' +
          'WHERE subject = $1 FOR UPDATE', [input.subject]
        )
        const head = readHead(locked.rows[0])
        if (!locked.rows.length) throw new Error('missing-head-lock')

        // FOR SHARE holds the publisher registration against concurrent
        // revocation until this transaction completes.
        const approved = await client.query(
          'SELECT 1 FROM sync_publisher_devices ' +
          'WHERE subject = $1 AND device_id = $2 AND revoked_at IS NULL FOR SHARE',
          [input.subject, input.verifiedDeviceId]
        )
        if (approved.rows.length !== 1) {
          await client.query('ROLLBACK')
          started = false
          return { status: 'forbidden' }
        }

        const found = await client.query(
          'SELECT envelope FROM sync_snapshots ' +
          'WHERE subject = $1 AND snapshot_id = $2',
          [input.subject, snapshot.snapshotId]
        )
        if (found.rows.length) {
          const old = parseSyncSnapshot(found.rows[0].envelope)
          if (old.parentSnapshotId === input.expectedHead &&
            canonical(old) === canonical(snapshot)) {
            await client.query('COMMIT')
            started = false
            return { status: 'already-committed', head }
          }
          await client.query('ROLLBACK')
          started = false
          return { status: 'stale', head }
        }
        if (head.snapshotId !== input.expectedHead) {
          await client.query('ROLLBACK')
          started = false
          return { status: 'stale', head }
        }
        const nextRevision = head.revision + 1
        if (!Number.isSafeInteger(nextRevision)) throw new Error('revision-overflow')

        // The encrypted envelope must be the only persisted observation
        // content. No passphrase, record dates, or answers are indexed.
        await client.query(
          'INSERT INTO sync_snapshots ' +
          '(subject, snapshot_id, parent_snapshot_id, revision, envelope) ' +
          'VALUES ($1, $2, $3, $4, $5::jsonb)',
          [input.subject, snapshot.snapshotId, snapshot.parentSnapshotId,
            nextRevision, JSON.stringify(snapshot)]
        )
        await client.query(
          'UPDATE sync_heads SET snapshot_id = $2, revision = $3 WHERE subject = $1',
          [input.subject, snapshot.snapshotId, nextRevision]
        )
        await client.query('COMMIT')
        started = false
        return {
          status: 'committed',
          head: { snapshotId: snapshot.snapshotId, revision: nextRevision }
        }
      } catch (error) {
        if (started) {
          try { await client.query('ROLLBACK') } catch { /* original error wins */ }
        }
        throw error
      } finally {
        client.release()
      }
    }
  }
}
