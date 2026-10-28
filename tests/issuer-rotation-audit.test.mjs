import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createPrivateKey, generateKeyPairSync, randomUUID, sign
} from 'node:crypto'
import { createOfflineOperatorKey } from '../tools/operator-offline-core.mjs'
import { makeEvidenceIssuerTrust } from '../tools/trusted-pairing-evidence.mjs'
import { auditIssuerRotation, issuerRotationBytes } from '../tools/issuer-rotation-audit.mjs'

function prepare(){
  const siteId=randomUUID(),passphrase='synthetic-operator-only-789451!'
  const old=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  const next=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  const oldTrust=makeEvidenceIssuerTrust(siteId,old.publicKey.export({format:'jwk'}))
  const nextTrust=makeEvidenceIssuerTrust(siteId,next.publicKey.export({format:'jwk'}))
  const generated=createOfflineOperatorKey(siteId,passphrase,oldTrust)
  const operator=createPrivateKey({
    key:generated.encryptedPrivatePem,format:'pem',passphrase
  })
  const now=Date.now()
  const notice={
    version:1,siteId,oldFingerprint:oldTrust.fingerprint,
    newIssuer:nextTrust,nonce:randomUUID(),
    issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+120_000).toISOString()
  }
  function signNotice(n=notice,oldKey=old.privateKey,
    nextKey=next.privateKey,operatorKey=operator){
    const bytes=issuerRotationBytes(n,now)
    const encode=key=>sign('sha256',bytes,{
      key,dsaEncoding:'ieee-p1363'
    }).toString('base64url')
    return {
      schema:'pso-issuer-rotation-attestations-v1',notice:n,
      oldIssuerSignature:encode(oldKey),
      newIssuerSignature:encode(nextKey),
      operatorSignature:encode(operatorKey)
    }
  }
  return {siteId,old,next,oldTrust,nextTrust,generated,
    operator,now,notice,signNotice,packet:signNotice()}
}

test('signed continuity requires old issuer, new issuer and independent operator',()=>{
  const f=prepare(), result=auditIssuerRotation(
    f.packet,f.generated.manifest,f.now
  )
  assert.equal(result.accepted,true)
  assert.equal(result.reason,'continuity-proven-no-trust-change')
  assert.equal(result.oldFingerprint,f.oldTrust.fingerprint)
  assert.equal(result.newFingerprint,f.nextTrust.fingerprint)
  assert.equal(f.generated.manifest.receiptIssuer.fingerprint,
    f.oldTrust.fingerprint,'audit must NOT rotate stored trust')
  assert.equal('privateKey' in f.generated.manifest,false)
  assert.equal('d' in f.nextTrust.publicJwk,false)
})

test('even when signatures are valid, a stolen different operator cannot authorize',()=>{
  const f=prepare()
  const rogue=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  assert.equal(auditIssuerRotation(f.signNotice(
    f.notice,f.old.privateKey,f.next.privateKey,rogue.privateKey
  ),f.generated.manifest,f.now).accepted,false)
  assert.equal(auditIssuerRotation({
    ...f.packet,operatorSignature:'A'.repeat(86)
  },f.generated.manifest,f.now).accepted,false)
})

test('old issuer loss, replacement or unilateral server claim fails closed',()=>{
  const f=prepare(),rogue=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  assert.equal(auditIssuerRotation(f.signNotice(
    f.notice,rogue.privateKey,f.next.privateKey,f.operator
  ),f.generated.manifest,f.now).accepted,false)
  assert.equal(auditIssuerRotation({
    ...f.packet,oldIssuerSignature:'A'.repeat(86)
  },f.generated.manifest,f.now).accepted,false)
  assert.equal(auditIssuerRotation(f.signNotice(
    f.notice,f.old.privateKey,rogue.privateKey,f.operator
  ),f.generated.manifest,f.now).accepted,false)
})

test('tampering site, old/new public key, nonce, expiry or schema fails',()=>{
  const f=prepare()
  const attacks=[
    {...f.packet,notice:{...f.notice,siteId:randomUUID()}},
    {...f.packet,notice:{...f.notice,oldFingerprint:'0'.repeat(64)}},
    {...f.packet,notice:{...f.notice,nonce:randomUUID()}},
    {...f.packet,notice:{...f.notice,expiresAt:
      new Date(f.now+240_000).toISOString()}},
    {...f.packet,notice:{...f.notice,newIssuer:f.oldTrust}},
    {...f.packet,notice:{...f.notice,newIssuer:{
      ...f.nextTrust,publicJwk:{...f.nextTrust.publicJwk,x:f.oldTrust.publicJwk.x}
    }}},
    {...f.packet,schema:'pso-rotation-untrusted'},
    {...f.packet,operatorSignature:'A'.repeat(86)}
  ]
  attacks.forEach((attack,i)=>assert.equal(
    auditIssuerRotation(attack,f.generated.manifest,f.now).accepted,false,
    'tampered notice index '+i
  ))
  assert.equal(auditIssuerRotation(
    f.packet,f.generated.manifest,f.now+120_001
  ).accepted,false,'expired proof rejected')
})

test('cannot use an unpinned operator or roll back trust by reusing an old proof',()=>{
  const f=prepare()
  const legacy=createOfflineOperatorKey(f.siteId,
    'synthetic-operator-only-789451!')
  assert.equal(auditIssuerRotation(
    f.packet,legacy.manifest,f.now
  ).accepted,false)
  const unrelated=prepare()
  assert.equal(auditIssuerRotation(
    f.packet,unrelated.generated.manifest,f.now
  ).accepted,false)
  const tampered={
    ...f.generated.manifest,receiptIssuer:f.nextTrust
  }
  assert.equal(auditIssuerRotation(f.packet,tampered,f.now).accepted,false)

  // This is intentionally a read-only advisory, not a persistent transition.
  const first=auditIssuerRotation(f.packet,f.generated.manifest,f.now)
  const repeated=auditIssuerRotation(f.packet,f.generated.manifest,f.now)
  assert.equal(first.accepted,true)
  assert.equal(repeated.accepted,true)
  assert.equal(f.generated.manifest.receiptIssuer.fingerprint,
    f.oldTrust.fingerprint,'repeated proof cannot change local pinned key')
})
