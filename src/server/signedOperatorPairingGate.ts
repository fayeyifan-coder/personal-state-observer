import { isUuid } from '../services/syncEnvelope'
import { pairingFingerprint } from './manualPairingProtocol'
import type { PostgresClient, PostgresPool } from './postgresSyncRepository'

/**
 * SERVER-ONLY draft. NO Netlify Function/HTTP route is created by this module.
 * Operator keys must be provisioned outside the site and never exported to
 * the phone, browser, public frontend bundle or GitHub repository.
 */
export type OperatorCommand = {
  version: 1
  action: 'approve-publisher' | 'revoke-publisher'
  siteId: string
  ownerId: string
  requestId: string
  deviceId: string
  fingerprint: string
  nonce: string
  issuedAt: string
  expiresAt: string
}
export type OperatorResult =
  | 'approved' | 'revoked' | 'replayed' | 'not-eligible' | 'rejected'

export type OperatorKeyConfig = {
  /** Pinned by the trusted server startup/config, NEVER taken from a request. */
  operatorPublicKey: JsonWebKey
  expectedSiteId: string
  enabled: boolean
  now?: () => number
}
const encoder = new TextEncoder()
const DOMAIN = 'personal-state-observer:operator-pairing-action:v1'
const FINGERPRINT = /^[a-f0-9]{64}$/
const OWNER = /^[A-Za-z0-9_-]{8,100}$/
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const MAX_TICKET_MS = 120_000

function publicFields(jwk: JsonWebKey) {
  if (jwk?.kty !== 'EC' || jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' || typeof jwk.y !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.y) || jwk.d !== undefined) {
    throw Error('invalid-operator-public-key')
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }
}

function validCommand(c: OperatorCommand, now: number): boolean {
  if (!c || c.version !== 1 ||
    (c.action !== 'approve-publisher' && c.action !== 'revoke-publisher') ||
    !isUuid(c.siteId) || !OWNER.test(c.ownerId) ||
    !isUuid(c.requestId) || !isUuid(c.deviceId) || !isUuid(c.nonce) ||
    !FINGERPRINT.test(c.fingerprint) ||
    !ISO.test(c.issuedAt) || !ISO.test(c.expiresAt)) return false
  const start = Date.parse(c.issuedAt), expiry = Date.parse(c.expiresAt)
  return Number.isFinite(start) && Number.isFinite(expiry) &&
    expiry > now && start <= now + 30_000 &&
    expiry > start && expiry - start <= MAX_TICKET_MS &&
    // Prevent a year-old ticket with a bogus far-future expiration.
    now - start < MAX_TICKET_MS
}

export function operatorCommandBytes(c: OperatorCommand): Uint8Array<ArrayBuffer> {
  if (!validCommand(c, Date.parse(c.issuedAt))) throw Error('invalid-operator-command')
  return encoder.encode([
    DOMAIN, String(c.version), c.action, c.siteId, c.ownerId,
    c.requestId, c.deviceId, c.fingerprint, c.nonce,
    c.issuedAt, c.expiresAt
  ].join('\n'))
}

function decodeSignature(input: string): Uint8Array<ArrayBuffer> | null {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(input)) return null
  try {
    const s = atob(input.replace(/-/g, '+').replace(/_/g, '/') + '==')
    return s.length === 64 ? Uint8Array.from(s, ch => ch.charCodeAt(0)) : null
  } catch { return null }
}

export async function verifyOperatorCommand(
  command: OperatorCommand, signature: string, config: OperatorKeyConfig
): Promise<boolean> {
  const now = config.now?.() ?? Date.now()
  if (!config.enabled || !isUuid(config.expectedSiteId) ||
    !validCommand(command, now) || command.siteId !== config.expectedSiteId) {
    return false
  }
  const raw = decodeSignature(signature)
  if (!raw) return false
  try {
    const key = await crypto.subtle.importKey(
      'jwk', publicFields(config.operatorPublicKey),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    )
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key,
      raw, operatorCommandBytes(command)
    )
  } catch { return false }
}

