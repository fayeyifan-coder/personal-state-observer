/**
 * S4 synthetic-only capacity and release-boundary preflight.
 *
 * ZERO network, files, external credentials or Netlify API calls.
 * This is a planning model, NOT a billing estimate, deployment approval,
 * or a health-record upload implementation.
 */
const FREE_MONTHLY_CREDITS = 300
const DB_CREDIT_PER_COMPUTE_UNIT_HOUR = 10
const DEPLOY_CREDITS = 15
const FREE_DB_CU = 1
const DEFAULT_IDLE_MINUTES = 5

function requireInteger(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high) {
    throw Error('invalid-' + label)
  }
  return value
}

/**
 * One isolated wake cycle for each scheduled session. Active sessions
 * may overlap and reduce the total, but other traffic, long queries,
 * retries, build usage and the user's other sites can increase it.
 * NEVER treat this value as a total bill or a safe upper bound.
 */
export function illustrateFreeDbWakeCost(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Error('invalid-simulation')
  }
  const days = requireInteger(input.days, 1, 31, 'days')
  const sessionsPerDay = requireInteger(input.sessionsPerDay, 0, 1440, 'sessions')
  const minimumAwakeMinutes = requireInteger(
    input.minimumAwakeMinutes ?? DEFAULT_IDLE_MINUTES, 5, 60,
    'minimum-awake-minutes'
  )
  const productionDeploys = requireInteger(
    input.productionDeploys ?? 0, 0, 30, 'deploys'
  )
  const isolatedWakeHours = days * sessionsPerDay * minimumAwakeMinutes / 60
  const illustrativeDbComputeCredits =
    isolatedWakeHours * DB_CREDIT_PER_COMPUTE_UNIT_HOUR * FREE_DB_CU
  const deployCredits = productionDeploys * DEPLOY_CREDITS
  return {
    days, sessionsPerDay, isolatedWakeHours, illustrativeDbComputeCredits,
    deployCredits,
    illustrativeSubtotalCredits: illustrativeDbComputeCredits + deployCredits,
    freeAccountCredits: FREE_MONTHLY_CREDITS,
    // This excludes function GB-hours, traffic, requests, storage, wake
    // extension, retries, and all other sites. There is no inferred headroom.
    actualAccountHeadroomKnown: false,
    safeToDeployFromThisEstimate: false
  }
}

const STRICT_FIELDS = [
  'mode', 'sameOriginAsProduction', 'realRecords',
  'realCredentials', 'productionIssuerKey', 'productionDatabase',
  'automatedDeploy', 'automaticPolling', 'newMigrations',
  'unreviewedNetworkConnections', 'offlineRestoreTestPassed',
  'firstTrustIndependent', 'estimatedOtherSitesUsageKnown',
  'onAccountUsageReviewed', 'rollbackDrillComplete'
]

/**
 * This gate only accepts an OFFLINE rehearsal proposal. It deliberately
 * cannot return "approved-to-deploy", regardless of flags or estimates.
 * Even an offline-ready plan must be separately authorized for any
 * remote synthetic site, credentials, database or network action.
 */
export function assessOfflineSyntheticHostingPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { status: 'REJECT', reasons: ['invalid-plan'] }
  }
  const keys = Object.keys(plan).sort()
  if (keys.join('|') !== STRICT_FIELDS.slice().sort().join('|')) {
    return { status: 'REJECT', reasons: ['unexpected-plan-fields'] }
  }
  const reasons = []
  if (plan.mode !== 'offline-synthetic-only') reasons.push('not-offline-synthetic')
  for (const key of [
    'sameOriginAsProduction', 'realRecords', 'realCredentials',
    'productionIssuerKey', 'productionDatabase', 'automatedDeploy',
    'automaticPolling', 'newMigrations', 'unreviewedNetworkConnections'
  ]) {
    if (plan[key] !== false) reasons.push('forbidden-' + key)
  }
  for (const key of [
    'offlineRestoreTestPassed', 'firstTrustIndependent',
    'estimatedOtherSitesUsageKnown', 'onAccountUsageReviewed',
    'rollbackDrillComplete'
  ]) {
    if (plan[key] !== true) reasons.push('missing-' + key)
  }
  return reasons.length
    ? { status: 'REJECT', reasons }
    : {
        status: 'OFFLINE_PLAN_READY',
        reasons: [],
        // User's "可以" is agreement to prepare a plan, not deployment.
        remoteActionsAuthorized: false,
        realDataAuthorized: false
      }
}
