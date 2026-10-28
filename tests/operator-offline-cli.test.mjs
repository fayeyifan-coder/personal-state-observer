import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSyntheticSignedEvidence } from './pairing-evidence-fixture.mjs'
import { requestFromVerifiedEvidence, verifySignedPairingEvidence } from '../tools/trusted-pairing-evidence.mjs'
import { createPublicKey, webcrypto, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createOfflineOperatorKey,
  createProposedCommand, signOfflineOperatorCommand,
  verifyOfflineOperatorCommand, operatorCommandBytes,
  fingerprintForOperatorKey
} from '../tools/operator-offline-core.mjs'
import { verifyOperatorCommand, operatorCommandBytes as serverCommandBytes }
  from '../src/server/signedOperatorPairingGate.ts'

const siteId='bb178423-5f8d-4b79-98b1-627179d25ea1'
const ownerId='37abfc4a-0e1f-4f95-9d0e-bd0e53cacdac'
const password='local synthetic only 4567!'
const {trust,receipt}=createSyntheticSignedEvidence({ownerId})
const { encryptedPrivatePem, manifest }=createOfflineOperatorKey(siteId,password,trust)
const candidate=requestFromVerifiedEvidence(receipt,trust)
const confirmation={
  ownerId,fingerprint:candidate.fingerprint,action:candidate.action
}
const now=Date.now()
const proposal=createProposedCommand(candidate,manifest,confirmation,now)
const signed=signOfflineOperatorCommand(
  proposal,encryptedPrivatePem,password,manifest,now,receipt)
const verifyConfig={
  operatorPublicKey:manifest.publicJwk,expectedSiteId:siteId,enabled:true,
  now:()=>now
}

test('encrypted PKCS8 key and strict public JWK manifest',()=>{
  assert.match(encryptedPrivatePem,/BEGIN ENCRYPTED PRIVATE KEY/)
  assert.doesNotMatch(encryptedPrivatePem,/BEGIN EC PRIVATE KEY/)
  assert.equal(manifest.siteId,siteId)
  assert.equal(fingerprintForOperatorKey(manifest.publicJwk),manifest.fingerprint)
  assert.equal('d' in manifest.publicJwk,false)
  assert.throws(()=>createOfflineOperatorKey(siteId,'short'),/至少需要 16/)
})

test('raw P1363 offline signature byte-for-byte matches backend',async()=>{
  const local=operatorCommandBytes(proposal,now)
  const server=Buffer.from(serverCommandBytes(proposal))
  assert.deepEqual(local,server)
  assert.equal(Buffer.from(signed.signature,'base64url').length,64)
  assert.equal(verifyOfflineOperatorCommand(signed,manifest,now),true)
  assert.equal(await verifyOperatorCommand(proposal,signed.signature,verifyConfig),true)
  const publicKey=await webcrypto.subtle.importKey(
    'jwk',{...manifest.publicJwk,ext:true},
    {name:'ECDSA',namedCurve:'P-256'},false,['verify'])
  const ok=await webcrypto.subtle.verify(
    {name:'ECDSA',hash:'SHA-256'},publicKey,
    Buffer.from(signed.signature,'base64url'),server)
  assert.equal(ok,true)
})

test('candidate requires out-of-band typed owner, exact full fingerprint and action',()=>{
  assert.throws(()=>createProposedCommand(candidate,manifest,{
    ...confirmation,fingerprint:'cd'.repeat(32)
  },now),/不一致/)
  assert.throws(()=>createProposedCommand(candidate,manifest,{
    ...confirmation,ownerId:randomUUID()
  },now),/不一致/)
  assert.throws(()=>createProposedCommand(candidate,manifest,{
    ...confirmation,action:'revoke-publisher'
  },now),/不一致/)
  assert.throws(()=>createProposedCommand({
    ...candidate,siteId:randomUUID()
  },manifest,confirmation,now),/字段不匹配/)
  assert.throws(()=>createProposedCommand({
    ...candidate,privateKey:'not allowed'
  },manifest,confirmation,now),/字段不匹配/)
})

test('wrong operator key, wrong passphrase and tampering fail closed',async()=>{
  assert.throws(()=>signOfflineOperatorCommand(
    proposal,encryptedPrivatePem,'wrong passphrase',manifest,now,receipt))
  const unrelated=createOfflineOperatorKey(siteId,password,trust)
  assert.throws(()=>signOfflineOperatorCommand(
    proposal,unrelated.encryptedPrivatePem,password,manifest,now,receipt),/不对应/)
  for(const item of [
    {...proposal,action:'revoke-publisher'},
    {...proposal,ownerId:randomUUID()},
    {...proposal,deviceId:randomUUID()},
    {...proposal,fingerprint:'fa'.repeat(32)},
    {...proposal,nonce:randomUUID()}
  ]) {
    assert.equal(verifyOfflineOperatorCommand({...signed,command:item},manifest,now),false)
    assert.equal(await verifyOperatorCommand(item,signed.signature,verifyConfig),false)
  }
  assert.equal(verifyOfflineOperatorCommand(signed,manifest,now+180_000),false)
  assert.equal(await verifyOperatorCommand(proposal,signed.signature,{
    ...verifyConfig,now:()=>now+180_000
  }),false)
  assert.equal(await verifyOperatorCommand(proposal,signed.signature,{
    ...verifyConfig,enabled:false
  }),false)
  assert.equal(await verifyOperatorCommand(proposal,signed.signature,{
    ...verifyConfig,expectedSiteId:randomUUID()
  }),false)
})

