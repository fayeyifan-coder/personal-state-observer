/**
 * Isolated browser acceptance: all records are fabricated and exist only in a
 * temporary Chromium profile served from Vite preview on localhost.
 * Run after npm run build and installing Playwright/Chromium in CI.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
const browserEngine = process.env.BROWSER_ENGINE === 'webkit' ? webkit : chromium

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
  browser = await browserEngine.launch({ headless: true })
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
    const json = JSON.stringify(backup(data, opts))
    if (process.env.BROWSER_ENGINE === 'webkit' && await page.evaluate(() => !navigator.onLine)) {
      // Playwright's virtual setInputFiles buffer can be unreadable in WebKit
      // while its offline network emulator is active. Use a native in-page File
      // so the offline test checks the application's real file handling.
      await page.evaluate(content => {
        const input = document.querySelector('input[type=file]')
        const items = new DataTransfer()
        items.items.add(new File([content], 'synthetic-backup.json', {
          type: 'application/json'
        }))
        input.files = items.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, json)
    } else {
      await page.locator('input[type=file]').setInputFiles({
        name: 'synthetic-backup.json', mimeType: 'application/json',
        buffer: Buffer.from(json)
      })
    }
    try {
      await page.getByRole('region', { name: '备份差异预览' }).waitFor({ timeout: 8000 })
    } catch (cause) {
      const state = await page.evaluate(() => ({
        location: location.href,
        online: navigator.onLine,
        messages: [...document.querySelectorAll('.inline-message,.inline-error')]
          .map(element => element.textContent),
        hasInput: !!document.querySelector('input[type=file]'),
        visibleRegions: [...document.querySelectorAll('[role=region]')]
          .map(element => element.getAttribute('aria-label'))
      }))
      throw new Error('Backup preview did not appear; isolated test UI state: ' +
        JSON.stringify(state), { cause })
    }
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

  // Explicitly cancelling the browser confirmation cannot write anything.
  await setLocal(collection())
  await upload(collection([day('2026-10-27')]))
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '确认以备份替换本机数据' }).click()
  assert.equal((await readLocal()).length, 0, 'cancelled confirmation must not restore')

  // Malformed JSON should report an error without deleting local data.
  await setLocal(collection([day('2026-10-26', 1)]))
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json',
    buffer: Buffer.from('not-a-backup-file')
  })
  await page.locator('.inline-error').waitFor()
  assert.equal(await page.getByRole('region', { name: '备份差异预览' }).count(), 0)
  assert.equal((await readLocal())[0].recordDate, '2026-10-26')

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

  // Browser encryption: export ciphertext, never upload, decrypt only for comparison.
  const encryptedPassword = 'very-long-unique-passphrase-for-tests-2026'
  await setLocal(collection([day('2026-10-27', 4)]))
  await page.getByPlaceholder('使用较长且唯一的密码短语').fill(encryptedPassword)
  await page.getByPlaceholder('再次输入密码以确认').fill(encryptedPassword)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载加密 JSON 备份' }).click()
  ])
  assert.match(download.suggestedFilename(), /^personal-state-observer-encrypted-.*\.json$/)
  const encryptedFile = await readFile(await download.path())
  const envelope = JSON.parse(encryptedFile.toString('utf8'))
  assert.equal(envelope.format, 'personal-state-observer-encrypted-backup')
  assert.equal(encryptedFile.toString().includes('"mood"'), false, 'ciphertext hides field names')
  assert.equal(encryptedFile.toString().includes(encryptedPassword), false, 'ciphertext hides password')
  await setLocal(collection())
  await page.locator('input[type=file]').setInputFiles({
    name: 'encrypted.json', mimeType: 'application/json', buffer: encryptedFile
  })
  await page.getByRole('button', { name: '解密并预览差异' }).waitFor()
  assert.equal((await readLocal()).length, 0, 'encrypted selection does not restore')
  await page.getByText('备份密码（仅在本机使用）').locator('..').locator('input').fill('wrong-pass')
  await page.getByRole('button', { name: '解密并预览差异' }).click()
  await page.getByText(/密码不正确，或加密备份已经损坏/).waitFor()
  assert.equal((await readLocal()).length, 0)
  await page.getByText('备份密码（仅在本机使用）').locator('..').locator('input').fill(encryptedPassword)
  await page.getByRole('button', { name: '解密并预览差异' }).click()
  await page.getByRole('region', { name: '备份差异预览' }).waitFor()
  assert.equal((await readLocal()).length, 0, 'successful decryption only previews')
  await page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '确认以备份替换本机数据' }).click()
  await page.getByText('安全恢复完成，请核对日期和记录数量。').waitFor()
  assert.equal((await readLocal())[0].answers.mood, 4, 'encrypted roundtrip restores on explicit confirmation')

  // Tampered ciphertext must fail before reaching the preview.
  await setLocal(collection())
  const corrupt = { ...envelope, ciphertext: 'AAAA' + envelope.ciphertext.slice(4) }
  await page.locator('input[type=file]').setInputFiles({
    name: 'corrupt.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(corrupt))
  })
  await page.getByText('备份密码（仅在本机使用）').locator('..').locator('input').fill(encryptedPassword)
  await page.getByRole('button', { name: '解密并预览差异' }).click()
  await page.getByText(/密码不正确，或加密备份已经损坏/).waitFor()
  assert.equal(await page.getByRole('region', { name: '备份差异预览' }).count(), 0)
  assert.equal((await readLocal()).length, 0)

  // Responsive UI: no horizontal overflow at common narrow viewports.
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 760 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 2, 'horizontal overflow at width ' + width + ': ' + overflow)
  }

  // Never send synthetic personal data to remote host in these tests.
  console.log('[PASS] ' + (process.env.BROWSER_ENGINE === 'webkit' ? 'WebKit' : 'Chromium') + ': preview, guarded restore, encrypted roundtrip, wrong password, tampering, cancellation, offline, narrow layout')
  await context.close()
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
