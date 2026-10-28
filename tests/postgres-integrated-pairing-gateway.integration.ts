import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createIsolatedPairingGateway } from '../src/server/isolatedPairingGateway'
import { pairingProofMessage } from '../src/server/manualPairingProtocol'
import { operatorCommandBytes, type OperatorCommand } from '../src/server/signedOperatorPairingGate'
import { makeEvidenceIssuerTrust, verifySignedPairingEvidence }
  from '../tools/trusted-pairing-evidence.mjs'

if (process.env.PGHOST !== '127.0.0.1' ||
    process.env.PGDATABASE !== 'sync_fixture_test') {
  throw Error('REFUSE: integrated gateway test requires disposable local PostgreSQL only')
}
const pool=new pg.Pool({
  host:'127.0.0.1',port:5432,database:'sync_fixture_test',
  user:process.env.PGUSER||'test_user',
  password:process.env.PGPASSWORD||'test_password',max:6
})
const siteId='61bc483c-11e7-4549-9d0d-6fa55028738e'
const ownerId='235f80a0-40d7-416c-bcf7-54d07a166bc6'
const context={site:{id:siteId},user:{id:ownerId,
  expiresAt:new Date(Date.now()+300_000)}}
const op=await crypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
const issuer=await crypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
const phone=await crypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
const operatorPublicKey=await crypto.subtle.exportKey('jwk',op.publicKey)
const trust=makeEvidenceIssuerTrust(siteId,
  await crypto.subtle.exportKey('jwk',issuer.publicKey))
const phoneJwk=await crypto.subtle.exportKey('jwk',phone.publicKey)
const deviceId=crypto.randomUUID()
const options={
  enabled:true,expectedSiteId:siteId,pool,pinnedOperatorPublicKey:operatorPublicKey,
  evidenceSigningKey:issuer.privateKey
}
const gateway=createIsolatedPairingGateway(context,options)
function signed(bytes: Uint8Array<ArrayBuffer>,key: CryptoKey) {
  return crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,bytes).then(
    signature=>Buffer.from(signature).toString('base64url')
  )
}
function command(
  requestId:string,fingerprint:string,action:OperatorCommand['action'],
  nonce=crypto.randomUUID()
):OperatorCommand{
  return {
    version:1,action,siteId,ownerId,requestId,deviceId,fingerprint,
    nonce,issuedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+90_000).toISOString()
  }
}
try {
  for(const file of [
    '20261028151000_sync_schema.sql',
    '20261028163500_device_proof_schema.sql',
    '20261028191000_pending_pairing.sql',
    '20261028203000_operator_signed_actions.sql'
  ]) {
    await pool.query(readFileSync('docs/sql-drafts/'+file,'utf8'))
  }

  const exposed=Object.keys(gateway).sort()
  assert.deepEqual(exposed,[
    'applySignedOperatorAction','evidence','prove','request'
  ],'gateway MUST NOT expose raw approveByOperator or revokeByOperator')

  for(const disabled of [
    {...options,enabled:false},
    {...options,pinnedOperatorPublicKey:null},
    {...options,evidenceSigningKey:null},
    {...options,expectedSiteId:crypto.randomUUID()}
  ]) {
    const dead=createIsolatedPairingGateway(context,disabled)
    assert.equal(await dead.request(deviceId,phoneJwk),null)
    assert.equal(await dead.prove(crypto.randomUUID(),'fake'),false)
    assert.equal(await dead.evidence('approve-publisher',crypto.randomUUID()),null)
    assert.equal(await dead.applySignedOperatorAction(
      command(crypto.randomUUID(),'a'.repeat(64),'approve-publisher'),'fake'
    ),'rejected')
  }

  const pending=await gateway.request(deviceId,phoneJwk)
  assert.ok(pending)
  assert.equal(await gateway.evidence('approve-publisher',pending!.requestId),null,
    'not-proven phone must not receive signed server evidence')
  const unsigned=command(
    pending!.requestId,pending!.fingerprint,'approve-publisher'
  )
  assert.equal(await gateway.applySignedOperatorAction(unsigned,'fake'),'rejected')
  assert.equal(await gateway.prove(pending!.requestId,'fake'),false)
  const proof=pairingProofMessage({
    siteId,ownerId,requestId:pending!.requestId,nonce:pending!.nonce,
    deviceId,fingerprint:pending!.fingerprint
  })
  assert.equal(await gateway.prove(pending!.requestId,await signed(proof,phone.privateKey)),true)
  const receipt=await gateway.evidence('approve-publisher',pending!.requestId)
  assert.ok(receipt)
  assert.equal(verifySignedPairingEvidence(receipt,trust),true)
  assert.equal(receipt!.evidence.fingerprint,pending!.fingerprint)

  const attacker=await crypto.subtle.generateKey({
    name:'ECDSA',namedCurve:'P-256'
  },false,['sign','verify'])
  const sig=await signed(operatorCommandBytes(unsigned),op.privateKey)
  const fakeSig=await signed(operatorCommandBytes(unsigned),attacker.privateKey)
  assert.equal(await gateway.applySignedOperatorAction(unsigned,fakeSig),'rejected')
  const [a,b]=await Promise.all([
    gateway.applySignedOperatorAction(unsigned,sig),
    gateway.applySignedOperatorAction(unsigned,sig)
  ])
  assert.deepEqual([a,b].sort(),['approved','replayed'])
  const subject='netlify:'+siteId+':'+ownerId
  const active=await pool.query(
    'SELECT count(*)::int AS n FROM sync_publisher_devices '+
    'WHERE subject=$1 AND revoked_at IS NULL',[subject]
  )
  assert.equal(active.rows[0].n,1)
  assert.equal(await gateway.evidence('approve-publisher',pending!.requestId),null,
    'approved pending must not be signed as pending again')

  const revokeEvidence=await gateway.evidence('revoke-publisher',deviceId)
  assert.ok(revokeEvidence)
  assert.equal(verifySignedPairingEvidence(revokeEvidence,trust),true)
  const revoked=command(
    revokeEvidence!.evidence.requestId,pending!.fingerprint,'revoke-publisher'
  )
  const revokeSignature=await signed(operatorCommandBytes(revoked),op.privateKey)
  assert.equal(await gateway.applySignedOperatorAction(revoked,revokeSignature),'revoked')
  assert.equal(await gateway.applySignedOperatorAction(revoked,revokeSignature),'replayed')
  assert.equal(await gateway.evidence('revoke-publisher',deviceId),null,
    'revoked device cannot obtain a fresh evidence receipt')
  const blocked=await pool.query(
    'SELECT count(*)::int AS n FROM sync_publisher_devices '+
    'WHERE subject=$1 AND revoked_at IS NULL',[subject]
  )
  assert.equal(blocked.rows[0].n,0)
  console.log('[PASS] integrated server gateway: disabled by default, phone proof, verified evidence, operator-only approval and revoke, replay denied')
} finally {
  await pool.end()
}
