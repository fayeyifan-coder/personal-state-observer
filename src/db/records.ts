import { db } from './database'
import type {
  DailyRecord,
  DeviceDailyData,
  PeriodLabel,
} from '../types'

export async function getDay(recordDate: string) {
  return db.dailyRecords.where('recordDate').equals(recordDate).first()
}

export async function saveDay(record: DailyRecord) {
  await db.dailyRecords.put(record)
}

export async function listDays(startDate: string, endDate: string) {
  return db.dailyRecords
    .where('recordDate')
    .between(startDate, endDate, true, true)
    .toArray()
}

export async function savePeriodLabel(label: PeriodLabel) {
  await db.periodLabels.put(label)
}

export async function listPeriodLabels() {
  return db.periodLabels.orderBy('startDate').toArray()
}

export async function getDeviceDay(recordDate: string) {
  return db.deviceDailyData
    .where('recordDate')
    .equals(recordDate)
    .first()
}

export async function saveDeviceDay(record: DeviceDailyData) {
  await db.deviceDailyData.put(record)
}

export async function deleteDeviceDay(recordDate: string) {
  const existing = await getDeviceDay(recordDate)

  if (existing) {
    await db.deviceDailyData.delete(existing.id)
  }
}

export async function listDeviceData(
  startDate?: string,
  endDate?: string,
) {
  if (startDate && endDate) {
    return db.deviceDailyData
      .where('recordDate')
      .between(startDate, endDate, true, true)
      .toArray()
  }

  return db.deviceDailyData.orderBy('recordDate').toArray()
}

export async function replaceAll(
  records: DailyRecord[],
  labels: PeriodLabel[],
  deviceData: DeviceDailyData[] = [],
) {
  await db.transaction(
    'rw',
    db.dailyRecords,
    db.periodLabels,
    db.deviceDailyData,
    async () => {
      await db.dailyRecords.clear()
      await db.periodLabels.clear()
      await db.deviceDailyData.clear()

      if (records.length) {
        await db.dailyRecords.bulkPut(records)
      }

      if (labels.length) {
        await db.periodLabels.bulkPut(labels)
      }

      if (deviceData.length) {
        await db.deviceDailyData.bulkPut(deviceData)
      }
    },
  )
}