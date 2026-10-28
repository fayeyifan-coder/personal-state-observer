// Read-only identity diagnostic for the *synthetic-only* Private Netlify lab.
// This function has no imports from Dexie, backups, devices or databases.
// Publishing it to another site fails closed: it is intentionally bound to
// the existing test project's Netlify-managed hostname and site name.

const LAB_HOST = 'cheerful-licorice-f4602a.netlify.app'
const LAB_SITE_NAME = 'cheerful-licorice-f4602a'
const ROUTE = '/api/lab-login-status'

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  })
}

/**
 * Netlify verifies context.user for Private/team-login sites before invoking
 * Functions (available on deploys from 2026-10-05). Never use a header,
 * cookie, query parameter, or request body as a substitute for context.user.
 */
export default async function labLoginStatus(request, context) {
  let url
  try { url = new URL(request.url) } catch {
    return respond(404, { authenticated: false, status: 'unavailable' })
  }

  if (url.protocol !== 'https:' || url.host !== LAB_HOST ||
      url.pathname !== ROUTE ||
      context?.site?.name !== LAB_SITE_NAME) {
    return respond(404, { authenticated: false, status: 'unavailable' })
  }
  if (request.method !== 'GET') {
    return respond(405, { authenticated: false, status: 'method-not-allowed' })
  }
  const user = context?.user
  // Deny if Netlify did not provide a verified, non-expired login.
  const expiry = user?.expiresAt instanceof Date
    ? user.expiresAt.getTime()
    : typeof user?.expiresAt === 'string'
      ? Date.parse(user.expiresAt) : NaN
  if (typeof user?.id !== 'string' || user.id.trim() === '' ||
      !Number.isFinite(expiry) || expiry <= Date.now()) {
    return respond(401, {
      authenticated: false, status: 'login-not-confirmed'
    })
  }

  // Do not return id, email, expiry, auth token, site id or DB state.
  return respond(200, {
    authenticated: true,
    status: 'verified-private-login',
    permission: 'read-only',
    cloudSync: 'not-configured'
  })
}

export const config = {
  path: ROUTE,
  method: 'GET'
}
