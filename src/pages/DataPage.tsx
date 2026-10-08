// src/pages/DataPage.tsx
import { useEffect, useRef, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import {
  createBackup,
  downloadBackup,
  parseBackup,
  readAllData,
  restoreBackup,
} from '../services/backup'
import {
  deleteDeviceDay,
  getDeviceDay,
  saveDeviceDay,
} from '../db/records'
import type { DailyRecord, DeviceDailyData, PeriodLabel } from '../types'
import { getLocalDateKey } from '../utils/dateUtils'

function emptyDeviceForm(date = getLocalDateKey()) {
  return {
    recordDate: date,
    sleepDurationMin: '',
    steps: '',
    heartRateAvg: '',
    weightKg: ''
  }
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function displayNumber(value: number | null, suffix = '') {
  return value == null ? '—' : `${value}${suffix}`
}

export function DataPage() {
  const [records, setRecords] = useState<DailyRecord[]>([])
  const [labels, setLabels] = useState<PeriodLabel[]>([])
  const [deviceData, setDeviceData] = useState<DeviceDailyData[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm())
  const [editingDeviceDate, setEditingDeviceDate] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      setError('')
      const data = await readAllData()
      setRecords(data.dailyRecords)
      setLabels(data.periodLabels)
      setDeviceData(data.deviceData ?? [])
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
      const backup = createBackup(records, labels, deviceData)
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
      const deviceCount = backup.deviceData?.length ?? 0
      const ok = window.confirm(
        `这个备份包含 ${backup.dailyRecords.length} 条每日记录、${backup.periodLabels.length} 个时期标记和 ${deviceCount} 条设备数据。\n\n恢复后会替换当前设备上的全部记录。确定继续吗？`,
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

  function editDeviceDay(day: DeviceDailyData) {
    setEditingDeviceDate(day.recordDate)
    setDeviceForm({
      recordDate: day.recordDate,
      sleepDurationMin: day.sleepDurationMin == null ? '' : String(day.sleepDurationMin),
      steps: day.steps == null ? '' : String(day.steps),
      heartRateAvg: day.heartRateAvg == null ? '' : String(day.heartRateAvg),
      weightKg: day.weightKg == null ? '' : String(day.weightKg)
    })
  }

  function cancelDeviceEdit() {
    setEditingDeviceDate(null)
    setDeviceForm(emptyDeviceForm())
  }

  async function saveManualDeviceData() {
    const values = {
      sleepDurationMin: numberOrNull(deviceForm.sleepDurationMin),
      steps: numberOrNull(deviceForm.steps),
      heartRateAvg: numberOrNull(deviceForm.heartRateAvg),
      weightKg: numberOrNull(deviceForm.weightKg)
    }

    if (Object.values(values).every(value => value === null)) {
      setError('至少填写一项设备 / 自测数据。')
      return
    }

    if (values.sleepDurationMin != null && values.sleepDurationMin < 0) {
      setError('睡眠时长不能小于 0。')
      return
    }
    if (values.steps != null && values.steps < 0) {
      setError('步数不能小于 0。')
      return
    }
    if (values.heartRateAvg != null && values.heartRateAvg <= 0) {
      setError('平均心率必须大于 0。')
      return
    }
    if (values.weightKg != null && values.weightKg <= 0) {
      setError('体重必须大于 0。')
      return
    }

    try {
      setError('')
      const existing = await getDeviceDay(deviceForm.recordDate)
      const now = new Date().toISOString()
      const next: DeviceDailyData = {
        id: existing?.id ?? `device_${deviceForm.recordDate}`,
        recordDate: deviceForm.recordDate,
        source: 'manual',
        ...values,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      await saveDeviceDay(next)
      await refresh()
      setMessage(`已保存 ${deviceForm.recordDate} 的设备 / 自测数据。`)
      cancelDeviceEdit()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设备数据保存失败。')
    }
  }

  async function removeDeviceDay(recordDate: string) {
    const ok = window.confirm(`确定删除 ${recordDate} 的设备数据吗？`)
    if (!ok) return

    try {
      await deleteDeviceDay(recordDate)
      await refresh()
      setMessage(`已删除 ${recordDate} 的设备数据。`)
      if (editingDeviceDate === recordDate) cancelDeviceEdit()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设备数据删除失败。')
    }
  }

  const recentDeviceData = [...deviceData]
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate))
    .slice(0, 7)

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
            <div className="section-heading"><span>设备 / 自测数据</span><span>手动输入</span></div>
            <div className="data-card">
              <h2>{editingDeviceDate ? `修改 ${editingDeviceDate}` : '先把设备数据层建起来'}</h2>
              <p>这些数据独立于你的主观观察保存。以后接入华为健康时，只替换数据来源，不覆盖原来的观察。</p>

              <div className="data-form">
                <label>
                  <span>日期</span>
                  <input
                    type="date"
                    value={deviceForm.recordDate}
                    onChange={event => setDeviceForm(form => ({ ...form, recordDate: event.target.value }))}
                  />
                </label>
                <label>
                  <span>睡眠时长（分钟）</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={deviceForm.sleepDurationMin}
                    onChange={event => setDeviceForm(form => ({ ...form, sleepDurationMin: event.target.value }))}
                  />
                </label>
                <label>
                  <span>步数</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={deviceForm.steps}
                    onChange={event => setDeviceForm(form => ({ ...form, steps: event.target.value }))}
                  />
                </label>
                <label>
                  <span>平均心率</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={deviceForm.heartRateAvg}
                    onChange={event => setDeviceForm(form => ({ ...form, heartRateAvg: event.target.value }))}
                  />
                </label>
                <label>
                  <span>体重（kg）</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={deviceForm.weightKg}
                    onChange={event => setDeviceForm(form => ({ ...form, weightKg: event.target.value }))}
                  />
                </label>
              </div>

              <div className="stack inline-actions">
                <button className="primary" onClick={() => void saveManualDeviceData()}>保存设备数据</button>
                {editingDeviceDate && <button className="quiet" onClick={cancelDeviceEdit}>取消修改</button>}
              </div>
            </div>
          </section>

          <section className="data-section">
            <div className="section-heading"><span>最近设备数据</span><span>{deviceData.length} 天</span></div>
            <div className="data-card">
              {recentDeviceData.length === 0 ? (
                <p>还没有设备数据。先手动填一天，数据层就开始工作了。</p>
              ) : (
                <div className="device-data-list">
                  {recentDeviceData.map(day => (
                    <article className="device-data-row" key={day.id}>
                      <div>
                        <strong>{day.recordDate}</strong>
                        <small>{day.source === 'manual' ? '手动' : '华为健康'}</small>
                      </div>
                      <div className="device-data-values">
                        <span>睡眠 <b>{displayNumber(day.sleepDurationMin, ' min')}</b></span>
                        <span>步数 <b>{day.steps == null ? '—' : day.steps.toLocaleString()}</b></span>
                        <span>心率 <b>{displayNumber(day.heartRateAvg, ' bpm')}</b></span>
                        <span>体重 <b>{displayNumber(day.weightKg, ' kg')}</b></span>
                      </div>
                      <div className="inline-actions">
                        <button className="quiet" onClick={() => editDeviceDay(day)}>修改</button>
                        <button className="quiet" onClick={() => void removeDeviceDay(day.recordDate)}>删除</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="data-section">
            <div className="section-heading"><span>备份</span><span>JSON</span></div>
            <div className="data-card">
              <h2>把数据完整带走</h2>
              <p>导出每日记录、时期标记和设备 / 自测数据。文件保存在你的设备上，不会上传。</p>
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
