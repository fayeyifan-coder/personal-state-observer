import type { PostgresPool } from './postgresSyncRepository'
import type {
  PublisherProofStore,
  RegisteredPublisher
} from './privateProjectDeviceAuth'

/**
 * SERVER-ONLY DRAFT: no live Netlify connection, no automatic DB migrations.
 * A separate authorized pairing operation must register the public JWK.
 */
export function createPostgresPublisherProofStore(pool: PostgresPool): PublisherProofStore {
  return {
    async getRegisteredPublisher(
      subject: string, deviceId: string
    ): Promise<RegisteredPublisher | null> {
      const client = await pool.connect()
      try {
        const { rows } = await client.query(
          'SELECT device_id, public_key_jwk, revoked_at FROM sync_publisher_devices ' +
          'WHERE subject = $1 AND device_id = $2',
          [subject, deviceId]
        )
        if (rows.length !== 1 || !rows[0].public_key_jwk ||
          typeof rows[0].public_key_jwk !== 'object') return null
        return {
          deviceId: String(rows[0].device_id),
          publicKeyJwk: rows[0].public_key_jwk as JsonWebKey,
          revoked: rows[0].revoked_at !== null
        }
      } finally {
        client.release()
      }
    },

    async issueChallenge(subject: string, deviceId: string, ttlSeconds: number) {
      if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 90) {
        return null
      }
      const client = await pool.connect()
      let inTransaction = false
      try {
        await client.query('BEGIN')
        inTransaction = true
        // Lock device row so parallel issuance cannot bypass the quota.
        const { rows: registered } = await client.query(
          'SELECT 1 FROM sync_publisher_devices ' +
          'WHERE subject = $1 AND device_id = $2 AND revoked_at IS NULL ' +
          'AND public_key_jwk IS NOT NULL FOR UPDATE',
          [subject, deviceId]
        )
        if (registered.length !== 1) {
          await client.query('ROLLBACK')
          inTransaction = false
          return null
        }
        const { rows } = await client.query(
          'SELECT count(*)::int AS active FROM sync_device_challenges ' +
          'WHERE subject = $1 AND device_id = $2 AND consumed_at IS NULL ' +
          'AND expires_at > now()',
          [subject, deviceId]
        )
        if (rows.length !== 1 || Number(rows[0].active) >= 3) {
          await client.query('ROLLBACK')
          inTransaction = false
          return null
        }
        const nonce = crypto.randomUUID()
        await client.query(
          'INSERT INTO sync_device_challenges ' +
          '(subject, device_id, nonce, expires_at) ' +
          'VALUES ($1, $2, $3, now() + $4::int * interval \'1 second\')',
          [subject, deviceId, nonce, ttlSeconds]
        )
        await client.query('COMMIT')
        inTransaction = false
        return { nonce }
      } catch (error) {
        if (inTransaction) {
          try { await client.query('ROLLBACK') } catch { /* preserve error */ }
        }
        throw error
      } finally {
        client.release()
      }
    },

    async consumeChallenge(subject: string, deviceId: string, nonce: string) {
      const client = await pool.connect()
      try {
        // A single atomic UPDATE prevents signature replay across instances.
        // A revoked device cannot consume even an earlier-issued challenge.
        const { rows } = await client.query(
          'UPDATE sync_device_challenges AS c SET consumed_at = now() ' +
          'WHERE c.subject = $1 AND c.device_id = $2 AND c.nonce = $3 ' +
          'AND c.consumed_at IS NULL AND c.expires_at > now() ' +
          'AND EXISTS (SELECT 1 FROM sync_publisher_devices AS d ' +
          '  WHERE d.subject = c.subject AND d.device_id = c.device_id ' +
          '  AND d.revoked_at IS NULL AND d.public_key_jwk IS NOT NULL) ' +
          'RETURNING c.nonce',
          [subject, deviceId, nonce]
        )
        return rows.length === 1
      } finally {
        client.release()
      }
    }
  }
}
