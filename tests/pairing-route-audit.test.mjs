import assert from 'node:assert/strict'
import {test} from 'node:test'
import { auditRouteSource, auditPotentialRouteFiles }
  from '../tools/audit-pairing-routes.mjs'

test('reject old raw store approval and ad-hoc SQL in HTTP handlers',()=>{
  for(const snippet of [
    "import {createPostgresManualPairingStore} from '../../src/server/postgresManualPairingStore'",
    "const success = await store.approveByOperator(subject,id,fp)",
    "return store.revokeByOperator(subject,deviceId)",
    "await pool.query('UPDATE sync_publisher_devices SET revoked_at = now()')",
    "import {createSignedOperatorPairingGate} from '../../src/server/signedOperatorPairingGate'"
  ]){
    assert.ok(auditRouteSource('netlify/functions/approve.ts',snippet)
      .includes('route-direct-approval-or-database-permission-bypass'))
  }
})
test('new pairing HTTP handler must wire the unified composition root',()=>{
  const malicious=auditRouteSource(
    'netlify/functions/device-approve.ts','export default async ()=> Response.json({ok:true})'
  )
  assert.ok(malicious.includes('pairing-route-must-import-unified-gateway'))
  const safe=auditRouteSource(
    'netlify/functions/device-approve.ts',
    "import {createIsolatedPairingGateway} from '../../src/server/isolatedPairingGateway'"
  )
  assert.deepEqual(safe,[])
})
test('repo contains no direct HTTP routes to offline operator approval store',()=>{
  assert.deepEqual(auditPotentialRouteFiles(process.cwd()),[])
})
