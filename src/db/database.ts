import Dexie, { type Table } from 'dexie'
import type { DailyRecord, PeriodLabel } from '../types'

export class ObserverDB extends Dexie {
  dailyRecords!: Table<DailyRecord, string>
  periodLabels!: Table<PeriodLabel, string>

  constructor() {
    super('personal-state-observer')
    this.version(1).stores({
      dailyRecords: 'id, recordDate, recordingStatus, updatedAt',
      periodLabels: 'id, startDate, endDate, updatedAt'
    })
  }
}

export const db = new ObserverDB()
