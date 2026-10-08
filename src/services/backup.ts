// src/services/backup.ts
import { db } from '../db/database'
import type { AppBackup, DailyRecord, DeviceDailyData, PeriodLabel } from '../types'

const BACKUP_FORMAT = 'personal-state-observer-backup' as const
const CURRENT_SCHEMA_VERSION = '0.8'

export function createBackup(
  records: DailyRecord[],
  labels: PeriodLabel[],
  deviceData: DeviceDailyData[] = []
): AppBackup {
  return {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    appVersion: '1.5',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    dailyRecords: records,
    periodLabels: labels,
    deviceData
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

function validateDeviceData(value: unknown): DeviceDailyData[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('设备数据格式有问题。')

  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('设备数据格式有问题。')

    const data = item as Partial<DeviceDailyData>
    if (
      typeof data.id !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.recordDate ?? '') ||
      (data.source !== 'manual' && data.source !== 'huawei-health')
    ) {
      throw new Error('设备数据的日期或来源格式有问题。')
    }

    for (const field of ['sleepDurationMin', 'steps', 'heartRateAvg', 'weightKg'] as const) {
      const fieldValue = data[field]
      if (fieldValue !== null && fieldValue !== undefined &&
        (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))) {
        throw new Error(`设备数据字段 ${field} 格式有问题。`)
      }
    }

    if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') {
      throw new Error('设备数据时间字段格式有问题。')
    }
  }

  return value as DeviceDailyData[]
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

  return {
    ...(data as AppBackup),
    deviceData: validateDeviceData(data.deviceData)
  }
}

export async function readAllData() {
  const [dailyRecords, periodLabels, deviceData] = await Promise.all([
    db.dailyRecords.orderBy('recordDate').toArray(),
    db.periodLabels.orderBy('startDate').toArray(),
    db.deviceDailyData.orderBy('recordDate').toArray()
  ])
  return { dailyRecords, periodLabels, deviceData }
}

export async function restoreBackup(snapshot: AppBackup): Promise<void> {
  const deviceData = snapshot.deviceData ?? []

  await db.transaction('rw', db.dailyRecords, db.periodLabels, db.deviceDailyData, async () => {
    await db.dailyRecords.clear()
    await db.periodLabels.clear()
    await db.deviceDailyData.clear()

    if (snapshot.dailyRecords.length) {
      await db.dailyRecords.bulkPut(snapshot.dailyRecords)
    }
    if (snapshot.periodLabels.length) {
      await db.periodLabels.bulkPut(snapshot.periodLabels)
    }
    if (deviceData.length) {
      await db.deviceDailyData.bulkPut(deviceData)
    }
  })
}
