#!/usr/bin/env node
/**
 * Purely in-memory, zero-network, zero-file-write self-test of the OFFLINE
 * pairing trust and operator signature protocol. All identities and keys
 * are random synthetic fixtures. This does not initialize a real key.
 */
import assert from 'node:assert/strict'
import { randomUUID, generateKeyPairSync, sign as nodeSign, webcrypto } from 'node:crypto'
import {
  makeEvidenceIssuerTrust, evidenceBytes,
  verifySignedPairingEvidence, requestFromVerifiedEvidence
} from './trusted-pairing-evidence.mjs'
import {
  createOfflineOperatorKey, assertOperatorManifest,
  createProposedCommand, signOfflineOperatorCommand,
  verifyOfflineOperatorCommand, operatorCommandBytes
} from './operator-offline-core.mjs'

if (process.argv.length !== 2 && !(
  process.argv.length === 3 && process.argv[2] === '--help'
)) {
  process.stderr.write('仅允许无参数的离线自检；不会接收账户、私钥或真实备份。\n')
  process.exitCode = 2
} else if (process.argv[2] === '--help') {
  process.stdout.write(
    'node tools/operator-offline-selftest.mjs\n' +
    '纯内存虚构密钥自检；不联网、不读取或写入文件，不生成真实审批密钥。\n'
  )
} else {
  const checks = []
  function pass(label, condition) {
    assert.equal(condition, true, label)
    checks.push(label)
  }
  try {
    const siteId = randomUUID(), ownerId = randomUUID()
    const deviceId = randomUUID(), requestId = randomUUID()
    const fingerprint = 'ab'.repeat(32)
    const clock = Date.now()

    const issuer = generateKeyPairSync('ec', {namedCurve:'prime256v1'})
    const trust = makeEvidenceIssuerTrust(
      siteId, issuer.publicKey.export({format:'jwk'})
    )
    const evidence = {
      version:1,action:'approve-publisher',siteId,ownerId,
      requestId,deviceId,fingerprint,
      evidenceAt:new Date(clock-1000).toISOString(),
      issuedAt:new Date(clock).toISOString(),
      expiresAt:new Date(clock+90_000).toISOString()
    }
    const signature = nodeSign('sha256',evidenceBytes(evidence,clock),{
      key:issuer.privateKey,dsaEncoding:'ieee-p1363'
    }).toString('base64url')
    const receipt = {
      schema:'pso-signed-pairing-evidence-v1', evidence, signature
    }
    pass('虚构服务器证据签名可以离线验证',
      verifySignedPairingEvidence(receipt,trust,clock))
    pass('未信任的服务器公钥不能验真',
      !verifySignedPairingEvidence(
        receipt,makeEvidenceIssuerTrust(siteId,
          generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'})
        ),clock
      ))
    pass('篡改证据指纹被拒绝',!verifySignedPairingEvidence(
      {...receipt,evidence:{...evidence,fingerprint:'cd'.repeat(32)}},
      trust,clock
    ))
    pass('过期凭证被拒绝',
      !verifySignedPairingEvidence(receipt,trust,clock+91_000))

    const password = randomUUID() + '-synthetic-only'
    const {encryptedPrivatePem,manifest} =
      createOfflineOperatorKey(siteId,password,trust)
    pass('私钥是加密 PKCS#8，且没有被输出', 
      encryptedPrivatePem.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----') &&
      !encryptedPrivatePem.includes(password))
    pass('审批密钥已绑定可信服务器公钥',
      assertOperatorManifest(manifest).receiptIssuer.fingerprint === trust.fingerprint)
    const spoofedManifest = {
      ...manifest,receiptIssuer:makeEvidenceIssuerTrust(siteId,
        generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'})
      )
    }
    let blocked = false
    try {assertOperatorManifest(spoofedManifest)} catch {blocked = true}
    pass('更换服务器签发公钥会触发绑定失败',blocked)

    const request = requestFromVerifiedEvidence(receipt,trust,clock)
    const confirmed = {
      action:request.action,ownerId,fingerprint
    }
    const command = createProposedCommand(request,manifest,confirmed,clock)
    const packet = signOfflineOperatorCommand(
      command,encryptedPrivatePem,password,manifest,clock,receipt
    )
    pass('操作员生成有效短期离线批准签名',
      verifyOfflineOperatorCommand(packet,manifest,clock))
    const publicKey = await webcrypto.subtle.importKey(
      'jwk',{...manifest.publicJwk,ext:true},
      {name:'ECDSA',namedCurve:'P-256'},false,['verify']
    )
    const verify = await webcrypto.subtle.verify(
      {name:'ECDSA',hash:'SHA-256'},publicKey,
      Buffer.from(packet.signature,'base64url'),operatorCommandBytes(command,clock)
    )
    pass('Windows Node 签名与服务端 WebCrypto 验签兼容',verify)

    let rejected = false
    try {signOfflineOperatorCommand(command,
      encryptedPrivatePem,password,manifest,clock,null)
    } catch {rejected = true}
    pass('没有服务器凭证不能签署',rejected)
    rejected = false
    try {signOfflineOperatorCommand(command,
      encryptedPrivatePem,password,manifest,clock,{
        ...receipt,evidence:{...evidence,deviceId:randomUUID()}
      })
    } catch {rejected = true}
    pass('篡改设备申请不能签署',rejected)
    rejected = false
    try {signOfflineOperatorCommand(command,
      encryptedPrivatePem,'wrong password',manifest,clock,receipt)
    } catch {rejected = true}
    pass('错误审批口令不能解锁私钥',rejected)
    rejected = false
    try {signOfflineOperatorCommand(command,
      encryptedPrivatePem,password,manifest,clock+91_000,receipt)
    } catch {rejected = true}
    pass('失效申请不能继续审批',rejected)
    rejected = false
    const old = createOfflineOperatorKey(siteId,password)
    try {signOfflineOperatorCommand(command,old.encryptedPrivatePem,
      password,old.manifest,clock,receipt)
    } catch {rejected = true}
    pass('无固定服务器信任的旧密钥不能签发新审批',rejected)

    process.stdout.write(
      'PASS：' + checks.length + ' 项离线虚构安全自检。\n' +
      '未读取或写入任何文件，未联网，也未授权任何设备。\n'
    )
  } catch (error) {
    process.stderr.write('FAIL：离线自检未通过；不要继续操作员配对。\n')
    process.exitCode = 1
  }
}
