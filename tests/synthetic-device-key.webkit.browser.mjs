/**
 * Targeted WebKit compatibility probe. The Linux Playwright WebKit engine is
 * NOT identical to a real iPhone Safari; record its limitations separately.
 * Uses only synthetic local keys, no user's live Netlify site or database.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { webkit } from 'playwright'

const url = 'http://127.0.0.1:4177/'
const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
  '--port', '4177', '--strictPort', '--mode', 'testlab'
], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
vite.stdout.on('data', chunk => { logs += chunk.toString() })
vite.stderr.on('data', chunk => { logs += chunk.toString() })
let browser
async function waitForSite() {
  for (let i = 0; i < 90; i++) {
    if (vite.exitCode !== null) throw Error('Vite failed: ' + logs)
    try {
      if ((await fetch(url)).ok) return
    } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw Error('No synthetic site: ' + logs)
}

async function status(panel) {
  return panel.locator('[data-testid="local-key-status"]').innerText()
}

try {
  await waitForSite()
  browser = await webkit.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const panel = page.getByRole('region', { name: '设备密钥本机测试' })
  await panel.getByText(/此浏览器尚未生成测试设备密钥/).waitFor()
  await panel.getByRole('button', { name: '生成此浏览器测试密钥' }).click()
  try {
    await panel.getByText(/已保存不可导出的本地私钥/).waitFor({ timeout: 12000 })
  } catch {
    throw Error('WebKit create failed: ' + (await status(panel)) + ' JS: ' + errors.join('; ').slice(0, 400))
  }
  const identity = await panel.locator('[data-testid="fixture-key-identity"]').innerText()
  await page.reload()
  const after = page.getByRole('region', { name: '设备密钥本机测试' })
  await after.getByText(/已找到此前生成的本机测试密钥/).waitFor({ timeout: 10000 })
  const refreshed = await after.locator('[data-testid="fixture-key-identity"]').innerText()
  assert.equal(
    refreshed, identity.replace('本机签名已验证', '已保存，等待签名校验'),
    'reloaded private key must retain the same identity'
  )
  await after.getByRole('button', { name: '验证本机签名（不联网）' }).click()
  try {
    await after.getByText(/本机签名验证通过/).waitFor({ timeout: 23000 })
  } catch {
    throw Error('WebKit verify failed: ' + (await status(after)) + ' JS: ' + errors.join('; ').slice(0, 400))
  }
  await context.close()
  console.log('[PASS] synthetic WebKit: persisted non-extractable key survives reload and signs locally')
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
