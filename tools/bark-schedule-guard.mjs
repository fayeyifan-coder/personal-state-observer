/**
 * Guard GitHub's BEST-EFFORT UTC cron from sending messages many hours late.
 * Zero network, no secrets, no state changes. Pure policy + optional CLI.
 *
 * GitHub Actions schedule may fire hours late or not at all; this does NOT
 * guarantee punctual notifications. For exact local times, use iOS Shortcuts
 * Time of Day automation or a trusted device-native reminder.
 */
const BEIJING_UTC_OFFSET_HOURS = 8
const MAX_DELAY_MINUTES = 25
export const BARK_SLOTS = Object.freeze({
  '7 0 * * *': { kind: 'morning', hourUtc: 0, minuteUtc: 7 },
  '7 14 * * *': { kind: 'evening', hourUtc: 14, minuteUtc: 7 }
})

/**
 * Only accept exact known GitHub schedule strings. Never guess the label
 * from the current UTC hour: a 14-hour-late morning job must not become
 * an evening notification.
 */
export function evaluateBarkRun({
  eventName,
  schedule,
  now = new Date()
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw Error('invalid-schedule-clock')
  }
  if (eventName === 'workflow_dispatch') {
    return {
      action: 'send',
      kind: 'test',
      reason: 'manual-test',
      expectedUtc: null,
      delayMinutes: null,
      expectedBeijingHour: null
    }
  }
  if (eventName !== 'schedule') {
    return { action: 'skip', kind: null, reason: 'unknown-event' }
  }
  const slot = BARK_SLOTS[schedule]
  if (!slot) {
    return { action: 'skip', kind: null, reason: 'unknown-cron' }
  }
  let expectedUtcMilliseconds = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    slot.hourUtc, slot.minuteUtc
  )
  // An evening schedule can wake after midnight UTC on the next day.
  // Use the previous day's nominal slot, never a FUTURE slot.
  if (expectedUtcMilliseconds > now.getTime()) {
    expectedUtcMilliseconds -= 24 * 60 * 60 * 1000
  }
  const delayMinutes = (now.getTime() - expectedUtcMilliseconds) / 60000
  const expectedUtc = new Date(expectedUtcMilliseconds).toISOString()
  return {
    action: delayMinutes <= MAX_DELAY_MINUTES ? 'send' : 'skip',
    kind: slot.kind,
    reason: delayMinutes <= MAX_DELAY_MINUTES
      ? 'within-allowed-window' : 'stale-scheduled-run',
    expectedUtc,
    delayMinutes: Math.floor(delayMinutes),
    expectedBeijingHour: slot.hourUtc + BEIJING_UTC_OFFSET_HOURS
  }
}

if (process.argv.includes('--github')) {
  const policy = evaluateBarkRun({
    eventName: process.env.EVENT_NAME,
    schedule: process.env.SCHEDULE,
    now: new Date()
  })
  // Only static labels are emitted to GITHUB_OUTPUT, never a Bark key or URL.
  console.log('action=' + policy.action)
  console.log('kind=' + (policy.kind ?? 'none'))
  console.error('[bark-schedule] ' + JSON.stringify(policy))
}
