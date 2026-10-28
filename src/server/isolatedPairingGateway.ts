import type { PostgresPool } from './postgresSyncRepository'
import type { TrustedPrivateProjectContext } from './privateProjectDeviceAuth'
import { createPendingPairingWorkflow, type PairingRequest } from './manualPairingProtocol'
import { createPostgresManualPairingStore } from './postgresManualPairingStore'
import {
  createVerifiedPairingEvidenceIssuer,
  type SignedPairingEvidence
} from './verifiedPairingEvidenceIssuer'
import {
  createSignedOperatorPairingGate,
  type OperatorCommand,
  type OperatorResult
} from './signedOperatorPairingGate'

/**
 * SINGLE COMPOSITION ROOT for the isolated pairing experiment.
 *
 * No Netlify Function, HTTP handler, migration, key provisioning or UI.
 * No public caller can reach approveByOperator()/revokeByOperator() through
 * this API. They exist in legacy draft stores for existing DB tests only.
 *
 * Only a server adapter may construct this object from Netlify's trusted
 * invocation context and server-side pinned keys. NEVER construct the
 * TrustedPrivateProjectContext from user-supplied JSON or headers.
 */
export type IsolatedPairingGatewayOptions = {
  enabled: boolean
  expectedSiteId: string
  pool: PostgresPool
  /** Pinned independently, never accepted from HTTP request body. */
  pinnedOperatorPublicKey: JsonWebKey | null
  /** Loaded from a future reviewed persistent secret store; nonextractable. */
  evidenceSigningKey: CryptoKey | null
  now?: () => number
}

type PairingGateway = Readonly<{
  request: (deviceId: string, publicKeyJwk: JsonWebKey) => Promise<PairingRequest | null>
  prove: (requestId: string, signature: string) => Promise<boolean>
  evidence: (
    action: 'approve-publisher' | 'revoke-publisher',
    requestOrDeviceId: string
  ) => Promise<SignedPairingEvidence | null>
  /**
   * This is the ONLY exposed publisher-permission mutation path.
   * A Netlify login and possession proof cannot confer permission.
   * The P-256 operator signature and database constraints are enforced
   * inside createSignedOperatorPairingGate, in a single transaction.
   */
  applySignedOperatorAction: (
    command: OperatorCommand, signature: string
  ) => Promise<OperatorResult>
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DISABLED: PairingGateway = Object.freeze({
  async request() { return null },
  async prove() { return false },
  async evidence() { return null },
  async applySignedOperatorAction(): Promise<OperatorResult> { return 'rejected' }
})

export function createIsolatedPairingGateway(
  trustedContext: TrustedPrivateProjectContext,
  options: IsolatedPairingGatewayOptions
): PairingGateway {
  const issuer = options.evidenceSigningKey
  const pinned = options.pinnedOperatorPublicKey
  if (!options.enabled || !UUID.test(options.expectedSiteId) ||
    !issuer || issuer.type !== 'private' || issuer.extractable ||
    issuer.algorithm?.name !== 'ECDSA' ||
    (issuer.algorithm as EcKeyAlgorithm).namedCurve !== 'P-256' ||
    !issuer.usages.includes('sign') ||
    pinned?.kty !== 'EC' || pinned.crv !== 'P-256' ||
    typeof pinned.x !== 'string' || typeof pinned.y !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(pinned.x) ||
    !/^[A-Za-z0-9_-]{43}$/.test(pinned.y) ||
    pinned.d !== undefined) {
    return DISABLED
  }

  const pendingStore = createPostgresManualPairingStore(options.pool)
  const candidate = createPendingPairingWorkflow(trustedContext, {
    enabled: true, expectedSiteId: options.expectedSiteId,
    store: pendingStore, now: options.now
  })
  const receiptIssuer = createVerifiedPairingEvidenceIssuer(options.pool, {
    enabled: true, siteId: options.expectedSiteId,
    signingKey: issuer, now: options.now
  })
  const operator = createSignedOperatorPairingGate(options.pool, {
    enabled: true, expectedSiteId: options.expectedSiteId,
    operatorPublicKey: pinned, now: options.now
  })

  // Deliberately expose only candidate methods, signed evidence, and
  // independent signed operator action; never raw Postgres store methods.
  return Object.freeze({
    request: candidate.request,
    prove: candidate.prove,
    evidence: receiptIssuer.issue.bind(receiptIssuer, trustedContext),
    applySignedOperatorAction: operator.apply
  })
}
