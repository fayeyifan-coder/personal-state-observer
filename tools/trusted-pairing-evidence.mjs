import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto'

/**
 * OFFLINE evidence verifier. No fetch, Netlify, environment variables,
 * hard-coded server keys or dynamically downloaded public keys.
 * Trusted server public key MUST be pinned independently before using.
 */
export const EVIDENCE_SCHEMA = 'pso-signed-pairing-evidence-v1'
export const TRUST_SCHEMA = 'pso-pinned-evidence-issuer-v1'
export const EVIDENCE_DOMAIN = 'personal-state-observer:trusted-pairing-evidence:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FP = /^[0-9a-f]{64}$/
const OWNER = /^[A-Za-z0-9_-]{8,100}$/
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const exact = (o, names) => o && typeof o==='object' &&
  !Array.isArray(o) && Object.keys(o).length===names.length &&
  names.every(name=>Object.hasOwn(o,name))

export function receiptPublicFields(jwk) {
  if (!jwk || jwk.kty!=='EC'||jwk.crv!=='P-256'||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.x||'') ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.y||'') ||
    Object.hasOwn(jwk,'d')) throw Error('invalid-evidence-issuer-key')
  const publicJwk={kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y}
  const key=createPublicKey({key:publicJwk,format:'jwk'})
  if(key.asymmetricKeyType!=='ec' ||
    key.asymmetricKeyDetails?.namedCurve!=='prime256v1')
    throw Error('invalid-evidence-issuer-curve')
  return publicJwk
}
export function evidenceIssuerFingerprint(publicJwk) {
  return createHash('sha256').update(
    JSON.stringify(receiptPublicFields(publicJwk))
  ).digest('hex')
}
/** Creation of this manifest does NOT establish trust. It must be
 * transferred and pinned via a separately verified administrator channel.
 */
export function makeEvidenceIssuerTrust(siteId,publicJwk) {
  if(!UUID.test(siteId))throw Error('invalid-trust-site')
  const fields=receiptPublicFields(publicJwk)
  return {
    schema:TRUST_SCHEMA,siteId,publicJwk:fields,
    fingerprint:evidenceIssuerFingerprint(fields)
  }
}
export function assertEvidenceIssuerTrust(t) {
  if(!exact(t,['schema','siteId','publicJwk','fingerprint']) ||
    t.schema!==TRUST_SCHEMA || !UUID.test(t.siteId) ||
    !FP.test(t.fingerprint) ||
    evidenceIssuerFingerprint(t.publicJwk)!==t.fingerprint)
    throw Error('invalid-trusted-evidence-issuer')
  return t
}
function receiptFields(e,now) {
  if(!exact(e,[
    'version','action','siteId','ownerId','requestId','deviceId',
    'fingerprint','evidenceAt','issuedAt','expiresAt'
  ]) || e.version!==1 || !['approve-publisher','revoke-publisher'].includes(e.action) ||
    !UUID.test(e.siteId)||!OWNER.test(e.ownerId)||!UUID.test(e.requestId)||
    !UUID.test(e.deviceId)||!FP.test(e.fingerprint)||!ISO.test(e.evidenceAt)||
    !ISO.test(e.issuedAt)||!ISO.test(e.expiresAt))return false
  const proof=Date.parse(e.evidenceAt),issue=Date.parse(e.issuedAt),
    deadline=Date.parse(e.expiresAt)
  return Number.isFinite(proof)&&Number.isFinite(issue)&&
    Number.isFinite(deadline) && proof<=issue+30_000 &&
    issue<=now+30_000 && now-issue<120_000 &&
    deadline>now && deadline>issue && deadline-issue<=90_000
}
export function evidenceBytes(e,now=Date.now()) {
  if(!receiptFields(e,now))throw Error('expired-or-invalid-pairing-evidence')
  return Buffer.from([
    EVIDENCE_DOMAIN,String(e.version),e.action,e.siteId,e.ownerId,
    e.requestId,e.deviceId,e.fingerprint,e.evidenceAt,e.issuedAt,e.expiresAt
  ].join('\n'),'utf8')
}
export function verifySignedPairingEvidence(packet,trust,now=Date.now()) {
  try {
    assertEvidenceIssuerTrust(trust)
    if(!exact(packet,['schema','evidence','signature'])||
      packet.schema!==EVIDENCE_SCHEMA ||
      packet.evidence.siteId!==trust.siteId ||
      !/^[A-Za-z0-9_-]{86}$/.test(packet.signature))return false
    const raw=Buffer.from(packet.signature,'base64url')
    if(raw.length!==64)return false
    const publicKey=createPublicKey({
      key:receiptPublicFields(trust.publicJwk),format:'jwk'
    })
    return nodeVerify('sha256', evidenceBytes(packet.evidence,now),{
      key:publicKey,dsaEncoding:'ieee-p1363'
    },raw)
  }catch {return false}
}
export function requestFromVerifiedEvidence(packet,trust,now=Date.now()) {
  if(!verifySignedPairingEvidence(packet,trust,now))
    throw Error('申请来源未通过受信任服务器公钥验签，拒绝审批')
  const e=packet.evidence
  return {
    version:1,action:e.action,siteId:e.siteId,ownerId:e.ownerId,
    requestId:e.requestId,deviceId:e.deviceId,fingerprint:e.fingerprint
  }
}
