import assert from 'node:assert/strict'
import {
  illustrateFreeDbWakeCost,
  assessOfflineSyntheticHostingPlan
} from '../tools/synthetic-hosting-gate.mjs'

// Synthetic illustrative scenarios ONLY; no network/Netlify account inspection.
const daily = illustrateFreeDbWakeCost({
  days: 30, sessionsPerDay: 1, productionDeploys: 1
})
assert.equal(daily.isolatedWakeHours, 2.5)
assert.equal(daily.illustrativeDbComputeCredits, 25)
assert.equal(daily.deployCredits, 15)
assert.equal(daily.illustrativeSubtotalCredits, 40)
assert.equal(daily.actualAccountHeadroomKnown, false)
assert.equal(daily.safeToDeployFromThisEstimate, false)

const twiceDaily = illustrateFreeDbWakeCost({
  days: 30, sessionsPerDay: 2, productionDeploys: 1
})
assert.equal(twiceDaily.illustrativeDbComputeCredits, 50)
assert.equal(twiceDaily.illustrativeSubtotalCredits, 65)

const frequent = illustrateFreeDbWakeCost({
  days: 30, sessionsPerDay: 10, productionDeploys: 1
})
assert.equal(frequent.illustrativeDbComputeCredits, 250)
assert.equal(frequent.illustrativeSubtotalCredits, 265)
assert.equal(frequent.safeToDeployFromThisEstimate, false,
  'sub-300 illustrative cost still never authorizes real usage')

// Frequent polling keeps a database active longer than an isolated wake
// simulation. This intentionally does NOT try to infer the actual bill.
const poll = illustrateFreeDbWakeCost({
  days: 30, sessionsPerDay: 96
})
assert.equal(poll.illustrativeDbComputeCredits, 2400)
assert.equal(poll.safeToDeployFromThisEstimate, false)
for (const input of [
  { days: 0, sessionsPerDay: 1 },
  { days: 30, sessionsPerDay: -1 },
  { days: 30, sessionsPerDay: 1, minimumAwakeMinutes: 0 },
  { days: 30, sessionsPerDay: 1.2 },
  { days: 30, sessionsPerDay: 1, productionDeploys: -1 }
]) {
  assert.throws(() => illustrateFreeDbWakeCost(input))
}

const fixture = {
  mode: 'offline-synthetic-only',
  sameOriginAsProduction: false,
  realRecords: false,
  realCredentials: false,
  productionIssuerKey: false,
  productionDatabase: false,
  automatedDeploy: false,
  automaticPolling: false,
  newMigrations: false,
  unreviewedNetworkConnections: false,
  // These true values are SCENARIO INPUTS, not actual account evidence.
  offlineRestoreTestPassed: true,
  firstTrustIndependent: true,
  estimatedOtherSitesUsageKnown: true,
  onAccountUsageReviewed: true,
  rollbackDrillComplete: true
}
const result = assessOfflineSyntheticHostingPlan(fixture)
assert.deepEqual(result, {
  status: 'OFFLINE_PLAN_READY',
  reasons: [],
  remoteActionsAuthorized: false,
  realDataAuthorized: false
})

for (const key of [
  'sameOriginAsProduction', 'realRecords', 'realCredentials',
  'productionIssuerKey', 'productionDatabase', 'automatedDeploy',
  'automaticPolling', 'newMigrations', 'unreviewedNetworkConnections'
]) {
  const rejected = assessOfflineSyntheticHostingPlan({ ...fixture, [key]: true })
  assert.equal(rejected.status, 'REJECT', 'unsafe field: ' + key)
  assert.ok(rejected.reasons.includes('forbidden-' + key))
}
for (const key of [
  'offlineRestoreTestPassed', 'firstTrustIndependent',
  'estimatedOtherSitesUsageKnown', 'onAccountUsageReviewed',
  'rollbackDrillComplete'
]) {
  assert.equal(
    assessOfflineSyntheticHostingPlan({ ...fixture, [key]: false }).status,
    'REJECT', 'must not infer satisfied prerequisite: ' + key
  )
}
assert.equal(
  assessOfflineSyntheticHostingPlan({ ...fixture, extra: 'unchecked' }).status,
  'REJECT', 'unexpected fields cannot silently bypass strict review'
)
assert.equal(
  assessOfflineSyntheticHostingPlan({ ...fixture, mode: 'production' }).status,
  'REJECT'
)
assert.equal(assessOfflineSyntheticHostingPlan(null).status, 'REJECT')
console.log('[PASS] synthetic-only hosting gate: illustrative Netlify cost is never deployment authorization; unsafe fields fail closed')
