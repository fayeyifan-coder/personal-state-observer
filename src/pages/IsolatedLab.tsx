import { useState } from 'react'
import { DataPage } from './DataPage'
import { db } from '../db/database'
import { downloadBackup } from '../services/backup'
import { makeSyntheticLabBackup, syntheticLabRecords } from '../services/testLabFixtures'
import { LabLoginDiagnostic } from '../components/LabLoginDiagnostic'

const forbiddenOrigin = 'https://fayeyifan-coder.github.io'

export function IsolatedLab() {
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('本测试站不会读取正式手机上的历史记录。')
  const enabled = import.meta.env.VITE_ISOLATED_LAB === '1' &&
    window.location.origin !== forbiddenOrigin

  if (!enabled) {
    return (
      <main className="page">
        <h1>测试站点保护已启动</h1>
        <p>检测到正式网站地址或测试模式未启用。为防止修改真实数据，测试功能已停用。</p>
      </main>
    )
  }

  async function seed() {
    if (busy) return
    setBusy(true)
    try {
      const fixture = syntheticLabRecords()
      await db.transaction('rw', db.dailyRecords, db.periodLabels, db.deviceDailyData, async () => {
        await db.dailyRecords.clear()
        await db.periodLabels.clear()
        await db.deviceDailyData.clear()
        await db.dailyRecords.bulkPut(fixture.dailyRecords)
        await db.periodLabels.bulkPut(fixture.periodLabels)
        await db.deviceDailyData.bulkPut(fixture.deviceData)
      })
      setRevision(n => n + 1)
      setStatus('已在隔离测试数据库中写入两天虚构记录。')
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : '虚构记录初始化失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <section className="isolated-lab-notice" role="region" aria-label="独立测试站点">
        <strong>独立测试站 · 仅限虚构数据</strong>
        <p>这里不是正式个人状态观察器。请不要输入真实健康信息，也不要上传手机导出的真实备份。浏览器数据库与正式网站分离。</p>
        <div className="isolated-lab-actions">
          <button type="button" onClick={() => void seed()} disabled={busy}>
            {busy ? '初始化中……' : '生成两天虚构记录'}
          </button>
          <button type="button" onClick={() => {
            downloadBackup(makeSyntheticLabBackup('new-day'))
            setStatus('已下载仅供本测试站使用的“新增日期”虚构备份。')
          }}>下载新增测试文件</button>
          <button type="button" onClick={() => {
            downloadBackup(makeSyntheticLabBackup('conflict'))
            setStatus('已下载仅供本测试站使用的“同日冲突”虚构备份。')
          }}>下载冲突测试文件</button>
        </div>
        <p role="status">{status}</p>
        <LabLoginDiagnostic />
      </section>
      <DataPage key={revision} />
    </div>
  )
}
