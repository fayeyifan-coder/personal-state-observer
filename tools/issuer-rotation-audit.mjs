import { createPublicKey, verify as nodeVerify } from 'node:crypto'
import { assertOperatorManifest, PINNED_MANIFEST_VERSION } from './operator-offline-core.mjs'
import { assertEvidenceIssuerTrust, receiptPublicFields } from './trusted-pairing-evidence.mjs'

/**
 * OFFLINE, READ-ONLY issuer key continuity audit.
 * No key is installed, rotated or trusted by this module.
 * The old issuer, proposed new issuer AND separately held operator key must
 * all sign the same short-lived replacement notice.
 *
 * Loss/compromise of either old private key is a MANUAL RECOVERY STOP,
 * never an occasion to accept a bare new JSON or an unsigned replacement.
 */
const DOMAIN='personal-state-observer:evidence-issuer-continuity:v1'
const SCHEMA='pso-issuer-rotation-attestations-v1'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FP=/^[0-9a-f]{64}$/
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const SIG=/^[A-Za-z0-9_-]{86}$/
const exact=(obj,keys)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k))

export function issuerRotationBytes(notice,now=Date.now()) {
  if(!exact(notice,[
    'version','siteId','oldFingerprint','newIssuer','nonce',
    'issuedAt','expiresAt'
  ]) || notice.version!==1 || !UUID.test(notice.siteId) ||
    !UUID.test(notice.nonce) || !FP.test(notice.oldFingerprint) ||
    !ISO.test(notice.issuedAt) || !ISO.test(notice.expiresAt)) {
    throw Error('rotation-notice-invalid')
  }
  assertEvidenceIssuerTrust(notice.newIssuer)
  if(notice.newIssuer.siteId!==notice.siteId ||
    notice.oldFingerprint===notice.newIssuer.fingerprint) {
    throw Error('rotation-site-or-key-not-changing')
  }
  const started=Date.parse(notice.issuedAt),until=Date.parse(notice.expiresAt)
  if(!Number.isFinite(started)||!Number.isFinite(until)||
    started>now+30_000 || now-started>300_000 ||
    until<=now || until<=started || until-started>300_000) {
    throw Error('rotation-attestation-expired-or-too-long')
  }
  return Buffer.from([
    DOMAIN,'1',notice.siteId,notice.oldFingerprint,
    notice.newIssuer.fingerprint,
    notice.newIssuer.publicJwk.x,notice.newIssuer.publicJwk.y,
    notice.nonce,notice.issuedAt,notice.expiresAt
  ].join('\n'),'utf8')
}
function verifyP1363(bytes,signature,jwk) {
  if(typeof signature!=='string'||!SIG.test(signature))return false
  const raw=Buffer.from(signature,'base64url')
  if(raw.length!==64)return false
  const key=createPublicKey({key:receiptPublicFields(jwk),format:'jwk'})
  return nodeVerify('sha256',bytes,{key,dsaEncoding:'ieee-p1363'},raw)
}

/**
 * Deliberately returns an advisory only. This function never updates a v2
 * manifest, the server key registry, a stored trust anchor, or any device.
 * New trust installation requires a separate reviewed re-bootstrap with
 * an independently verified anchor and operator key lifecycle decision.
 */
export function auditIssuerRotation(attestations,operatorManifest,now=Date.now()) {
  try {
    const trusted=assertOperatorManifest(operatorManifest)
    if(trusted.schema!==PINNED_MANIFEST_VERSION ||
      !exact(attestations,[
        'schema','notice','oldIssuerSignature',
        'newIssuerSignature','operatorSignature'
      ]) || attestations.schema!==SCHEMA) {
      return {accepted:false,reason:'untrusted-manifest-or-format'}
    }
    const notice=attestations.notice
    const bytes=issuerRotationBytes(notice,now)
    if(notice.siteId!==trusted.siteId ||
      notice.oldFingerprint!==trusted.receiptIssuer.fingerprint) {
      return {accepted:false,reason:'wrong-site-or-previous-key'}
    }
    if(!verifyP1363(bytes,attestations.oldIssuerSignature,
        trusted.receiptIssuer.publicJwk) ||
      !verifyP1363(bytes,attestations.newIssuerSignature,
        notice.newIssuer.publicJwk) ||
      !verifyP1363(bytes,attestations.operatorSignature,
        trusted.publicJwk)) {
      return {accepted:false,reason:'missing-or-invalid-continuity-signature'}
    }
    return {
      accepted:true,
      reason:'continuity-proven-no-trust-change',
      oldFingerprint:notice.oldFingerprint,
      newFingerprint:notice.newIssuer.fingerprint,
      action:'STOP: review the new fingerprint independently, retire the old key, '+
        'and re-bootstrap an operator manifest by a separate trusted ceremony.'
    }
  }catch {
    return {accepted:false,reason:'invalid-or-expired-rotation-proof'}
  }
}
