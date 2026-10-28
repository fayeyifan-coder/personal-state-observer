import Dexie, { type Table } from 'dexie'
import type {
  DailyRecord,
  DeviceDailyData,
  PeriodLabel,
} from '../types'

export class ObserverDB extends Dexie {
  dailyRecords!: Table<DailyRecord, string>
  periodLabels!: Table<PeriodLabel, string>
  deviceDailyData!: Table<DeviceDailyData, string>

  constructor() {
    super(import.meta.env?.VITE_ISOLATED_LAB === '1'
      ? 'personal-state-observer-fixture-lab-v1'
      : 'personal-state-observer')

    this.version(1).stores({
      dailyRecords: 'id, recordDate, recordingStatus, updatedAt',
      periodLabels: 'id, startDate, endDate, updatedAt',
    })

    this.version(2).stores({
      dailyRecords: 'id, recordDate, recordingStatus, updatedAt',
      periodLabels: 'id, startDate, endDate, updatedAt',
      deviceDailyData: 'id, recordDate, updatedAt',
    })
  }
}

export const db = new ObserverDB()