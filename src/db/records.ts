import { db } from './database'
import type { DailyRecord, PeriodLabel } from '../types'

export async function getDay(recordDate: string) {
  return db.dailyRecords.where('recordDate').equals(recordDate).first()
}

export async function saveDay(record: DailyRecord) {
  await db.dailyRecords.put(record)
}

export async function listDays(startDate: string, endDate: string) {
  return db.dailyRecords.where('recordDate').between(startDate, endDate, true, true).toArray()
}

export async function savePeriodLabel(label: PeriodLabel) {
  await db.periodLabels.put(label)
}

export async function listPeriodLabels() {
  return db.periodLabels.orderBy('startDate').toArray()
}

export async function replaceAll(records: DailyRecord[], labels: PeriodLabel[]) {
  await db.transaction('rw', db.dailyRecords, db.periodLabels, async () => {
    await db.dailyRecords.clear()
    await db.periodLabels.clear()
    if (records.length) await db.dailyRecords.bulkPut(records)
    if (labels.length) await db.periodLabels.bulkPut(labels)
  })
}
