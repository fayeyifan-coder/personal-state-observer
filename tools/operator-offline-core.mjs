import {
  createHash, createPrivateKey, createPublicKey,
  generateKeyPairSync, randomUUID, sign as nodeSign, verify as nodeVerify
} from 'node:crypto'
import { assertEvidenceIssuerTrust, verifySignedPairingEvidence, requestFromVerifiedEvidence } from './trusted-pairing-evidence.mjs'

/**
 * Windows OFFLINE operator tool. Never imports browser/session code, never
 * connects to Netlify or any database. Never log/private-export PEM.
 *
 * This must match src/server/signedOperatorPairingGate.ts byte-for-byte.
 */
export const DOMAIN = 'personal-state-observer:operator-pairing-action:v1'
export const MANIFEST_VERSION = 'pso-offline-operator-v1'
export const PINNED_MANIFEST_VERSION = 'pso-offline-operator-v2'
const PIN_DOMAIN = 'personal-state-observer:operator-evidence-trust-pin:v1'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OWNER = /^[A-Za-z0-9_-]{8,100}$/
const FP = /^[0-9a-f]{64}$/
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const ACTIONS = ['approve-publisher','revoke-publisher']
const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key)
const keysExactly = (obj,keys) => obj !== null && typeof obj==='object' &&
  !Array.isArray(obj) && Object.keys(obj).length===keys.length &&
  keys.every(key=>own(obj,key))

function canonicalPublicJwk(jwk) {
  if (!jwk || jwk.kty!=='EC' || jwk.crv!=='P-256' ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.x||'') ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.y||'') || own(jwk,'d')) {
    throw Error('仅支持公开的 P-256 操作员公钥')
  }
  return {kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y}
}
export function fingerprintForOperatorKey(jwk) {
  return createHash('sha256').update(JSON.stringify(canonicalPublicJwk(jwk))).digest('hex')
}

export function createOfflineOperatorKey(siteId,passphrase,trustedEvidenceIssuer=null) {
  if(!UUID.test(siteId)) throw Error('站点标识必须是完整 UUID')
  if(typeof passphrase!=='string' || [...passphrase].length<16 ||
    passphrase.length>1024) throw Error('审批密钥口令至少需要 16 个字符，且不能过长')
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve:'prime256v1',
    publicKeyEncoding:{type:'spki',format:'pem'},
    privateKeyEncoding:{
      type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase
    }
  })
  const jwk=canonicalPublicJwk(createPublicKey(publicKey).export({format:'jwk'}))
  const manifest={
    schema:MANIFEST_VERSION,siteId,
    publicJwk:jwk,fingerprint:fingerprintForOperatorKey(jwk),
    createdAt:new Date().toISOString()
  }
  if(trustedEvidenceIssuer!==null){
    assertEvidenceIssuerTrust(trustedEvidenceIssuer)
    if(trustedEvidenceIssuer.siteId!==siteId)
      throw Error('证据签发站点与操作员密钥站点不同')
    const signingKey=createPrivateKey({
      key:privateKey,format:'pem',passphrase
    })
    const bound=pinBytes(siteId,trustedEvidenceIssuer.fingerprint)
    const signature=nodeSign('sha256',bound,{
      key:signingKey,dsaEncoding:'ieee-p1363'
    })
    manifest.schema=PINNED_MANIFEST_VERSION
    manifest.receiptIssuer=trustedEvidenceIssuer
    manifest.receiptIssuerBinding=signature.toString('base64url')
  }
  return { encryptedPrivatePem:privateKey,manifest }
}

function pinBytes(siteId,issuerFingerprint){
  return Buffer.from([
    PIN_DOMAIN,siteId,issuerFingerprint
  ].join(String.fromCharCode(10)),'utf8')
}
export function assertOperatorManifest(manifest) {
  const pinned=manifest?.schema===PINNED_MANIFEST_VERSION
  if(!keysExactly(manifest,pinned
    ? ['schema','siteId','publicJwk','fingerprint','createdAt',
       'receiptIssuer','receiptIssuerBinding']
    : ['schema','siteId','publicJwk','fingerprint','createdAt']) ||
    ![MANIFEST_VERSION,PINNED_MANIFEST_VERSION].includes(manifest.schema) ||
    !UUID.test(manifest.siteId) || !ISO.test(manifest.createdAt) ||
    !FP.test(manifest.fingerprint) ||
    fingerprintForOperatorKey(manifest.publicJwk)!==manifest.fingerprint) {
    throw Error('本地操作员公钥清单格式或指纹错误')
  }
  if(pinned){
    assertEvidenceIssuerTrust(manifest.receiptIssuer)
    if(manifest.receiptIssuer.siteId!==manifest.siteId ||
      !/^[A-Za-z0-9_-]{86}$/.test(manifest.receiptIssuerBinding))
      throw Error('离线服务器证据公钥绑定无效')
    const signer=createPublicKey({
      key:canonicalPublicJwk(manifest.publicJwk),format:'jwk'
    })
    const valid=nodeVerify('sha256',pinBytes(
      manifest.siteId,manifest.receiptIssuer.fingerprint
    ),{key:signer,dsaEncoding:'ieee-p1363'},
      Buffer.from(manifest.receiptIssuerBinding,'base64url'))
    if(!valid)throw Error('证据签发公钥已被篡改或非此操作员密钥信任')
  }
  return manifest
}

