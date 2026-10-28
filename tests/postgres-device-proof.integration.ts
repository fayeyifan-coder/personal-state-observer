import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createPostgresPublisherProofStore } from '../src/server/postgresPublisherProofStore'

if (process.env.PGHOST !== '127.0.0.1' ||
    process.env.PGDATABASE !== 'sync_fixture_test') {
  throw new Error('Refusing to connect to a non-disposable test database')
}
const pool = new pg.Pool({
  host: '127.0.0.1', port: 5432, database: 'sync_fixture_test',
  user: process.env.PGUSER || 'test_user',
  password: process.env.PGPASSWORD || 'test_password',
  max: 6
})
const store = createPostgresPublisherProofStore(pool)
const subject = 'netlify:synthetic-site:synthetic-owner'
const other = 'netlify:synthetic-site:other-owner'
const phoneId = '394f4c9e-cd1a-4240-a959-3f54e53a832d'
const otherPhone = '9fd5c9db-ccba-4a4b-b4dd-2cba532abafb'
try {
  // This suite runs after the snapshot transaction suite in the SAME
  // disposable CI database. Initialize base schema only if absent.
  const { rows: schemaRows } = await pool.query(
    "SELECT to_regclass('public.sync_heads') AS table_name"
  )
  if (!schemaRows[0].table_name) {
    await pool.query(readFileSync(
      'docs/sql-drafts/20261028151000_sync_schema.sql', 'utf8'
    ))
  }
  await pool.query(readFileSync(
    'docs/sql-drafts/20261028163500_device_proof_schema.sql', 'utf8'
  ))
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  await pool.query(
    'INSERT INTO sync_publisher_devices (subject, device_id, public_key_jwk) ' +
    'VALUES ($1, $2, $3::jsonb),($4, $5, $3::jsonb)',
    [subject, phoneId, JSON.stringify(jwk), other, otherPhone]
  )
  assert.equal((await store.getRegisteredPublisher(subject, phoneId))?.revoked, false)
  assert.equal(await store.getRegisteredPublisher(other, phoneId), null)

  const three = await Promise.all([
    store.issueChallenge(subject, phoneId, 90),
    store.issueChallenge(subject, phoneId, 90),
    store.issueChallenge(subject, phoneId, 90)
  ])
  assert.ok(three.every(c => c?.nonce))
  assert.equal((await store.issueChallenge(subject, phoneId, 90)), null,
    'fourth pending challenge blocked even under concurrent issuance')
  const first = three[0]!.nonce
  assert.equal(await store.consumeChallenge(other, phoneId, first), false)
  const simultaneous = await Promise.all([
    store.consumeChallenge(subject, phoneId, first),
    store.consumeChallenge(subject, phoneId, first)
  ])
  assert.deepEqual(simultaneous.sort(), [false, true], 'exactly one consume wins')
  assert.equal(await store.consumeChallenge(subject, phoneId, first), false)
  assert.ok((await store.issueChallenge(subject, phoneId, 90))?.nonce,
    'releasing consumed slot permits issuing a new challenge')

  const expiring = await store.issueChallenge(other, otherPhone, 1)
  assert.ok(expiring?.nonce)
  await pool.query(
    'UPDATE sync_device_challenges SET expires_at = now() - interval \'1 second\' ' +
    'WHERE subject=$1 AND device_id=$2 AND nonce=$3',
    [other, otherPhone, expiring!.nonce]
  )
  assert.equal(await store.consumeChallenge(other, otherPhone, expiring!.nonce), false)
  assert.equal(await store.issueChallenge(other, otherPhone, 91), null)

  await assert.rejects(
    pool.query(
      'INSERT INTO sync_publisher_devices(subject, device_id, public_key_jwk) ' +
      'VALUES($1,$2,$3::jsonb)',
      [subject, crypto.randomUUID(), JSON.stringify(jwk)]
    ),
    /duplicate key/,
    'database prevents multiple active publisher devices per account'
  )

  await pool.query(
    'UPDATE sync_publisher_devices SET revoked_at = now() ' +
    'WHERE subject=$1 AND device_id=$2', [subject, phoneId]
  )
  assert.equal((await store.getRegisteredPublisher(subject, phoneId))?.revoked, true)
  assert.equal(await store.consumeChallenge(subject, phoneId, three[1]!.nonce), false,
    'revocation immediately blocks even previously issued challenges')
  assert.equal(await store.issueChallenge(subject, phoneId, 90), null)
  assert.equal((await store.getRegisteredPublisher(other, otherPhone))?.revoked, false)
  const replacement = crypto.randomUUID()
  await pool.query(
    'INSERT INTO sync_publisher_devices(subject, device_id, public_key_jwk) ' +
    'VALUES ($1,$2,$3::jsonb)',
    [subject, replacement, JSON.stringify(jwk)]
  )
  assert.ok((await store.issueChallenge(subject, replacement, 90))?.nonce,
    'after revocation a new explicitly registered publisher can be used')
  console.log('[PASS] ephemeral PG: device revocation, publisher uniqueness, atomic nonce consume, expiry, quotas')
} finally {
  await pool.end()
}