test('revoke uses distinct signed action and cannot be changed into approve',async()=>{
  const rev={...candidate,action:'revoke-publisher',requestId:randomUUID()}
  const command=createProposedCommand(rev,manifest,{
    ownerId,fingerprint:rev.fingerprint,action:rev.action
  },now)
  const revokeFixture=createSyntheticSignedEvidence({action:'revoke-publisher',ownerId,deviceId:rev.deviceId,requestId:rev.requestId,fingerprint:rev.fingerprint})
  const revokeKey=createOfflineOperatorKey(siteId,password,revokeFixture.trust)
  const revokeManifest=revokeKey.manifest
  const packet=signOfflineOperatorCommand(command,revokeKey.encryptedPrivatePem,password,revokeManifest,now,revokeFixture.receipt)
  assert.equal(await verifyOperatorCommand(command,packet.signature,{
    ...verifyConfig,operatorPublicKey:revokeManifest.publicJwk
  }),true)
  assert.equal(verifyOfflineOperatorCommand({...packet,command:{
    ...command,action:'approve-publisher'
  }},revokeManifest,now),false)
})


test('server evidence must be signed, current and pinned to operator key',()=>{
  assert.equal(verifySignedPairingEvidence(receipt,trust,now),true)
  const changed={...receipt,evidence:{...receipt.evidence,fingerprint:'ff'.repeat(32)}}
  assert.equal(verifySignedPairingEvidence(changed,trust,now),false)
  assert.throws(()=>signOfflineOperatorCommand(
    proposal,encryptedPrivatePem,password,manifest,now,changed
  ),/服务器签名/)
  assert.throws(()=>signOfflineOperatorCommand(
    proposal,encryptedPrivatePem,password,manifest,now,null
  ),/服务器签名/)
  const fake=createSyntheticSignedEvidence({
    ...receipt.evidence,action:'approve-publisher'
  })
  assert.equal(verifySignedPairingEvidence(fake.receipt,trust,now),false,
    'replacement issuer key cannot forge trusted server evidence')
  const swapped={...manifest,receiptIssuer:fake.trust}
  assert.throws(()=>createProposedCommand(candidate,swapped,confirmation,now),
    /公钥已被篡改|绑定/)
  const swappedFingerprint={...manifest,receiptIssuerBinding:'A'.repeat(86)}
  assert.throws(()=>createProposedCommand(candidate,swappedFingerprint,confirmation,now))
  const legacy=createOfflineOperatorKey(siteId,password)
  assert.throws(()=>signOfflineOperatorCommand(proposal,
    legacy.encryptedPrivatePem,password,legacy.manifest,now,receipt),/旧版/)
})

test('CLI refuses non-interactive key creation and accepts no password flags',()=>{
  const fixture=mkdtempSync(join(tmpdir(),'pso-operator-cli-'))
  try {
    const cli=resolve('tools/operator-offline.mjs')
    const out=join(fixture,'brand-new-key')
    writeFileSync(join(fixture,'trusted.json'),JSON.stringify(trust))
    const refuse=spawnSync(process.execPath,
      [cli,'init','--dir',out,'--site-id',siteId,'--issuer',join(fixture,'trusted.json')],
      {encoding:'utf8',input:''})
    assert.notEqual(refuse.status,0)
    assert.equal(existsSync(out),false)
    const secret=spawnSync(process.execPath,
      [cli,'init','--dir',out,'--site-id',siteId,'--issuer',join(fixture,'trusted.json'),'--passphrase','leaked'],
      {encoding:'utf8'})
    assert.notEqual(secret.status,0)
    assert.equal(existsSync(out),false)
    // Even an already-signed fixture can be checked with zero secrets or network.
    const dir=join(fixture,'fixture-key')
    mkdirSync(dir)
    writeFileSync(join(dir,'operator-public.json'),
      JSON.stringify(manifest))
    writeFileSync(join(dir,'operator-encrypted-private.pem'),encryptedPrivatePem)
    const receipt=join(fixture,'signed-packet.json')
    writeFileSync(receipt,JSON.stringify(signed))
    const verified=spawnSync(process.execPath,[
      cli,'verify','--dir',dir,'--signed',receipt
    ],{encoding:'utf8'})
    assert.equal(verified.status,0,
      'CLI verify fails: '+verified.stderr)
    assert.match(verified.stdout,/签名格式验证通过/)
  }finally{rmSync(fixture,{recursive:true,force:true})}
})
