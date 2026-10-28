/**
 * S0 deployment-boundary preflight. This intentionally errs on the side of
 * rejecting code paths which would turn offline prototypes into live APIs.
 * It cannot prove absence of reflection or an arbitrary malicious import;
 * CI and manual code review remain required before any online deployment.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8'
}).split('\0').filter(Boolean)
const leaks = []
for (const path of files) {
  if (path.startsWith('netlify/functions/') ||
      path.startsWith('netlify/edge-functions/') ||
      path.startsWith('netlify/database/migrations/')) {
    leaks.push('unapproved deployment/migration entrypoint: ' + path)
  }
  if (!/^src\/.*\.[cm]?[jt]sx?$/.test(path)) continue
  const source = readFileSync(path, 'utf8')
  if (/\b(?:approveByOperator|revokeByOperator)\b/.test(source)) {
    leaks.push('legacy unsigned approval/revoke symbol is forbidden in src: ' + path)
  }
  if (!path.startsWith('src/server/') &&
      /\b(?:from|import)\s*(?:\(\s*)?['"][^'"]*(?:\/server\/|^server\/)/.test(source)) {
    leaks.push('browser-capable source imports server-only module: ' + path)
  }
  if (path.startsWith('src/server/') &&
      /\bfrom\s*['"][^'"]*\/db\//.test(source)) {
    leaks.push('server contract imports client IndexedDB module: ' + path)
  }
}
assert.deepEqual(leaks, [], 'S0 NO-GO, review unapproved entrypoints: ' +
  leaks.join('; '))
console.log('[PASS] S0 static boundary: no hosted Function, automatic SQL migration, unsigned approval caller or frontend server import')
