import type { PostgresPool } from './postgresSyncRepository'
import type { TrustedPrivateProjectContext } from './privateProjectDeviceAuth'
import { pairingFingerprint } from './manualPairingProtocol'

/**
 * SERVER-ONLY PROTOTYPE; no Function endpoint, migration or key enrollment.
 * A receipt must come from a verified Netlify site+user AND an actual
 * database row that has already passed the phone-key possession proof.
 */
export type PairingEvidence = {
  version: 1
  action: 'approve-publisher' | 'revoke-publisher'
  siteId: string
  ownerId: string
  requestId: string
  deviceId: string
  fingerprint: string
  evidenceAt: string
  issuedAt: string
  expiresAt: string
}
export type SignedPairingEvidence = {
  schema: 'pso-signed-pairing-evidence-v1'
  evidence: PairingEvidence
  signature: string
}
const EVIDENCE_DOMAIN = 'personal-state-observer:trusted-pairing-evidence:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OWNER = /^[A-Za-z0-9_-]{8,100}$/
const FP = /^[a-f0-9]{64}$/
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/

export function pairingEvidenceBytes(e: PairingEvidence): Uint8Array<ArrayBuffer> {
  if (e?.version !== 1 || (e.action !== 'approve-publisher' &&
    e.action !== 'revoke-publisher') || !UUID.test(e.siteId) ||
    !OWNER.test(e.ownerId) || !UUID.test(e.requestId) ||
    !UUID.test(e.deviceId) || !FP.test(e.fingerprint) ||
    !ISO.test(e.evidenceAt) || !ISO.test(e.issuedAt) ||
    !ISO.test(e.expiresAt)) throw Error('invalid-signed-evidence-fields')
  return new TextEncoder().encode([
    EVIDENCE_DOMAIN, String(e.version), e.action, e.siteId, e.ownerId,
    e.requestId, e.deviceId, e.fingerprint, e.evidenceAt, e.issuedAt,
    e.expiresAt
  ].join('\n'))
}

export type EvidenceIssuerConfig = {
  enabled: boolean
  siteId: string
  /** Inject a server-held, non-extractable P256 signer, never a request JWK. */
  signingKey: CryptoKey
  now?: () => number
}
function ownerFromVerifiedContext(
  ctx: TrustedPrivateProjectContext, cfg: EvidenceIssuerConfig
): { ownerId: string; subject: string } | null {
  if (!cfg.enabled || !UUID.test(cfg.siteId) ||
    ctx.site?.id !== cfg.siteId || !ctx.user ||
    typeof ctx.user.id !== 'string' || !OWNER.test(ctx.user.id)) return null
  const expiry = ctx.user.expiresAt instanceof Date
    ? ctx.user.expiresAt.getTime()
    : typeof ctx.user.expiresAt === 'string' ? Date.parse(ctx.user.expiresAt) : NaN
  if (!Number.isFinite(expiry) || expiry <= (cfg.now?.() ?? Date.now())) return null
  return { ownerId: ctx.user.id,
    subject: 'netlify:' + cfg.siteId + ':' + ctx.user.id }
}
function assertTrustedSigner(key: CryptoKey) {
  if (!key || key.type !== 'private' || key.extractable ||
    key.algorithm?.name !== 'ECDSA' ||
    (key.algorithm as EcKeyAlgorithm).namedCurve !== 'P-256' ||
    !key.usages.includes('sign')) throw Error('server-receipt-signer-invalid')
}
function base64url(bytes: Uint8Array): string {
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Caller never supplies a receipt's key, fingerprint, proof timestamp or owner. */
export function createVerifiedPairingEvidenceIssuer(
  pool: PostgresPool, cfg: EvidenceIssuerConfig
) {
  return {
    async issue(
      ctx: TrustedPrivateProjectContext,
      action: 'approve-publisher' | 'revoke-publisher',
      requestedId: string
    ): Promise<SignedPairingEvidence | null> {
      const owner = ownerFromVerifiedContext(ctx, cfg)
      if (!owner || !UUID.test(requestedId) ||
        (action !== 'approve-publisher' && action !== 'revoke-publisher'))
        return null
      assertTrustedSigner(cfg.signingKey)
      const client = await pool.connect()
      try {
        let row: Record<string, unknown> | undefined
        let deadline = (cfg.now?.() ?? Date.now()) + 90_000
        let requestId = requestedId
        if (action === 'approve-publisher') {
          const { rows } = await client.query(
            'SELECT request_id,device_id,public_key_jwk,fingerprint,proved_at,' +
            'expires_at FROM sync_pairing_requests ' +
            'WHERE subject=$1 AND request_id=$2 AND proved_at IS NOT NULL ' +
            'AND approved_at IS NULL AND cancelled_at IS NULL AND expires_at > now()',
            [owner.subject,requestedId]
          )
          if (rows.length !== 1) return null
          row = rows[0]
          const expiresAt = (row?.expires_at as Date).getTime()
          deadline = Math.min(deadline, expiresAt)
        } else {
          const { rows } = await client.query(
            'SELECT device_id,public_key_jwk ' +
            'FROM sync_publisher_devices ' +
            'WHERE subject=$1 AND device_id=$2 AND revoked_at IS NULL ' +
            'AND public_key_jwk IS NOT NULL',
            [owner.subject, requestedId]
          )
          if (rows.length !== 1) return null
          row = rows[0]
          requestId = crypto.randomUUID()
        }
        if (!row || deadline <= (cfg.now?.() ?? Date.now())) return null
        const fingerprint = await pairingFingerprint(row.public_key_jwk as JsonWebKey)
        if (action === 'approve-publisher' &&
          fingerprint !== String(row.fingerprint).trim()) return null
        const evidenceAt = action === 'approve-publisher'
          ? (row.proved_at as Date)
          : new Date(cfg.now?.() ?? Date.now())
        if (!(evidenceAt instanceof Date) || !Number.isFinite(evidenceAt.getTime()) ||
          !UUID.test(String(row.device_id))) return null
        const issued = cfg.now?.() ?? Date.now()
        const evidence: PairingEvidence = {
          version:1, action, siteId: cfg.siteId, ownerId: owner.ownerId,
          requestId, deviceId: String(row.device_id),
          fingerprint, evidenceAt: evidenceAt.toISOString(),
          issuedAt: new Date(issued).toISOString(),
          expiresAt: new Date(Math.min(deadline,issued+90_000)).toISOString()
        }
        if (Date.parse(evidence.expiresAt) <= issued) return null
        const signature = await crypto.subtle.sign(
          {name:'ECDSA',hash:'SHA-256'},cfg.signingKey,
          pairingEvidenceBytes(evidence)
        )
        return {schema:'pso-signed-pairing-evidence-v1',
          evidence,signature:base64url(new Uint8Array(signature))}
      } finally { client.release() }
    }
  }
}
