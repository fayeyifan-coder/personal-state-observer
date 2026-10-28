import { generateKeyPairSync, createHash, randomUUID, sign as nodeSign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeEvidenceIssuerTrust,evidenceBytes,verifySignedPairingEvidence } from '../tools/trusted-pairing-evidence.mjs'

export function createSyntheticSignedEvidence(overrides={}) {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  const siteId='bb178423-5f8d-4b79-98b1-627179d25ea1'
  const trust=makeEvidenceIssuerTrust(siteId,publicKey.export({format:'jwk'}))
  const now=Date.now()
  const evidence={
    version:1,action:'approve-publisher',siteId,
    ownerId:randomUUID(),requestId:randomUUID(),deviceId:randomUUID(),
    fingerprint:createHash('sha256').update('synthetic-phone-public-key').digest('hex'),
    evidenceAt:new Date(now-1000).toISOString(),
    issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+90_000).toISOString(),
    ...overrides
  }
  const signature=nodeSign('sha256',evidenceBytes(evidence,now),{
    key:privateKey,dsaEncoding:'ieee-p1363'
  }).toString('base64url')
  const receipt={schema:'pso-signed-pairing-evidence-v1',evidence,signature}
  return {trust,receipt}
}
if(process.argv[1]?.endsWith('pairing-evidence-fixture.mjs') && process.argv[2]==='--out'){
  const dir=path.resolve(process.argv[3]||'')
  if(!path.isAbsolute(process.argv[3]||'')||!dir.includes('pso-operator-'))
    throw Error('Fixture destination must be a disposable external pso-operator- directory')
  mkdirSync(dir,{recursive:true})
  const {trust,receipt}=createSyntheticSignedEvidence()
  if(!verifySignedPairingEvidence(receipt,trust))
    throw Error('synthetic receipt did not verify')
  writeFileSync(path.join(dir,'issuer.json'),JSON.stringify(trust),{flag:'wx'})
  writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt),{flag:'wx'})
  writeFileSync(path.join(dir,'fixture-labels.json'),JSON.stringify({
    ownerId:receipt.evidence.ownerId,fingerprint:receipt.evidence.fingerprint,
    action:'APPROVE',issuerFingerprint:trust.fingerprint
  }),{flag:'wx'})
  process.stdout.write('Synthetic signed evidence fixture created; issuer private key not stored.\n')
}