function validCommand(c,now) {
  if(!keysExactly(c,[
    'version','action','siteId','ownerId','requestId','deviceId',
    'fingerprint','nonce','issuedAt','expiresAt'
  ]) || c.version!==1 || !ACTIONS.includes(c.action) ||
    !UUID.test(c.siteId) || !OWNER.test(c.ownerId) ||
    !UUID.test(c.requestId) || !UUID.test(c.deviceId) ||
    !FP.test(c.fingerprint) || !UUID.test(c.nonce) ||
    !ISO.test(c.issuedAt) || !ISO.test(c.expiresAt)) return false
  const start=Date.parse(c.issuedAt), expiry=Date.parse(c.expiresAt)
  return Number.isFinite(start) && Number.isFinite(expiry) &&
    expiry>now && start<=now+30_000 && expiry>start &&
    expiry-start<=120_000 && now-start<120_000
}

/** Exactly matches the P-256 server verifier domain and byte order. */
export function operatorCommandBytes(c,now=Date.now()) {
  if(!validCommand(c,now)) throw Error('操作指令字段或有效期错误')
  return Buffer.from([
    DOMAIN,String(c.version),c.action,c.siteId,c.ownerId,c.requestId,
    c.deviceId,c.fingerprint,c.nonce,c.issuedAt,c.expiresAt
  ].join('\n'),'utf8')
}
export function createProposedCommand(request,manifest,confirmation,now=Date.now()) {
  assertOperatorManifest(manifest)
  if (!keysExactly(request,
    ['version','action','siteId','ownerId','requestId','deviceId','fingerprint']) ||
    request.version!==1 || !ACTIONS.includes(request.action) ||
    request.siteId!==manifest.siteId ||
    !OWNER.test(request.ownerId) || !UUID.test(request.requestId) ||
    !UUID.test(request.deviceId) || !FP.test(request.fingerprint)) {
    throw Error('候选请求字段不匹配或未经验证')
  }
  if(!keysExactly(confirmation,['ownerId','fingerprint','action']) ||
    confirmation.ownerId!==request.ownerId ||
    confirmation.fingerprint!==request.fingerprint ||
    confirmation.action!==request.action) {
    throw Error('独立输入的账户、公钥指纹或操作类型不一致，已拒绝签名')
  }
  const c={
    version:1,action:request.action,siteId:manifest.siteId,
    ownerId:request.ownerId,requestId:request.requestId,
    deviceId:request.deviceId,fingerprint:request.fingerprint,
    nonce:randomUUID(),issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+90_000).toISOString()
  }
  operatorCommandBytes(c,now)
  return c
}

function unlock(encryptedPrivatePem,passphrase,manifest) {
  assertOperatorManifest(manifest)
  if(typeof encryptedPrivatePem!=='string' ||
    !encryptedPrivatePem.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    throw Error('仅接受加密 PKCS#8 私钥，拒绝明文私钥')
  }
  const key=createPrivateKey({key:encryptedPrivatePem,format:'pem',passphrase})
  const publicJwk=canonicalPublicJwk(createPublicKey(key).export({format:'jwk'}))
  if(fingerprintForOperatorKey(publicJwk)!==manifest.fingerprint ||
    JSON.stringify(publicJwk)!==JSON.stringify(canonicalPublicJwk(manifest.publicJwk))) {
    throw Error('私钥与此站点的操作员公钥清单不对应')
  }
  if (key.asymmetricKeyType!=='ec' ||
    key.asymmetricKeyDetails?.namedCurve!=='prime256v1') {
    throw Error('仅允许 P-256 ECDSA 审批私钥')
  }
  return key
}
export function signOfflineOperatorCommand(
  command,encryptedPem,passphrase,manifest,now=Date.now(),verifiedReceipt=null
){
  assertOperatorManifest(manifest)
  if(manifest.schema===PINNED_MANIFEST_VERSION){
    if(!verifiedReceipt ||
      !verifySignedPairingEvidence(verifiedReceipt,manifest.receiptIssuer,now))
      throw Error('缺少服务器签名且由操作员密钥固定信任的申请凭证')
    const original=requestFromVerifiedEvidence(
      verifiedReceipt,manifest.receiptIssuer,now
    )
    for(const field of ['action','siteId','ownerId','requestId','deviceId','fingerprint']){
      if(command[field]!==original[field])
        throw Error('待签指令与经验证的服务器候选内容不一致')
    }
  }else{
    // Legacy manifests are only retained to keep old test fixtures readable.
    // They are NOT allowed to generate new signed commands.
    throw Error('旧版未绑定服务器证据公钥的操作员密钥不能签署指令')
  }
  if(command.siteId!==manifest.siteId) throw Error('指令站点与审批密钥站点不一致')
  const bytes=operatorCommandBytes(command,now)
  const key=unlock(encryptedPem,passphrase,manifest)
  const raw=nodeSign('sha256',bytes,{key,dsaEncoding:'ieee-p1363'})
  if(raw.length!==64) throw Error('签名格式不是 WebCrypto 的 64 字节 P-256')
  const signed={schema:'pso-operator-command-v1',command,signature:raw.toString('base64url')}
  if(!verifyOfflineOperatorCommand(signed,manifest,now))throw Error('本机签名复核未通过')
  return signed
}
export function verifyOfflineOperatorCommand(signed,manifest,now=Date.now()) {
  try {
    assertOperatorManifest(manifest)
    if(!keysExactly(signed,['schema','command','signature']) ||
      signed.schema!=='pso-operator-command-v1' ||
      signed.command.siteId!==manifest.siteId ||
      !/^[A-Za-z0-9_-]{86}$/.test(signed.signature))return false
    const raw=Buffer.from(signed.signature,'base64url')
    if(raw.length!==64)return false
    const key=createPublicKey({key:{
      ...canonicalPublicJwk(manifest.publicJwk),ext:true
    },format:'jwk'})
    return nodeVerify('sha256',operatorCommandBytes(signed.command,now),
      {key,dsaEncoding:'ieee-p1363'},raw)
  }catch{return false}
}
