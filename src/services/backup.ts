import { db } from '../db/database'
import type { AppBackup, DailyRecord, PeriodLabel } from '../types'

const BACKUP_FORMAT = 'personal-state-observer-backup' as const

export function createBackup(records: DailyRecord[], labels: PeriodLabel[]): AppBackup {
  return {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    appVersion: '1.5',
    schemaVersion: '0.6',
    exportedAt: new Date().toISOString(),
    dailyRecords: records,
    periodLabels: labels,
  }
}

export function downloadBackup(snapshot: AppBackup): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `personal-state-observer-backup-${snapshot.exportedAt.slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parseBackup(value: unknown): AppBackup {
  if (!value || typeof value !== 'object') throw new Error('这不是有效的备份文件。')

  const data = value as Partial<AppBackup>
  if (data.format !== BACKUP_FORMAT || data.formatVersion !== 1) {
    throw new Error('这个备份版本无法识别。')
  }
  if (!Array.isArray(data.dailyRecords) || !Array.isArray(data.periodLabels)) {
    throw new Error('备份内容不完整。')
  }

  for (const record of data.dailyRecords) {
    if (!record || typeof record !== 'object') throw new Error('每日记录格式有问题。')
    if (typeof record.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.recordDate ?? '')) {
      throw new Error('每日记录的日期格式有问题。')
    }
    if (!['draft', 'recorded', 'opted_out'].includes(record.recordingStatus)) {
      throw new Error('每日记录的状态格式有问题。')
    }
    if (!record.answers || typeof record.answers !== 'object') {
      throw new Error('每日记录的答案格式有问题。')
    }
  }

  for (const label of data.periodLabels) {
    if (!label || typeof label !== 'object') throw new Error('时期标记格式有问题。')
    if (
      typeof label.id !== 'string' ||
      typeof label.name !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(label.startDate ?? '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(label.endDate ?? '')
    ) {
      throw new Error('时期标记格式有问题。')
    }
  }

  return data as AppBackup
}

export async function readAllData() {
  const [dailyRecords, periodLabels] = await Promise.all([
    db.dailyRecords.orderBy('recordDate').toArray(),
    db.periodLabels.orderBy('startDate').toArray(),
  ])
  return { dailyRecords, periodLabels }
}

export async function restoreBackup(snapshot: AppBackup): Promise<void> {
  await db.transaction('rw', db.dailyRecords, db.periodLabels, async () => {
    await db.dailyRecords.clear()
    await db.periodLabels.clear()
    if (snapshot.dailyRecords.length) await db.dailyRecords.bulkPut(snapshot.dailyRecords)
    if (snapshot.periodLabels.length) await db.periodLabels.bulkPut(snapshot.periodLabels)
  })
}
