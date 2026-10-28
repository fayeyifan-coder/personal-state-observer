import type { PostgresPool, PostgresClient } from './postgresSyncRepository'
import type {
  ManualPairingStore, PendingPairing, ApprovalOutcome
} from './manualPairingProtocol'

/**
 * Server-only manual approval store. No HTTP route or Netlify connection
 * exists in this PR. A separate authenticated operator must compare the
 * exact fingerprint with the phone before calling approveByOperator.
 */
async function transact<T>(
  pool: PostgresPool, work: (client: PostgresClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  let started = false
  try {
    await client.query('BEGIN')
    started = true
    const result = await work(client)
    await client.query('COMMIT')
    started = false
    return result
  } catch (error) {
    if (started) {
      try { await client.query('ROLLBACK') } catch { /* preserve original */ }
    }
    throw error
  } finally { client.release() }
}

async function lockOwner(client: PostgresClient, subject: string) {
  if (!subject || subject.length > 200 || /[\u0000-\u001f]/.test(subject)) {
    throw Error('invalid-verified-owner')
  }
  await client.query(
    'INSERT INTO sync_heads(subject, snapshot_id, revision) VALUES($1, NULL, 0) ' +
    'ON CONFLICT(subject) DO NOTHING', [subject]
  )
  const locked = await client.query(
    'SELECT subject FROM sync_heads WHERE subject=$1 FOR UPDATE', [subject]
  )
  if (locked.rows.length !== 1) throw Error('missing-account-lock')
}

const LIVE_PUBLISHER =
  'SELECT device_id FROM sync_publisher_devices WHERE subject=$1 ' +
  'AND revoked_at IS NULL'

export function createPostgresManualPairingStore(pool: PostgresPool): ManualPairingStore {
  return {
    async begin(subject, deviceId, publicKeyJwk, fingerprint, ttlSeconds) {
      if (ttlSeconds !== 300) throw Error('invalid-pairing-window')
      return transact(pool, async client => {
        await lockOwner(client, subject)
        const publisher = await client.query(LIVE_PUBLISHER, [subject])
        if (publisher.rows.length) return null

        // Expire an old candidate, but never silently cancel a *valid* one.
        await client.query(
          'UPDATE sync_pairing_requests SET cancelled_at=now() ' +
          'WHERE subject=$1 AND approved_at IS NULL AND cancelled_at IS NULL ' +
          'AND expires_at <= now()', [subject]
        )
        const outstanding = await client.query(
          'SELECT 1 FROM sync_pairing_requests WHERE subject=$1 ' +
          'AND approved_at IS NULL AND cancelled_at IS NULL', [subject]
        )
        if (outstanding.rows.length) return null
        const recent = await client.query(
          'SELECT count(*)::int AS attempts FROM sync_pairing_requests ' +
          "WHERE subject=$1 AND created_at > now() - interval '1 hour'", [subject]
        )
        if (Number(recent.rows[0]?.attempts) >= 5) return null

        const requestId = crypto.randomUUID()
        const nonce = crypto.randomUUID()
        const inserted = await client.query(
          'INSERT INTO sync_pairing_requests ' +
          '(subject, request_id, nonce, device_id, public_key_jwk, fingerprint, expires_at) ' +
          "VALUES($1,$2,$3,$4,$5::jsonb,$6,now()+interval '300 seconds') " +
          'RETURNING expires_at',
          [subject, requestId, nonce, deviceId, JSON.stringify(publicKeyJwk), fingerprint]
        )
        return { requestId, nonce, expiresAt: inserted.rows[0].expires_at as Date }
      })
    },

    async read(subject, requestId): Promise<PendingPairing | null> {
      const client = await pool.connect()
      try {
        const { rows } = await client.query(
          'SELECT subject, request_id, nonce, device_id, public_key_jwk, ' +
          'fingerprint, expires_at, proved_at FROM sync_pairing_requests ' +
          'WHERE subject=$1 AND request_id=$2 AND cancelled_at IS NULL ' +
          'AND approved_at IS NULL',
          [subject, requestId]
        )
        if (rows.length !== 1) return null
        const row = rows[0]
        return {
          subject: String(row.subject),
          requestId: String(row.request_id),
          nonce: String(row.nonce),
          deviceId: String(row.device_id),
          publicKeyJwk: row.public_key_jwk as JsonWebKey,
          fingerprint: String(row.fingerprint).trim(),
          expiresAt: row.expires_at as Date,
          provedAt: row.proved_at as Date | null
        }
      } finally { client.release() }
    },

    async markProven(subject, requestId) {
      const client = await pool.connect()
      try {
        const { rows } = await client.query(
          'UPDATE sync_pairing_requests SET proved_at=now() ' +
          'WHERE subject=$1 AND request_id=$2 AND proved_at IS NULL ' +
          'AND approved_at IS NULL AND cancelled_at IS NULL ' +
          'AND expires_at > now() RETURNING request_id', [subject, requestId]
        )
        return rows.length === 1
      } finally { client.release() }
    },

    async approveByOperator(subject, requestId, expectedFingerprint): Promise<ApprovalOutcome> {
      // No HTTP endpoint may accept 'operatorApproved=true' from the browser.
      if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) return 'invalid-or-expired'
      return transact(pool, async client => {
        await lockOwner(client, subject)
        const { rows } = await client.query(
          'SELECT device_id, public_key_jwk, fingerprint, proved_at, ' +
          'expires_at, approved_at, cancelled_at FROM sync_pairing_requests ' +
          'WHERE subject=$1 AND request_id=$2 FOR UPDATE', [subject, requestId]
        )
        if (rows.length !== 1) return 'invalid-or-expired'
        const candidate = rows[0]
        if (candidate.cancelled_at || candidate.approved_at ||
          String(candidate.fingerprint).trim() !== expectedFingerprint ||
          (candidate.expires_at as Date).getTime() <= Date.now()) {
          return 'invalid-or-expired'
        }
        if (!candidate.proved_at) return 'not-proven'

        const live = await client.query(LIVE_PUBLISHER, [subject])
        if (live.rows.length) return 'already-paired'
        await client.query(
          'INSERT INTO sync_publisher_devices ' +
          '(subject, device_id, public_key_jwk) VALUES($1,$2,$3::jsonb)',
          [subject, candidate.device_id, JSON.stringify(candidate.public_key_jwk)]
        )
        await client.query(
          'UPDATE sync_pairing_requests SET approved_at=now() ' +
          'WHERE subject=$1 AND request_id=$2', [subject, requestId]
        )
        return 'approved'
      })
    },

    async revokeByOperator(subject, deviceId) {
      return transact(pool, async client => {
        await lockOwner(client, subject)
        const result = await client.query(
          'UPDATE sync_publisher_devices SET revoked_at=now() ' +
          'WHERE subject=$1 AND device_id=$2 AND revoked_at IS NULL ' +
          'RETURNING device_id', [subject, deviceId]
        )
        if (result.rows.length !== 1) return false

        // Revoke outstanding challenges and any pending same-owner proposal,
        // keeping immutable audit rows rather than deleting the account.
        await client.query(
          'UPDATE sync_pairing_requests SET cancelled_at=now() ' +
          'WHERE subject=$1 AND approved_at IS NULL AND cancelled_at IS NULL', [subject]
        )
        await client.query(
          'UPDATE sync_device_challenges SET consumed_at=now() ' +
          'WHERE subject=$1 AND device_id=$2 AND consumed_at IS NULL', [subject, deviceId]
        )
        return true
      })
    }
  }
}
