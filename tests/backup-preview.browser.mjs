/**
 * Isolated browser acceptance: all records are fabricated and exist only in a
 * temporary Chromium profile served from Vite preview on localhost.
 * Run after npm run build and installing Playwright/Chromium in CI.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const host = 'http://127.0.0.1:4173'
const url = host + '/personal-state-observer/#/data'
const repoRoot = process.cwd()
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe']
})
let serverLog = ''
vite.stderr.on('data', chunk => { serverLog += chunk.toString() })
vite.stdout.on('data', chunk => { serverLog += chunk.toString() })

async function waitForPreview() {
  for (let i = 0; i < 100; i++) {
    if (vite.exitCode !== null) throw new Error('Vite preview exited: ' + serverLog)
    try {
      const r = await fetch(host + '/personal-state-observer/')
      if (r.ok) return
    } catch { /* not yet serving */ }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('Vite preview failed to start: ' + serverLog)
}

const day = (date, mood = 3, id = 'day_' + date) => ({
  id, recordDate: date, recordingStatus: 'recorded', startedAt: null,
  completedAt: null, optedOutAt: null, updatedAt: '2026-10-28T00:00:00.000Z',
  currentPhase: null, lastQuestionId: null, answers: { mood }
})
const device = date => ({
  id: 'device_' + date, recordDate: date, source: 'manual',
  sleepDurationMin: null, steps: 1234, heartRateAvg: null, weightKg: null,
  createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z'
})
const collection = (dailyRecords = [], periodLabels = [], deviceData = []) =>
  ({ dailyRecords, periodLabels, deviceData })
const backup = (data, { withoutDeviceData = false } = {}) => {
  const result = {
    format: 'personal-state-observer-backup',
    formatVersion: 1, appVersion: '1.5', schemaVersion: '0.8',
    exportedAt: '2026-10-28T04:00:00.000Z',
    dailyRecords: data.dailyRecords, periodLabels: data.periodLabels,
    deviceData: data.deviceData
  }
  if (withoutDeviceData) delete result.deviceData
  return result
}

let browser
try {
  await waitForPreview()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, acceptDownloads: true })
  const page = await context.newPage()
  await page.goto(url)
  const chooser = page.getByRole('button', { name: '选择 JSON 文件并预览' })
  await chooser.waitFor()

  async function setLocal(data) {
    await page.evaluate(async data => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('personal-state-observer')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise((resolve, reject) => {
        const tx = database.transaction(['dailyRecords', 'periodLabels', 'deviceDailyData'], 'readwrite')
        const tables = [
          ['dailyRecords', data.dailyRecords],
          ['periodLabels', data.periodLabels],
          ['deviceDailyData', data.deviceData ?? []]
        ]
        for (const [name, entries] of tables) {
          const store = tx.objectStore(name)
          store.clear()
          for (const item of entries) store.put(item)
        }
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      database.close()
    }, data)
    await page.reload()
    await chooser.waitFor()
  }
  async function readLocal() {
    return await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('personal-state-observer')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const records = await new Promise((resolve, reject) => {
        const tx = database.transaction('dailyRecords', 'readonly')
        const request = tx.objectStore('dailyRecords').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      database.close()
      return records
    })
  }
  async function upload(data, opts) {
    await page.locator('input[type=file]').setInputFiles({
      name: 'synthetic-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup(data, opts)))
    })
    await page.getByRole('region', { name: '备份差异预览' }).waitFor()
  }
  async function denied() {
    assert.equal(await page.getByRole('button', { name: '确认以备份替换本机数据' }).count(), 0)
  }

  // Empty device: preview and user-acknowledged restore.
  await setLocal(collection())
  await upload(collection([day('2026-10-27')]))
  assert.match(await page.locator('.backup-compare-row').first().innerText(), /每日记录/)
  assert.equal((await readLocal()).length, 0, 'preview must not modify local records')
  await page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '确认以备份替换本机数据' }).click()
  await page.getByText('安全恢复完成，请核对日期和记录数量。').waitFor()
  assert.equal((await readLocal()).length, 1, 'confirmed safe restore persists the incoming record')

  // A locally unique day can never be silently deleted.
  await setLocal(collection([day('2026-10-27')]))
  await upload(collection([day('2026-10-28')]))
  await denied()
  assert.match(await page.locator('.backup-warning').last().innerText(), /本机独有/)
  assert.equal((await readLocal())[0].recordDate, '2026-10-27')

  // Same logical day changed independently: report and block.
  await setLocal(collection([day('2026-10-27', 1)]))
  await upload(collection([day('2026-10-27', 5)]))
  await denied()
  await page.locator('.backup-conflict-details summary').click()
  assert.match(await page.locator('.backup-conflict-details').innerText(), /2026-10-27/)
  assert.equal((await readLocal())[0].answers.mood, 1)

  // Same primary key on two distinct dates in an imported file is also invalid.
  await setLocal(collection())
  await upload(collection([day('2026-10-27', 2, 'duplicate-id'), day('2026-10-28', 5, 'duplicate-id')]))
  await denied()
  assert.match(await page.locator('.backup-warning').first().innerText(), /重复/)

  // Previously exported format without deviceData must not delete local measurements.
  await setLocal(collection([], [], [device('2026-10-27')]))
  await upload(collection(), { withoutDeviceData: true })
  await denied()

  // Cancel preview and offline behavior after the app has loaded.
  await setLocal(collection([day('2026-10-27', 2)]))
  await context.setOffline(true)
  await upload(collection([day('2026-10-27', 2)]))
  await page.getByRole('button', { name: '关闭预览' }).click()
  assert.equal(await page.getByRole('region', { name: '备份差异预览' }).count(), 0)
  assert.equal((await readLocal())[0].answers.mood, 2)
  await context.setOffline(false)

  // Preview can become stale: data-layer rechecks in the write transaction.
  await setLocal(collection())
  await upload(collection([day('2026-10-27', 2)]))
  await page.evaluate(async row => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('personal-state-observer')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('dailyRecords', 'readwrite')
      tx.objectStore('dailyRecords').put(row)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, day('2026-10-28', 4))
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '确认以备份替换本机数据' }).click()
  await page.getByText(/本机数据发生变化，或备份与本机存在冲突/).waitFor()
  assert.deepEqual((await readLocal()).map(x => x.recordDate), ['2026-10-28'])

  // Responsive UI: no horizontal overflow at common narrow viewports.
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 760 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 2, 'horizontal overflow at width ' + width + ': ' + overflow)
  }

  // Never send synthetic personal data to remote host in these tests.
  console.log('[PASS] Chromium browser: preview, restoration, conflict blocks, offline, stale preview, narrow layout')
  await context.close()
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
