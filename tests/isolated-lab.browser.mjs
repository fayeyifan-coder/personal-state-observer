/**
 * Synthetic-only preview acceptance for a separate HTTPS host.
 * This CI test runs locally on a clean browser profile and never uses user data.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const url = 'http://127.0.0.1:4174/'
const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
  '--port', '4174', '--strictPort', '--mode', 'testlab'
], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
vite.stdout.on('data', chunk => { logs += chunk.toString() })
vite.stderr.on('data', chunk => { logs += chunk.toString() })

async function waitForSite() {
  for (let i = 0; i < 100; i++) {
    if (vite.exitCode !== null) throw new Error(logs)
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch { /* server not started yet */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Cannot launch isolated test app: ' + logs)
}

let browser
try {
  await waitForSite()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, acceptDownloads: true
  })
  const page = await context.newPage()
  await page.goto(url)
  try {
    await page.getByRole('region', { name: '独立测试站点' }).waitFor({ timeout: 10000 })
  } catch (cause) {
    throw new Error('Preview did not render isolated lab: ' + JSON.stringify({
      url: page.url(),
      body: (await page.locator('body').innerText().catch(() => ''))?.slice(0, 600),
      server: logs.slice(-800)
    }), { cause })
  }
  await page.getByText('独立测试站 · 仅限虚构数据').waitFor()
  await page.getByRole('button', { name: '生成两天虚构记录' }).click()
  await page.getByText('已在隔离测试数据库中写入两天虚构记录。').waitFor()
  await page.getByText('有活动的日子').waitFor()

  async function readTestDB() {
    return page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('personal-state-observer-fixture-lab-v1')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const values = await new Promise((resolve, reject) => {
        const tx = db.transaction('dailyRecords', 'readonly')
        const request = tx.objectStore('dailyRecords').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      db.close()
      return values
    })
  }
  const initial = await readTestDB()
  // Diagnostic is entirely opt-in; it must never trigger on initial render
  // and must never alter the local fixture database.
  const diagnostic = page.getByRole('region', { name: '只读登录诊断' })
  await diagnostic.waitFor()
  await diagnostic.getByText(/尚未检查/).waitFor()
  let diagnosticRequests = 0
  const diagnosticRoute = '**/.netlify/functions/lab-login-status'
  await page.route(diagnosticRoute, async route => {
    diagnosticRequests++
    assert.equal(route.request().method(), 'GET')
    assert.equal(route.request().postData(), null)
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true, status: 'verified-private-login',
        permission: 'read-only', cloudSync: 'not-configured'
      })
    })
  })
  assert.equal(diagnosticRequests, 0, 'no automatic login probing')
  await diagnostic.getByRole('button', { name: '检查 Netlify 登录（只读）' }).click()
  await diagnostic.getByText(/已验证 Netlify 私有站点登录/).waitFor()
  assert.equal(diagnosticRequests, 1)
  await page.unroute(diagnosticRoute)
  await page.route(diagnosticRoute, route => route.fulfill({
    status: 401, contentType: 'application/json',
    body: '{"authenticated":false,"status":"login-not-confirmed"}'
  }))
  await diagnostic.getByRole('button', { name: '检查 Netlify 登录（只读）' }).click()
  await diagnostic.getByText(/未能确认 Netlify 登录/).waitFor()
  await page.unroute(diagnosticRoute)
  // A static Vite SPA fallback is often HTTP 200 text/html;
  // it must never be reported as a successful login.
  await page.route(diagnosticRoute, route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!DOCTYPE html><html></html>'
  }))
  await diagnostic.getByRole('button', { name: '检查 Netlify 登录（只读）' }).click()
  await diagnostic.getByText(/返回了 HTML 网页/).waitFor()
  await page.unroute(diagnosticRoute)
  // The function itself returns a safe JSON 404 when strict site or URL
  // verification rejects a request. Do not misreport that as undeployed.
  await page.route(diagnosticRoute, route => route.fulfill({
    status: 404, contentType: 'application/json',
    body: '{"authenticated":false,"status":"unavailable"}'
  }))
  await diagnostic.getByRole('button', { name: '检查 Netlify 登录（只读）' }).click()
  await diagnostic.getByText(/Function 已响应.*安全校验没有通过/).waitFor()
  await page.unroute(diagnosticRoute)
  await page.route(diagnosticRoute, route => route.fulfill({
    status: 404, contentType: 'text/html',
    body: '<!DOCTYPE html><html><body>Not Found</body></html>'
  }))
  await diagnostic.getByRole('button', { name: '检查 Netlify 登录（只读）' }).click()
  await diagnostic.getByText(/未找到登录诊断 JSON 接口/).waitFor()
  await page.unroute(diagnosticRoute)
  assert.deepEqual(await readTestDB(), initial, 'diagnostic must not touch IndexedDB')
  assert.deepEqual(initial.map(x => x.recordDate), ['2026-10-26', '2026-10-27'])
  assert.ok(initial.every(x => x.answers.comment === '仅用于测试的虚构记录'))
  const dbNames = await page.evaluate(async () =>
    (await indexedDB.databases()).map(db => db.name)
  )
  assert.ok(dbNames.includes('personal-state-observer-fixture-lab-v1'))
  assert.ok(!dbNames.includes('personal-state-observer'), 'production database must not be opened')

  async function download(name) {
    const [file] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('button', { name }).click()
    ])
    return readFile(await file.path())
  }
  const safe = await download('下载新增测试文件')
  assert.match(safe.toString('utf8'), /PERSONAL_STATE_OBSERVER_SYNTHETIC_TEST_ONLY_V1/)
  const conflict = await download('下载冲突测试文件')

  async function upload(bytes) {
    await page.locator('input[type=file]').setInputFiles({
      name: 'isolated-test.json', mimeType: 'application/json', buffer: bytes
    })
  }
  await upload(conflict)
  await page.getByRole('region', { name: '备份差异预览' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '确认以备份替换本机数据' }).count(), 0)
  assert.deepEqual(await readTestDB(), initial, 'preview must be read-only')

  await upload(safe)
  await page.getByRole('region', { name: '备份差异预览' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '确认以备份替换本机数据' }).count(), 1)
  assert.deepEqual(await readTestDB(), initial)

  // A plausible real backup without the synthetic-only marker must be refused.
  const unsafe = JSON.parse(safe.toString('utf8'))
  delete unsafe.testFixtureTag
  await upload(Buffer.from(JSON.stringify(unsafe)))
  await page.getByText(/测试站点只接受本测试站生成的虚构备份/).waitFor()
  assert.equal(await page.getByRole('region', { name: '备份差异预览' }).count(), 0)
  assert.deepEqual(await readTestDB(), initial)

  // Normal export must be synthetic-tagged, too.
  const plaintext = await download('导出 JSON 备份')
  assert.match(plaintext.toString('utf8'), /PERSONAL_STATE_OBSERVER_SYNTHETIC_TEST_ONLY_V1/)

  // Encrypted export/decrypt continues to enforce the marker in plaintext.
  const passphrase = 'an-unique-synthetic-test-password-2026'
  await page.getByPlaceholder('使用较长且唯一的密码短语').fill(passphrase)
  await page.getByPlaceholder('再次输入密码以确认').fill(passphrase)
  const encrypted = await download('下载加密 JSON 备份')
  assert.doesNotMatch(encrypted.toString('utf8'), /仅用于测试的虚构记录/)
  await upload(encrypted)
  await page.getByRole('button', { name: '解密并预览差异' }).waitFor()
  await page.locator('.backup-password-label input').fill(passphrase)
  await page.getByRole('button', { name: '解密并预览差异' }).click()
  await page.getByRole('region', { name: '备份差异预览' }).waitFor()
  assert.deepEqual(await readTestDB(), initial)

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 760 })
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    assert.ok(overflow <= 2, 'isolated layout overflows at ' + width)
  }
  await context.close()
  console.log('[PASS] isolated lab: fixture-only imports, separate database, encrypted preview, mobile layout')
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
