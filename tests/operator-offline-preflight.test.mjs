import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createOfflineOperatorKey } from '../tools/operator-offline-core.mjs'
import { makeEvidenceIssuerTrust } from '../tools/trusted-pairing-evidence.mjs'

const selftest=resolve('tools/operator-offline-selftest.mjs')
const preflight=resolve('tools/operator-offline-preflight.mjs')
function run(script,args=[]){
  return spawnSync(process.execPath,[script,...args],{
    encoding:'utf8',timeout:10000
  })
}
test('public offline self-test runs with zero input or output files',()=>{
  const r=run(selftest)
  assert.equal(r.status,0,r.stderr)
  assert.match(r.stdout,/PASS：14 项离线虚构安全自检/)
  assert.match(r.stdout,/未读写任何用户数据、备份或凭据文件/)
  const denied=run(selftest,['--passphrase','secret'])
  assert.notEqual(denied.status,0)
  assert.doesNotMatch(denied.stdout,/PASS/)
})
test('public key trust preflight requires an independently supplied full fingerprint',()=>{
  const root=mkdtempSync(join(tmpdir(),'pso-operator-preflight-'))
  try{
    const siteId=randomUUID()
    const server=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
    const trust=makeEvidenceIssuerTrust(siteId,server.publicKey.export({format:'jwk'}))
    const generated=createOfflineOperatorKey(
      siteId,'local synthetic only password',trust
    )
    const name=join(root,'operator-public.json')
    writeFileSync(name,JSON.stringify(generated.manifest))
    const good=run(preflight,[
      '--manifest',name,'--trusted-issuer-fingerprint',trust.fingerprint
    ])
    assert.equal(good.status,0,good.stderr)
    assert.match(good.stdout,/PASS：公开操作员清单/)
    assert.doesNotMatch(good.stdout,/PRIVATE KEY/)
    assert.equal(existsSync(join(root,'operator-encrypted-private.pem')),false,
      'preflight must never write a private key')
    const original=readFileSync(name,'utf8')
    assert.equal(readFileSync(name,'utf8'),original,'read-only check must not mutate manifest')
    const noTrust=run(preflight,['--manifest',name])
    assert.notEqual(noTrust.status,0)
    const wrong=run(preflight,[
      '--manifest',name,'--trusted-issuer-fingerprint','0'.repeat(64)
    ])
    assert.notEqual(wrong.status,0)
    const anotherServer=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
    const different=makeEvidenceIssuerTrust(siteId,
      anotherServer.publicKey.export({format:'jwk'}))
    const altered={...generated.manifest,receiptIssuer:different}
    writeFileSync(name,JSON.stringify(altered))
    const swapped=run(preflight,[
      '--manifest',name,'--trusted-issuer-fingerprint',different.fingerprint
    ])
    assert.notEqual(swapped.status,0,
      'attacker must not swap server key even if supplying matching fake fingerprint')
    const legacy=createOfflineOperatorKey(siteId,'local synthetic only password')
    writeFileSync(name,JSON.stringify(legacy.manifest))
    const unpinned=run(preflight,[
      '--manifest',name,'--trusted-issuer-fingerprint',trust.fingerprint
    ])
    assert.notEqual(unpinned.status,0,'legacy operator key is not approved')
  }finally{rmSync(root,{recursive:true,force:true})}
})
