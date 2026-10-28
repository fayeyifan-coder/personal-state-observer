import assert from 'node:assert/strict'
import loginStatus from '../netlify/functions/lab-login-status.mjs'

const URL = 'https://cheerful-licorice-f4602a.netlify.app/.netlify/functions/lab-login-status'
const OK_CONTEXT = {
  site: { name: 'cheerful-licorice-f4602a', id: 'synthetic-no-real-id' },
  user: { id: 'synthetic-test-netlify-user', email: 'test@example.invalid',
    expiresAt: new Date(Date.now() + 60_000) }
}
const request = (url = URL, method = 'GET', headers = {}) =>
  new Request(url, { method, headers })

async function expectStatus(
  req: Request, ctx: unknown, status: number
): Promise<Record<string, unknown>> {
  const response = await loginStatus(req, ctx)
  assert.equal(response.status, status)
  assert.match(response.headers.get('cache-control') || '', /no-store/)
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/json')
  const text = await response.text()
  // No personal identifiers, token, email, site-id or DB credentials
  assert.doesNotMatch(text, /synthetic-test-netlify-user|test@example\.invalid|synthetic-no-real-id/)
  assert.doesNotMatch(text, /access_token|password|postgres|connectionString/)
  return JSON.parse(text)
}
const ok = await expectStatus(request(), OK_CONTEXT, 200)
assert.deepEqual(ok, {
  authenticated: true,
  status: 'verified-private-login',
  permission: 'read-only',
  cloudSync: 'not-configured'
})
assert.equal((await expectStatus(request(), { site: OK_CONTEXT.site }, 401)).authenticated, false)
assert.equal((await expectStatus(request(), {
  ...OK_CONTEXT, user: undefined
}, 401)).authenticated, false)
assert.equal((await expectStatus(request(), {
  ...OK_CONTEXT, user: { id: 'synthetic-test-netlify-user',
    expiresAt: new Date(Date.now() - 1000) }
}, 401)).authenticated, false)
assert.equal((await expectStatus(request(), {
  ...OK_CONTEXT, user: { id: 'synthetic-test-netlify-user' }
}, 401)).authenticated, false)
assert.equal((await expectStatus(request(), {
  ...OK_CONTEXT, user: { ...OK_CONTEXT.user, id: '' }
}, 401)).authenticated, false)
assert.equal((await expectStatus(
  request(URL, 'GET', { 'x-user-id': 'synthetic-test-netlify-user' }),
  { site: OK_CONTEXT.site }, 401)).authenticated, false)
assert.equal((await expectStatus(request(URL + '?who=me'), OK_CONTEXT, 200)).authenticated, true)
assert.equal((await expectStatus(request(
  'https://other-preview.netlify.app/.netlify/functions/lab-login-status'
), OK_CONTEXT, 404)).authenticated, false)
assert.equal((await expectStatus(request(
  'http://cheerful-licorice-f4602a.netlify.app/.netlify/functions/lab-login-status'
), OK_CONTEXT, 404)).authenticated, false)
assert.equal((await expectStatus(request(URL), {
  ...OK_CONTEXT, site: { name: 'attacker-private-project' }
}, 404)).authenticated, false)
assert.equal((await expectStatus(request(
  'https://cheerful-licorice-f4602a.netlify.app/api/different'
), OK_CONTEXT, 404)).authenticated, false)
assert.equal((await expectStatus(request(URL, 'POST'), OK_CONTEXT, 405)).authenticated, false)
console.log('[PASS] read-only Netlify Private login diagnostic: verified context only, no PII, no writes, strict host')
