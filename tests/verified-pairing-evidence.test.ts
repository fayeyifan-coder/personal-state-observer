import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPublicKey, createHash, randomUUID } from 'node:crypto'
import {
  createVerifiedPairingEvidenceIssuer, pairingEvidenceBytes
} from '../src/server/verifiedPairingEvidenceIssuer'
import {
  makeEvidenceIssuerTrust, evidenceBytes, verifySignedPairingEvidence,
  requestFromVerifiedEvidence
} from '../tools/trusted-pairing-evidence.mjs'
import { pairingFingerprint } from '../src/server/manualPairingProtocol'

const siteId='bb178423-5f8d-4b79-98b1-627179d25ea1'
const ownerId='37abfc4a-0e1f-4f95-9d0e-bd0e53cacdac'
const requestId=randomUUID(), deviceId=randomUUID()
const publicPair=await crypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
const phoneJwk=await crypto.subtle.exportKey('jwk',publicPair.publicKey)
const fingerprint=await pairingFingerprint(phoneJwk)
const signer=await crypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
const publicJwk=await crypto.subtle.exportKey('jwk',signer.publicKey)
const trust=makeEvidenceIssuerTrust(siteId,publicJwk)
const context={site:{id:siteId},user:{
  id:ownerId,expiresAt:new Date(Date.now()+180000)
}}
let eligible=true
let flippedFingerprint=false
const fakePool={
  async connect(){
    return {
      async query(sql:string, params:unknown[]){
        if(!eligible || params[0]!=='netlify:'+siteId+':'+ownerId) return {rows:[]}
        if(sql.includes('sync_pairing_requests') && params[1]===requestId)
          return {rows:[{
            request_id:requestId,device_id:deviceId,public_key_jwk:phoneJwk,
            fingerprint:flippedFingerprint?'f'.repeat(64):fingerprint,
            proved_at:new Date(Date.now()-1000),
            expires_at:new Date(Date.now()+85000)
          }]}
        if(sql.includes('sync_publisher_devices') && params[1]===deviceId)
          return {rows:[{device_id:deviceId,public_key_jwk:phoneJwk}]}
        return {rows:[]}
      },
      release(){}
    }
  }
}
const issuer=createVerifiedPairingEvidenceIssuer(fakePool as any,{
  enabled:true,siteId,signingKey:signer.privateKey
})

test('approve evidence signs exactly the offline bytes and proves key ownership record',async()=>{
  const packet=await issuer.issue(context,'approve-publisher',requestId)
  assert.ok(packet)
  assert.equal(packet?.schema,'pso-signed-pairing-evidence-v1')
  assert.deepEqual(Buffer.from(pairingEvidenceBytes(packet!.evidence)),
    evidenceBytes(packet!.evidence))
  assert.equal(verifySignedPairingEvidence(packet,trust),true)
  assert.equal(requestFromVerifiedEvidence(packet,trust).fingerprint,fingerprint)
  assert.equal(packet?.evidence.deviceId,deviceId)
  assert.equal(packet?.evidence.ownerId,ownerId)
  assert.equal(packet?.evidence.action,'approve-publisher')
  assert.equal(packet?.evidence.requestId,requestId)
  const tampered={...packet,evidence:{...packet!.evidence,deviceId:randomUUID()}}
  assert.equal(verifySignedPairingEvidence(tampered,trust),false)
  const modifiedFingerprint={...packet,evidence:{
    ...packet!.evidence,fingerprint:'0'.repeat(64)
  }}
  assert.equal(verifySignedPairingEvidence(modifiedFingerprint,trust),false)
  const wrongTrust=makeEvidenceIssuerTrust(siteId,
    (await crypto.subtle.exportKey('jwk',(await crypto.subtle.generateKey(
      {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])).publicKey)))
  assert.equal(verifySignedPairingEvidence(packet,wrongTrust),false)
  assert.equal(verifySignedPairingEvidence(packet,trust,
    Date.parse(packet!.evidence.expiresAt)+1),false)
})

test('authenticated context, valid proven DB row and exact public fingerprint required',async()=>{
  assert.equal(await issuer.issue({...context,site:{id:randomUUID()}},
    'approve-publisher',requestId),null)
  assert.equal(await issuer.issue({...context,user:{
    id:ownerId,expiresAt:new Date(0)
  }},'approve-publisher',requestId),null)
  assert.equal(await issuer.issue({...context,user:undefined},
    'approve-publisher',requestId),null)
  assert.equal(await issuer.issue(context,'approve-publisher',randomUUID()),null)
  flippedFingerprint=true
  assert.equal(await issuer.issue(context,'approve-publisher',requestId),null)
  flippedFingerprint=false
  eligible=false
  assert.equal(await issuer.issue(context,'approve-publisher',requestId),null)
  eligible=true
})

test('revoke receipt derives active key fingerprint and uses a new bound requestId',async()=>{
  const packet=await issuer.issue(context,'revoke-publisher',deviceId)
  assert.ok(packet)
  assert.equal(packet?.evidence.action,'revoke-publisher')
  assert.equal(packet?.evidence.deviceId,deviceId)
  assert.notEqual(packet?.evidence.requestId,deviceId)
  assert.equal(packet?.evidence.fingerprint,fingerprint)
  assert.equal(verifySignedPairingEvidence(packet,trust),true)
  const altered={...packet,evidence:{...packet!.evidence,
    action:'approve-publisher'}}
  assert.equal(verifySignedPairingEvidence(altered,trust),false)
  eligible=false
  assert.equal(await issuer.issue(context,'revoke-publisher',deviceId),null)
  eligible=true
})

test('issuer is disabled by default and cannot use extractable server private key',async()=>{
  const disabled=createVerifiedPairingEvidenceIssuer(fakePool as any,{
    enabled:false,siteId,signingKey:signer.privateKey
  })
  assert.equal(await disabled.issue(context,'approve-publisher',requestId),null)
  const extractable=await crypto.subtle.generateKey({
    name:'ECDSA',namedCurve:'P-256'
  },true,['sign','verify'])
  const insecure=createVerifiedPairingEvidenceIssuer(fakePool as any,{
    enabled:true,siteId,signingKey:extractable.privateKey
  })
  await assert.rejects(insecure.issue(context,'approve-publisher',requestId),
    /signer-invalid/)
})
