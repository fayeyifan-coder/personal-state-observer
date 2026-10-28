/**
 * Minimal WebKit offline File API probe, with NO Dexie, React or backup code.
 * This is diagnostic: Playwright context offline is not a substitute for iOS Safari.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { webkit } from 'playwright'

const origin = 'http://127.0.0.1:4175/'
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview',
  '--host', '127.0.0.1', '--port', '4175', '--strictPort'
], { stdio: 'ignore' })
async function waitForServer() {
  for (let i=0;i<100;i++) {
    if (server.exitCode !== null) throw Error('Preview process exited')
    try { if ((await fetch(origin)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('Could not start minimal WebKit probe')
}
let browser
try {
  await waitForServer()
  browser = await webkit.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(origin)

  async function probe() {
    return page.evaluate(async () => {
      const out = { online: navigator.onLine }
      const text = 'synthetic offline probe content'
      for (const type of ['blob.text', 'file.text', 'FileReader']) {
        try {
          let result
          if (type === 'blob.text') result = await new Blob([text]).text()
          else if (type === 'file.text') result = await new File([text], 'synthetic.txt').text()
          else result = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => reject(reader.error)
            reader.readAsText(new File([text], 'synthetic.txt'))
          })
          out[type] = result === text ? 'PASS' : 'MISMATCH'
        } catch (e) { out[type] = 'FAIL: ' + (e instanceof Error ? e.message : String(e)) }
      }
      return out
    })
  }
  const online = await probe()
  assert.ok(Object.values(online).filter(x=>x==='PASS').length===3)
  await context.setOffline(true)
  const emulatedOffline = await probe()
  await context.setOffline(false)
  await page.route('**/*', route => route.abort())
  const blockedNetwork = await probe()
  assert.ok(Object.values(blockedNetwork).filter(x=>x==='PASS').length===3,
    'read of in-memory File must survive blocked network without context-offline emulation')
  console.log('[DIAGNOSTIC] WebKit baseline=' + JSON.stringify(online))
  console.log('[DIAGNOSTIC] WebKit context.setOffline(true)=' + JSON.stringify(emulatedOffline))
  console.log('[DIAGNOSTIC] WebKit blocked-network=' + JSON.stringify(blockedNetwork))
  await context.close()
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