async function transact<T>(pool: PostgresPool, task: (c: PostgresClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let started = false
  try {
    await client.query('BEGIN')
    started = true
    const result = await task(client)
    await client.query('COMMIT')
    started = false
    return result
  } catch (error) {
    if (started) {
      try { await client.query('ROLLBACK') } catch { /* retain original */ }
    }
    throw error
  } finally { client.release() }
}

/**
 * The only new path for this branch to mutate publisher permissions requires
 * an operator-signed scoped action. Login/candidate proof alone cannot call it.
 * No HTTP entrypoint, persistent key file, or hosted Netlify DB connection.
 */
export function createSignedOperatorPairingGate(
  pool: PostgresPool, config: OperatorKeyConfig
) {
  return {
    async apply(command: OperatorCommand, signature: string): Promise<OperatorResult> {
      if (!await verifyOperatorCommand(command, signature, config)) return 'rejected'
      const subject = 'netlify:' + command.siteId + ':' + command.ownerId
      if (subject.length > 200) return 'rejected'
      return transact(pool, async client => {
        // Same mutex used by the snapshot CAS and previous pairing workflows.
        await client.query(
          'INSERT INTO sync_heads(subject,snapshot_id,revision) VALUES($1,NULL,0) ' +
          'ON CONFLICT(subject) DO NOTHING', [subject]
        )
        const lock = await client.query(
          'SELECT 1 FROM sync_heads WHERE subject=$1 FOR UPDATE', [subject]
        )
        if (lock.rows.length !== 1) throw Error('missing-owner-mutex')

        // Atomic nonce insertion is the replay barrier across all Functions.
        const once = await client.query(
          'INSERT INTO sync_operator_actions ' +
          '(site_id,nonce,subject,action,request_id,device_id,fingerprint,expires_at,result) ' +
          'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(site_id,nonce) DO NOTHING ' +
          'RETURNING nonce',
          [command.siteId, command.nonce, subject, command.action,
            command.requestId, command.deviceId, command.fingerprint,
            command.expiresAt, 'not-eligible']
        )
        if (once.rows.length !== 1) return 'replayed'

        let result: OperatorResult = 'not-eligible'
        if (command.action === 'approve-publisher') {
          const pending = await client.query(
            'SELECT device_id,public_key_jwk,fingerprint,proved_at,expires_at,' +
            'approved_at,cancelled_at FROM sync_pairing_requests ' +
            'WHERE subject=$1 AND request_id=$2 FOR UPDATE',
            [subject, command.requestId]
          )
          if (pending.rows.length === 1) {
            const p = pending.rows[0]
            const fingerprint = String(p.fingerprint).trim()
            const clean = !p.cancelled_at && !p.approved_at &&
              p.proved_at && (p.expires_at as Date).getTime() > Date.now() &&
              String(p.device_id) === command.deviceId &&
              fingerprint === command.fingerprint &&
              await pairingFingerprint(p.public_key_jwk as JsonWebKey) === command.fingerprint
            if (clean) {
              const live = await client.query(
                'SELECT 1 FROM sync_publisher_devices ' +
                'WHERE subject=$1 AND revoked_at IS NULL', [subject]
              )
              if (!live.rows.length) {
                await client.query(
                  'INSERT INTO sync_publisher_devices(subject,device_id,public_key_jwk) ' +
                  'VALUES($1,$2,$3::jsonb)',
                  [subject, command.deviceId, JSON.stringify(p.public_key_jwk)]
                )
                await client.query(
                  'UPDATE sync_pairing_requests SET approved_at=now() ' +
                  'WHERE subject=$1 AND request_id=$2', [subject, command.requestId]
                )
                result = 'approved'
              }
            }
          }
        } else {
          const live = await client.query(
            'SELECT public_key_jwk FROM sync_publisher_devices ' +
            'WHERE subject=$1 AND device_id=$2 AND revoked_at IS NULL FOR UPDATE',
            [subject, command.deviceId]
          )
          if (live.rows.length === 1 &&
            live.rows[0].public_key_jwk &&
            await pairingFingerprint(live.rows[0].public_key_jwk as JsonWebKey) === command.fingerprint) {
            await client.query(
              'UPDATE sync_publisher_devices SET revoked_at=now() ' +
              'WHERE subject=$1 AND device_id=$2 AND revoked_at IS NULL',
              [subject, command.deviceId]
            )
            await client.query(
              'UPDATE sync_device_challenges SET consumed_at=now() ' +
              'WHERE subject=$1 AND device_id=$2 AND consumed_at IS NULL',
              [subject, command.deviceId]
            )
            await client.query(
              'UPDATE sync_pairing_requests SET cancelled_at=now() ' +
              'WHERE subject=$1 AND approved_at IS NULL AND cancelled_at IS NULL',
              [subject]
            )
            result = 'revoked'
          }
        }
        await client.query(
          'UPDATE sync_operator_actions SET result=$3 WHERE site_id=$1 AND nonce=$2',
          [command.siteId, command.nonce, result]
        )
        return result
      })
    }
  }
}
