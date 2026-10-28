import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createPendingPairingWorkflow, pairingProofMessage } from '../src/server/manualPairingProtocol'
import { createPostgresManualPairingStore } from '../src/server/postgresManualPairingStore'
import { createVerifiedPairingEvidenceIssuer } from '../src/server/verifiedPairingEvidenceIssuer'
import {
  createSignedOperatorPairingGate, operatorCommandBytes,
  type OperatorCommand
} from '../src/server/signedOperatorPairingGate'
import {
  makeEvidenceIssuerTrust, verifySignedPairingEvidence,
  requestFromVerifiedEvidence
} from '../tools/trusted-pairing-evidence.mjs'

if (process.env.PGHOST !== '127.0.0.1' ||
  process.env.PGDATABASE !== 'sync_fixture_test') {
  throw Error('Refusing to run signed-receipt test against any non-ephemeral DB')
}
const pool=new pg.Pool({
  host:'127.0.0.1',port:5432,database:'sync_fixture_test',
  user:process.env.PGUSER||'test_user',
  password:process.env.PGPASSWORD||'test_password',
  max:4
})
const siteId='fa442ee9-e077-412c-b9ad-f8a95dbc7e2f'
const ownerId='18d97d1e-4b4f-4d4e-9dbd-d48ecc48be83'
const context={site:{id:siteId},
  user:{id:ownerId,expiresAt:new Date(Date.now()+300_000)}}
const store=createPostgresManualPairingStore(pool)
const workflow=createPendingPairingWorkflow(context,{
  expectedSiteId:siteId,enabled:true,store
})
const evidenceKeys=await crypto.subtle.generateKey({
  name:'ECDSA',namedCurve:'P-256'
},false,['sign','verify'])
const publicJwk=await crypto.subtle.exportKey('jwk',evidenceKeys.publicKey)
const trust=makeEvidenceIssuerTrust(siteId,publicJwk)
const issuer=createVerifiedPairingEvidenceIssuer(pool,{
  enabled:true,siteId,signingKey:evidenceKeys.privateKey
})
const phone=await crypto.subtle.generateKey({
  name:'ECDSA',namedCurve:'P-256'
},false,['sign','verify'])
const phoneJwk=await crypto.subtle.exportKey('jwk',phone.publicKey)
const deviceId=crypto.randomUUID()
const operatorKeys=await crypto.subtle.generateKey({
  name:'ECDSA',namedCurve:'P-256'
},false,['sign','verify'])
const operatorPublicKey=await crypto.subtle.exportKey('jwk',operatorKeys.publicKey)
const gate=createSignedOperatorPairingGate(pool,{
  enabled:true,expectedSiteId:siteId,operatorPublicKey
})
async function applySignedEvidence(
  receipt: NonNullable<Awaited<ReturnType<typeof issuer.issue>>>
) {
  const trusted=requestFromVerifiedEvidence(receipt,trust)
  const command:OperatorCommand={
    ...trusted,nonce:crypto.randomUUID(),
    issuedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+90_000).toISOString()
  }
  const signature=Buffer.from(await crypto.subtle.sign({
    name:'ECDSA',hash:'SHA-256'
  },operatorKeys.privateKey,operatorCommandBytes(command))).toString('base64url')
  return gate.apply(command,signature)
}

try {
  for(const filename of [
    '20261028151000_sync_schema.sql',
    '20261028163500_device_proof_schema.sql',
    '20261028191000_pending_pairing.sql',
    '20261028203000_operator_signed_actions.sql'
  ]){
    await pool.query(readFileSync('docs/sql-drafts/'+filename,'utf8'))
  }
  const pending=await workflow.request(deviceId,phoneJwk)
  assert.ok(pending)
  assert.equal(await issuer.issue(context,'approve-publisher',pending!.requestId),null,
    'unproved candidate must not receive a server evidence signature')

  const proofBytes=pairingProofMessage({
    siteId,ownerId,requestId:pending!.requestId,
    nonce:pending!.nonce,deviceId,fingerprint:pending!.fingerprint
  })
  const signedPhone=new Uint8Array(await crypto.subtle.sign({
    name:'ECDSA',hash:'SHA-256'
  },phone.privateKey,proofBytes))
  const signature=Buffer.from(signedPhone).toString('base64url')
  assert.equal(await workflow.prove(pending!.requestId,signature),true)

  const receipt=await issuer.issue(context,'approve-publisher',pending!.requestId)
  assert.ok(receipt)
  assert.equal(receipt!.evidence.ownerId,ownerId)
  assert.equal(receipt!.evidence.deviceId,deviceId)
  assert.equal(verifySignedPairingEvidence(receipt,trust),true)
  assert.deepEqual(requestFromVerifiedEvidence(receipt,trust),{
    version:1,action:'approve-publisher',siteId,ownerId,
    requestId:pending!.requestId,deviceId,fingerprint:pending!.fingerprint
  })
  assert.equal(await issuer.issue({
    site:{id:siteId},user:{id:crypto.randomUUID(),
      expiresAt:new Date(Date.now()+200_000)}
  },'approve-publisher',pending!.requestId),null,
    'different Netlify account cannot receive this pending proof')
  assert.equal(await issuer.issue(context,'approve-publisher',crypto.randomUUID()),null)

  assert.equal(await applySignedEvidence(receipt!),'approved',
    'trusted receipt plus a distinct operator signature required for approval')
  assert.equal(await issuer.issue(context,'approve-publisher',pending!.requestId),null,
    'approved pending request must not be reissued as pending')
  const revoke=await issuer.issue(context,'revoke-publisher',deviceId)
  assert.ok(revoke)
  assert.equal(revoke!.evidence.deviceId,deviceId)
  assert.equal(verifySignedPairingEvidence(revoke,trust),true)
  assert.equal(await applySignedEvidence(revoke!),'revoked')
  assert.equal(await issuer.issue(context,'revoke-publisher',deviceId),null,
    'revoked publisher must not receive new signed revoke receipt')
  console.log('[PASS] ephemeral PG: only proven pending and live registered phone yield pinned signed evidence')
} finally {
  await pool.end()
}
