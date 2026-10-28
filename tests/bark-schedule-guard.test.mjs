import assert from 'node:assert/strict'
import { evaluateBarkRun, BARK_SLOTS } from '../tools/bark-schedule-guard.mjs'
const check = (iso, cron, expectedAction, expectedKind) => {
  const r = evaluateBarkRun({
    eventName: 'schedule', schedule: cron, now: new Date(iso)
  })
  assert.equal(r.action, expectedAction, iso + ' action')
  assert.equal(r.kind, expectedKind, iso + ' kind')
  return r
}
assert.deepEqual(Object.keys(BARK_SLOTS).sort(),
  ['7 0 * * *', '7 14 * * *'].sort())

// Exact and ordinary minor delays in UTC+8. These are not punctuality promises.
let result = check('2026-10-28T00:07:00Z',
  '7 0 * * *', 'send', 'morning')
assert.equal(result.expectedBeijingHour, 8)
assert.equal(result.delayMinutes, 0)
result = check('2026-10-28T00:20:59Z',
  '7 0 * * *', 'send', 'morning')
assert.equal(result.delayMinutes, 13)
check('2026-10-28T00:32:00Z', '7 0 * * *', 'send', 'morning')
check('2026-10-28T00:32:01Z', '7 0 * * *', 'skip', 'morning')

result = check('2026-10-28T14:07:00Z',
  '7 14 * * *', 'send', 'evening')
assert.equal(result.expectedBeijingHour, 22)
check('2026-10-28T14:31:00Z', '7 14 * * *', 'send', 'evening')
check('2026-10-28T14:35:00Z', '7 14 * * *', 'skip', 'evening')

// Reproduce observed kinds of schedule delays in actual repo CI timeline.
// The morning run on Oct 28 actually woke at 05:45 UTC: must be suppressed.
result = check('2026-10-28T05:45:04Z',
  '7 0 * * *', 'skip', 'morning')
assert.equal(result.reason, 'stale-scheduled-run')
assert.equal(result.expectedUtc, '2026-10-28T00:07:00.000Z')
// An evening run several hours late must NOT be mislabeled morning or test.
check('2026-10-27T19:25:53Z', '7 14 * * *', 'skip', 'evening')
check('2026-10-28T03:15:00Z', '7 14 * * *', 'skip', 'evening')
check('2026-10-28T15:00:00Z', '7 0 * * *', 'skip', 'morning')
check('2026-10-29T00:12:00Z', '7 14 * * *', 'skip', 'evening')
// Day rollover resolves previous nominal day, not future same-day schedule.
result = check('2026-10-29T00:00:00Z',
  '7 14 * * *', 'skip', 'evening')
assert.equal(result.expectedUtc, '2026-10-28T14:07:00.000Z')

for (const wrong of ['17 0 * * *', '17 14 * * *', '', '7 1 * * *']) {
  result = check('2026-10-28T00:07:00Z', wrong, 'skip', null)
  assert.equal(result.reason, 'unknown-cron')
}
result = evaluateBarkRun({
  eventName: 'push', schedule: '7 0 * * *',
  now: new Date('2026-10-28T00:07:00Z')
})
assert.equal(result.action, 'skip')
result = evaluateBarkRun({
  eventName: 'workflow_dispatch', schedule: undefined,
  now: new Date('2026-10-28T23:59:00Z')
})
assert.deepEqual({
  action: result.action, kind: result.kind, reason: result.reason
}, { action: 'send', kind: 'test', reason: 'manual-test' })
assert.throws(
  () => evaluateBarkRun({
    eventName: 'schedule', schedule: '7 0 * * *', now: new Date(NaN)
  }), /invalid-schedule-clock/
)
console.log('[PASS] explicit UTC+8 slot; 25-minute expiry; 5+ hour late suppression; past-midnight guard; manual test separate; no network')
