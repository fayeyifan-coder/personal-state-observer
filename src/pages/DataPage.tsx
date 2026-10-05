import { useEffect, useRef, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { createBackup, downloadBackup, parseBackup, readAllData, restoreBackup } from '../services/backup'
import type { DailyRecord, PeriodLabel } from '../types'

export function DataPage() {
  const [records, setRecords] = useState<DailyRecord[]>([])
  const [labels, setLabels] = useState<PeriodLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      setError('')
      const data = await readAllData()
      setRecords(data.dailyRecords)
      setLabels(data.periodLabels)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '数据暂时无法读取。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const recorded = records.filter(record => record.recordingStatus === 'recorded').length
  const optedOut = records.filter(record => record.recordingStatus === 'opted_out').length
  const drafts = records.filter(record => record.recordingStatus === 'draft').length
  const answers = records.reduce(
    (total, record) => total + Object.values(record.answers).filter(value => value != null).length,
    0,
  )

  function handleExport() {
    try {
      setError('')
      const backup = createBackup(records, labels)
      downloadBackup(backup)
      setMessage('备份文件已生成。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败。')
    }
  }

  async function handleRestore(file: File) {
    try {
      setError('')
      setMessage('正在检查备份……')
      const parsed = JSON.parse(await file.text())
      const backup = parseBackup(parsed)
      const ok = window.confirm(
        `这个备份包含 ${backup.dailyRecords.length} 条每日记录和 ${backup.periodLabels.length} 个时期标记。\n\n恢复后会替换当前设备上的全部记录。确定继续吗？`,
      )
      if (!ok) {
        setMessage('已取消恢复。')
        return
      }
      await restoreBackup(backup)
      await refresh()
      setMessage('恢复完成。')
    } catch (cause) {
      setMessage('')
      setError(cause instanceof Error ? cause.message : '恢复失败。')
    }
  }

  return (
    <div className="page shell data-page">
      <header className="archive-header">
        <div>
          <p className="eyebrow">私人观察台</p>
          <h1>数据</h1>
        </div>
        <span className="data-caption">只存在这台设备</span>
      </header>

      {loading ? (
        <section className="empty-state"><p>读取本机数据……</p></section>
      ) : (
        <>
          {error && <div className="inline-error">{error}</div>}
          {message && <div className="inline-message">{message}</div>}

          <section className="data-overview">
            <div className="overview-card"><strong>{records.length}</strong><span>有活动的日子</span></div>
            <div className="overview-card"><strong>{recorded}</strong><span>完成记录</span></div>
            <div className="overview-card"><strong>{optedOut}</strong><span>主动不记录</span></div>
            <div className="overview-card"><strong>{drafts}</strong><span>未完成</span></div>
            <div className="overview-card"><strong>{answers}</strong><span>已留下的答案</span></div>
            <div className="overview-card"><strong>{labels.length}</strong><span>时期标记</span></div>
          </section>

          <section className="data-section">
            <div className="section-heading"><span>备份</span><span>JSON</span></div>
            <div className="data-card">
              <h2>把数据完整带走</h2>
              <p>导出每日记录和时期标记。文件保存在你的设备上，不会上传。</p>
              <button className="primary" onClick={handleExport}>导出 JSON 备份</button>
            </div>
          </section>

          <section className="data-section">
            <div className="section-heading"><span>恢复</span><span>替换本机数据</span></div>
            <div className="data-card">
              <h2>从备份恢复</h2>
              <p>先检查文件内容，再确认是否替换当前设备上的全部记录。</p>
              <button className="quiet" onClick={() => inputRef.current?.click()}>选择 JSON 文件</button>
              <input
                ref={inputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void handleRestore(file)
                }}
              />
            </div>
          </section>

          <section className="data-note">
            <strong>数据主权</strong>
            <p>没有账号、没有云端同步。请把备份保存到你自己控制的位置。</p>
          </section>
        </>
      )}

      <BottomNav current="/data" />
    </div>
  )
}
