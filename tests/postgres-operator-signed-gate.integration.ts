import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import {
  createPendingPairingWorkflow, pairingProofMessage, pairingFingerprint
} from '../src/server/manualPairingProtocol'
import {
  createSignedOperatorPairingGate, operatorCommandBytes,
  verifyOperatorCommand, type OperatorCommand
} from '../src/server/signedOperatorPairingGate'
import { createPostgresManualPairingStore } from '../src/server/postgresManualPairingStore'
import { createPostgresPublisherProofStore } from '../src/server/postgresPublisherProofStore'

if (process.env.PGHOST !== '127.0.0.1' ||
    process.env.PGDATABASE !== 'sync_fixture_test') {
  throw Error('REFUSE: signed-operator test MUST use local disposable PostgreSQL')
}
const pool = new pg.Pool({
  host: '127.0.0.1', port: 5432, database: 'sync_fixture_test',
  user: process.env.PGUSER || 'test_user',
  password: process.env.PGPASSWORD || 'test_password',
  max: 8
})
const siteId = 'bb178423-5f8d-4b79-98b1-627179d25ea1'
const userId = '37abfc4a-0e1f-4f95-9d0e-bd0e53cacdac'
const subject = 'netlify:' + siteId + ':' + userId
const badUser = 'c37b290c-1de0-4c81-b82d-033565ce700a'
const store = createPostgresManualPairingStore(pool)
const deviceProof = createPostgresPublisherProofStore(pool)
const ctx = { site: { id: siteId }, user: {
  id: userId, expiresAt: new Date(Date.now() + 300_000)
} }
const pendingWorkflow = createPendingPairingWorkflow(ctx, {
  expectedSiteId: siteId, enabled: true, store
})
const operatorKeys = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const attackerKeys = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
)
const operatorPublicKey = await crypto.subtle.exportKey('jwk', operatorKeys.publicKey)
const gate = createSignedOperatorPairingGate(pool, {
  operatorPublicKey, expectedSiteId: siteId, enabled: true
})
const disabledGate = createSignedOperatorPairingGate(pool, {
  operatorPublicKey, expectedSiteId: siteId, enabled: false
})
const makePair = async () => {
  const key = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign','verify']
  )
  return { key, jwk: await crypto.subtle.exportKey('jwk', key.publicKey) }
}
function command(partial: Partial<OperatorCommand> = {}): OperatorCommand {
  return {
    version: 1,
    action: 'approve-publisher',
    siteId, ownerId: userId,
    requestId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
    fingerprint: '0'.repeat(64),
    nonce: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    ...partial
  }
}
async function sign(c: OperatorCommand, key = operatorKeys.privateKey) {
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, operatorCommandBytes(c)
  ))
  return btoa(Array.from(signature, b => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function prove(p: NonNullable<Awaited<ReturnType<typeof pendingWorkflow.request>>>,
  deviceId: string, privateKey: CryptoKey) {
  const message = pairingProofMessage({
    siteId: p.siteId, ownerId: p.ownerId, requestId: p.requestId,
    nonce: p.nonce, deviceId, fingerprint: p.fingerprint
  })
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, message
  ))
  const encoded = btoa(Array.from(signature, b => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return pendingWorkflow.prove(p.requestId, encoded)
}

try {
  for (const file of [
    '20261028151000_sync_schema.sql',
    '20261028163500_device_proof_schema.sql',
    '20261028191000_pending_pairing.sql',
    '20261028203000_operator_signed_actions.sql'
  ]) {
    await pool.query(readFileSync('docs/sql-drafts/' + file, 'utf8'))
  }

  const phone = await makePair(), phoneId = crypto.randomUUID()
  const request = await pendingWorkflow.request(phoneId, phone.jwk)
  assert.ok(request)
  const unprovedCommand = command({
    requestId: request!.requestId, deviceId: phoneId,
    fingerprint: request!.fingerprint
  })
  assert.equal(await gate.apply(unprovedCommand, await sign(unprovedCommand)),
    'not-eligible', 'pending alone never authorizes even with a signed approval')
  assert.equal(await prove(request!, phoneId, phone.key.privateKey), true)
  assert.equal(await deviceProof.getRegisteredPublisher(subject, phoneId), null,
    'proof alone cannot grant publishing')

  const approved = command({
    requestId: request!.requestId, deviceId: phoneId,
    fingerprint: request!.fingerprint
  })
  const validSignature = await sign(approved)
  assert.equal(await verifyOperatorCommand(approved, validSignature, {
    operatorPublicKey, expectedSiteId: siteId, enabled: true
  }), true)
  assert.equal(await gate.apply(approved, await sign(approved, attackerKeys.privateKey)),
    'rejected', 'Netlify user and forged operator key do not grant rights')
  assert.equal(await disabledGate.apply(approved, validSignature), 'rejected',
    'disabled switch fails closed')
  assert.equal(await gate.apply({ ...approved, ownerId: badUser }, validSignature),
    'rejected', 'operator signature bound to Netlify subject')
  assert.equal(await gate.apply({ ...approved, fingerprint: 'a'.repeat(64) }, validSignature),
    'rejected', 'request cannot swap public fingerprint after signing')
  assert.equal(await gate.apply({ ...approved, deviceId: crypto.randomUUID() }, validSignature),
    'rejected', 'cannot swap device after signing')
  assert.equal(await gate.apply({ ...approved, action: 'revoke-publisher' }, validSignature),
    'rejected', 'cannot switch an approval into revocation')
  assert.equal(await gate.apply({
    ...approved,
    issuedAt: new Date(Date.now() - 500_000).toISOString(),
    expiresAt: new Date(Date.now() - 300_000).toISOString()
  }, validSignature), 'rejected', 'stale commands rejected')
  assert.equal(await deviceProof.getRegisteredPublisher(subject, phoneId), null)

  // Both requests use exactly the same signed, one-time operator command.
  const [a,b] = await Promise.all([
    gate.apply(approved, validSignature), gate.apply(approved, validSignature)
  ])
  assert.deepEqual([a,b].sort(), ['approved','replayed'])
  assert.equal((await deviceProof.getRegisteredPublisher(subject, phoneId))?.revoked, false)
  assert.equal(await gate.apply(approved, validSignature), 'replayed')
  const actionsAfterApproval = await pool.query(
    "SELECT count(*)::int AS n FROM sync_operator_actions " +
    "WHERE subject=$1 AND result='approved'",
    [subject]
  )
  assert.equal(actionsAfterApproval.rows[0].n, 1)

  const revoked = command({
    action: 'revoke-publisher',
    requestId: crypto.randomUUID(),
    deviceId: phoneId,
    fingerprint: await pairingFingerprint(phone.jwk)
  })
  const revokedSignature = await sign(revoked)
  // A validly signed but unsuccessful command intentionally consumes its
  // nonce, so each distinct operator attempt needs a fresh nonce.
  const wrongFingerprintCommand = {
    ...revoked, nonce: crypto.randomUUID(), fingerprint: 'f'.repeat(64)
  }
  assert.equal(await gate.apply(wrongFingerprintCommand,
    await sign(wrongFingerprintCommand)), 'not-eligible',
    'even a signed but mismatched fingerprint cannot revoke the wrong key')
  assert.equal(await gate.apply(wrongFingerprintCommand,
    await sign(wrongFingerprintCommand)), 'replayed',
    'unsuccessful signed commands consume their own nonce too')
  assert.equal((await deviceProof.getRegisteredPublisher(subject, phoneId))?.revoked, false)
  assert.equal(await gate.apply(revoked, revokedSignature), 'revoked')
  assert.equal(await gate.apply(revoked, revokedSignature), 'replayed')
  assert.equal((await deviceProof.getRegisteredPublisher(subject, phoneId))?.revoked, true)
  assert.equal(await deviceProof.issueChallenge(subject, phoneId, 90), null,
    'revoked phone cannot request new publishing challenges')

  // Revoke is scoped to exactly one owner and one device even when signed.
  const replayForOtherUser = command({
    ...revoked, nonce: crypto.randomUUID(), ownerId: badUser
  })
  assert.equal(await gate.apply(replayForOtherUser, await sign(replayForOtherUser)),
    'not-eligible', 'operator cannot accidentally revoke another owner')

  const newPhone = await makePair(), newDeviceId = crypto.randomUUID()
  const newRequest = await pendingWorkflow.request(newDeviceId, newPhone.jwk)
  assert.ok(newRequest, 'after operator revoke new device must re-prove key')
  const newCmd = command({
    requestId: newRequest!.requestId, deviceId: newDeviceId,
    fingerprint: newRequest!.fingerprint
  })
  assert.equal(await gate.apply(newCmd, await sign(newCmd)), 'not-eligible',
    'signed approval still cannot bypass pending possession proof')
  assert.equal(await prove(newRequest!, newDeviceId, newPhone.key.privateKey), true)
  const newApproved = command({
    requestId: newRequest!.requestId, deviceId: newDeviceId,
    fingerprint: newRequest!.fingerprint
  })
  assert.equal(await gate.apply(newApproved, await sign(newApproved)), 'approved')
  const active = await pool.query(
    'SELECT count(*)::int AS n FROM sync_publisher_devices ' +
    'WHERE subject=$1 AND revoked_at IS NULL', [subject]
  )
  assert.equal(active.rows[0].n, 1)
  console.log('[PASS] server-only signed operator gate: forgery/expiry/tamper blocked, atomic approval & revoke with replay protection')
} finally {
  await pool.end()
}
