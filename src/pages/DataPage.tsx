// src/pages/DataPage.tsx
import { useEffect, useRef, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import {
  createBackup,
  downloadBackup,
  parseBackup,
  readAllData,
  restoreBackupIfCompatible,
} from '../services/backup'
import { compareBackupCollections, type BackupComparison } from '../services/backupComparison'
import { canSafelyReplaceWithBackup, getRestoreBlockReasons } from '../services/backupRestorePolicy'
import { encryptBackup, decryptBackup, downloadEncryptedBackup, isEncryptedBackup,
  MIN_BACKUP_PASSPHRASE_LENGTH, MAX_ENCRYPTED_BACKUP_FILE_BYTES } from '../services/encryptedBackup'
import {
  deleteDeviceDay,
  getDeviceDay,
  saveDeviceDay,
} from '../db/records'
import type { AppBackup, DailyRecord, DeviceDailyData, PeriodLabel } from '../types'
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
  const latestImportRequest = useRef(0)
  const [backupPreview, setBackupPreview] = useState<{
    filename: string
    snapshot: AppBackup
    comparison: BackupComparison
  } | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [cryptoBusy, setCryptoBusy] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [exportConfirm, setExportConfirm] = useState('')
  const [decryptPassword, setDecryptPassword] = useState('')
  const [encryptedPending, setEncryptedPending] = useState<{ filename: string; envelope: unknown } | null>(null)

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

  async function handleExport() {
    try {
      setError('')
      // Always export a fresh IndexedDB snapshot rather than cached page state.
      const current = await readAllData()
      downloadBackup(createBackup(current.dailyRecords, current.periodLabels, current.deviceData))
      setMessage('本机备份已生成，请保留旧版本。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败。')
    }
  }

  async function handleEncryptedExport() {
    if (cryptoBusy) return
    setError('')
    if (exportPassword !== exportConfirm) {
      setError('两次输入的加密密码不一致。')
      return
    }
    setCryptoBusy(true)
    try {
      const current = await readAllData()
      const encrypted = await encryptBackup(
        createBackup(current.dailyRecords, current.periodLabels, current.deviceData),
        exportPassword
      )
      downloadEncryptedBackup(encrypted)
      setExportPassword('')
      setExportConfirm('')
      setMessage('加密备份已下载。请另行妥善保管密码，丢失后无法恢复。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加密备份失败。')
    } finally {
      setCryptoBusy(false)
    }
  }

  async function previewParsed(snapshot: AppBackup, filename: string, request: number) {
    const current = await readAllData()
    if (request !== latestImportRequest.current) return
    setBackupPreview({ filename, snapshot, comparison: compareBackupCollections(current, snapshot) })
    setMessage('只读比对完成，没有修改或上传本机记录。')
  }

  async function handlePreviewBackup(file: File) {
    const request = ++latestImportRequest.current
    setBackupPreview(null)
    setEncryptedPending(null)
    setDecryptPassword('')
    setError('')
    setMessage('正在本机检查备份……')
    try {
      if (file.size > MAX_ENCRYPTED_BACKUP_FILE_BYTES) {
        throw new Error('备份文件过大，已停止读取。')
      }
      const parsed: unknown = JSON.parse(await file.text())
      if (request !== latestImportRequest.current) return
      if (isEncryptedBackup(parsed)) {
        setEncryptedPending({ filename: file.name, envelope: parsed })
        setMessage('识别到加密备份。输入密码后将在本机解密并预览。')
      } else {
        await previewParsed(parseBackup(parsed), file.name, request)
      }
    } catch (cause) {
      if (request !== latestImportRequest.current) return
      setMessage('')
      setError(cause instanceof Error ? cause.message : '备份检查失败。')
    }
  }

  async function handleDecryptPreview() {
    const pending = encryptedPending
    if (!pending || cryptoBusy) return
    const request = latestImportRequest.current
    setCryptoBusy(true)
    setError('')
    try {
      const decrypted = await decryptBackup(pending.envelope, decryptPassword)
      if (request !== latestImportRequest.current) return
      await previewParsed(parseBackup(decrypted), pending.filename, request)
      if (request !== latestImportRequest.current) return
      setEncryptedPending(null)
      setDecryptPassword('')
    } catch (cause) {
      if (request === latestImportRequest.current) {
        setMessage('')
        setError(cause instanceof Error ? cause.message : '解密失败。')
      }
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleSafeRestore() {
    const preview = backupPreview
    if (!preview || restoreBusy || !canSafelyReplaceWithBackup(preview.comparison, preview.snapshot)) return
    const confirmed = window.confirm(
      '这不是合并操作，而是用备份整体替换本机数据。检查结果未发现本机独有记录或内容冲突。' +
      '\\n\\n请确认已另外保存本机 JSON 备份，并且确实要恢复该文件。'
    )
    if (!confirmed) return

    setRestoreBusy(true)
    setError('')
    try {
      // The data layer rechecks safety within the same write transaction.
      await restoreBackupIfCompatible(preview.snapshot)
      ++latestImportRequest.current
      setBackupPreview(null)
      await refresh()
      setMessage('安全恢复完成，请核对日期和记录数量。')
    } catch (cause) {
      setMessage('')
      setError(cause instanceof Error ? cause.message : '恢复失败；已停止写入。')
      // Re-run the read-only comparison after a concurrent change.
      try {
        const current = await readAllData()
        setBackupPreview({
          ...preview,
          comparison: compareBackupCollections(current, preview.snapshot)
        })
      } catch {
        setBackupPreview(null)
      }
    } finally {
      setRestoreBusy(false)
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

  const previewRows = backupPreview ? [
    { name: '每日记录', data: backupPreview.comparison.dailyRecords },
    { name: '时期标记', data: backupPreview.comparison.periodLabels },
    { name: '设备数据', data: backupPreview.comparison.deviceData }
  ] : []
  const previewSafeToReplace = backupPreview
    ? canSafelyReplaceWithBackup(backupPreview.comparison, backupPreview.snapshot)
    : false

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
              <button className="primary" onClick={() => void handleExport()}>导出 JSON 备份</button>
            </div>
          </section>

          <section className="data-section">
            <div className="section-heading"><span>加密备份</span><span>本机加密 · 不上传</span></div>
            <div className="data-card">
              <h2>加密导出跨设备备份</h2>
              <p>用密码加密本机全部记录并下载。密码不会保存到网站或文件，丢失密码将无法恢复；当前仍需自行传输文件，不是自动云同步。</p>
              <div className="data-form">
                <label>
                  <span>密码（至少 {MIN_BACKUP_PASSPHRASE_LENGTH} 个字符）</span>
                  <input type="password" autoComplete="new-password"
                    value={exportPassword} onChange={event => setExportPassword(event.target.value)}
                    placeholder="使用较长且唯一的密码短语" />
                </label>
                <label>
                  <span>再次输入密码</span>
                  <input type="password" autoComplete="new-password"
                    value={exportConfirm} onChange={event => setExportConfirm(event.target.value)}
                    placeholder="再次输入密码以确认" />
                </label>
              </div>
              <div className="backup-compare-actions">
                <button className="primary" type="button" disabled={cryptoBusy || restoreBusy}
                  onClick={() => void handleEncryptedExport()}>
                  {cryptoBusy ? '处理中……' : '下载加密 JSON 备份'}
                </button>
              </div>
            </div>
          </section>

          <section className="data-section">
            <div className="section-heading"><span>备份差异预览</span><span>本机检查 · 不上传</span></div>
            <div className="data-card">
              <h2>检查备份再决定是否恢复</h2>
              <p>支持普通和加密 JSON 备份。加密文件先本机解锁，然后仅预览差异；冲突或本机独有记录仍禁止覆盖。</p>
              <button
                className="quiet"
                type="button"
                disabled={restoreBusy || cryptoBusy}
                onClick={() => inputRef.current?.click()}
              >选择 JSON 文件并预览</button>
              <input
                ref={inputRef}
                type="file"
                accept=".json,application/json"
                aria-label="选择个人状态观察器 JSON 备份"
                hidden
                disabled={restoreBusy || cryptoBusy}
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void handlePreviewBackup(file)
                }}
              />
              {encryptedPending && (
                <div className="backup-compare">
                  <h3>解锁加密备份</h3>
                  <p className="backup-filename">{encryptedPending.filename}</p>
                  <label className="backup-password-label">
                    <span>备份密码（仅在本机使用）</span>
                    <input type="password" autoComplete="off"
                      value={decryptPassword} onChange={event => setDecryptPassword(event.target.value)} />
                  </label>
                  <div className="backup-compare-actions">
                    <button className="primary" type="button"
                      disabled={cryptoBusy || restoreBusy || !decryptPassword}
                      onClick={() => void handleDecryptPreview()}>
                      {cryptoBusy ? '正在解密……' : '解密并预览差异'}
                    </button>
                    <button className="quiet" type="button" disabled={cryptoBusy}
                      onClick={() => {
                        ++latestImportRequest.current
                        setEncryptedPending(null)
                        setDecryptPassword('')
                        setMessage('已取消解密，没有修改本机数据。')
                      }}>取消</button>
                  </div>
                </div>
              )}
              {backupPreview && (
                <div className="backup-compare" role="region" aria-label="备份差异预览">
                  <h3>差异检查结果</h3>
                  <p className="backup-filename">{backupPreview.filename}</p>
                  <div className="backup-compare-header" aria-hidden="true">
                    <span>数据类型</span><span>仅本机</span><span>仅备份</span><span>不同</span><span>相同</span>
                  </div>
                  {previewRows.map(row => (
                    <div className="backup-compare-row" key={row.name}>
                      <strong>{row.name}</strong>
                      <span>{row.data.localOnly.length}</span>
                      <span>{row.data.incomingOnly.length}</span>
                      <span>{row.data.conflicts.length}</span>
                      <span>{row.data.identical.length}</span>
                    </div>
                  ))}
                  {getRestoreBlockReasons(backupPreview.comparison, backupPreview.snapshot).includes('duplicate-keys') && (
                    <p className="backup-warning">检测到同一逻辑日期或标记 ID 重复，已禁止恢复。</p>
                  )}
                  {previewRows.some(row => row.data.localOnly.length || row.data.conflicts.length) && (
                    <details className="backup-conflict-details">
                      <summary>查看本机独有或冲突的记录</summary>
                      {previewRows.map(row => {
                        const keys = [
                          ...row.data.localOnly.map(key => '本机独有：' + key),
                          ...row.data.conflicts.map(key => '内容不同：' + key)
                        ]
                        return keys.length > 0 ? (
                          <p key={row.name}>{row.name}：{keys.slice(0, 12).join('，')}{keys.length > 12 ? `（另有 ${keys.length - 12} 项）` : ''}</p>
                        ) : null
                      })}
                    </details>
                  )}
                  {previewSafeToReplace ? (
                    <p className="backup-advice">未发现会丢失的本机独有记录或内容冲突。仍建议先导出本机备份，然后明确确认恢复。</p>
                  ) : (
                    <p className="backup-warning">
                      为保护当前设备的数据，暂不允许覆盖。请保留两端的 JSON 备份，等待安全合并功能。
                      （{getRestoreBlockReasons(backupPreview.comparison, backupPreview.snapshot).map(reason => ({ 'local-only': '本机独有', conflicts: '内容冲突', 'duplicate-keys': '重复标识' })[reason]).join('、')}）
                    </p>
                  )}
                  <div className="backup-compare-actions">
                    {previewSafeToReplace && (
                      <button
                        className="primary"
                        type="button"
                        disabled={restoreBusy}
                        onClick={() => void handleSafeRestore()}
                      >{restoreBusy ? '检查与恢复中……' : '确认以备份替换本机数据'}</button>
                    )}
                    <button
                      className="quiet"
                      type="button"
                      disabled={restoreBusy}
                      onClick={() => {
                        ++latestImportRequest.current
                        setBackupPreview(null)
                        setMessage('已关闭预览，本机数据未修改。')
                      }}
                    >关闭预览</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="data-note">
            <strong>数据主权</strong>
            <p>没有账号或云端同步。普通 JSON 是明文；加密 JSON 的密码丢失后无法找回。请自行妥善保管备份。</p>
          </section>
        </>
      )}

      <BottomNav current="/data" />
    </div>
  )
}
