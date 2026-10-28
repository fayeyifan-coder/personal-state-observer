import type { AppBackup, DailyRecord, DeviceDailyData, PeriodLabel } from '../types'
import { createBackup } from './backup'

export const ISOLATED_LAB_MARKER = 'PERSONAL_STATE_OBSERVER_SYNTHETIC_TEST_ONLY_V1' as const

const time = '2026-10-28T02:00:00.000Z'

function makeDay(date: string, mood: number): DailyRecord {
  return {
    id: 'testlab-day-' + date, recordDate: date,
    recordingStatus: 'recorded', startedAt: time, completedAt: time,
    optedOutAt: null, updatedAt: time, currentPhase: null, lastQuestionId: null,
    morningStatus: 'recorded', eveningStatus: 'draft',
    answers: { mood, sleepQuality: 3, comment: '仅用于测试的虚构记录' }
  }
}

export function syntheticLabRecords(): {
  dailyRecords: DailyRecord[]
  periodLabels: PeriodLabel[]
  deviceData: DeviceDailyData[]
} {
  return {
    dailyRecords: [makeDay('2026-10-26', 3), makeDay('2026-10-27', 4)],
    periodLabels: [{
      id: 'testlab-period', name: '虚构测试时期',
      startDate: '2026-10-26', endDate: '2026-10-27',
      kind: 'user_period', createdAt: time, updatedAt: time
    }],
    deviceData: [{
      id: 'testlab-device-2026-10-27', recordDate: '2026-10-27',
      source: 'manual', sleepDurationMin: 450, steps: 3456,
      heartRateAvg: 69, weightKg: null, createdAt: time, updatedAt: time
    }]
  }
}

export function makeSyntheticLabBackup(variant: 'same' | 'new-day' | 'conflict' = 'same'): AppBackup {
  const sample = syntheticLabRecords()
  if (variant === 'new-day') sample.dailyRecords.push(makeDay('2026-10-28', 5))
  if (variant === 'conflict') sample.dailyRecords[1] = makeDay('2026-10-27', 1)
  return markSyntheticLabBackup(createBackup(sample.dailyRecords, sample.periodLabels, sample.deviceData))
}

export function markSyntheticLabBackup(snapshot: AppBackup): AppBackup {
  return { ...snapshot, testFixtureTag: ISOLATED_LAB_MARKER } as AppBackup
}

export function assertPreviewBackupAllowed(value: unknown): void {
  const marker = value && typeof value === 'object'
    ? (value as { testFixtureTag?: unknown }).testFixtureTag
    : undefined
  const isLabBuild = import.meta.env?.VITE_ISOLATED_LAB === '1'
  if (isLabBuild && marker !== ISOLATED_LAB_MARKER) {
    throw new Error('测试站点只接受本测试站生成的虚构备份，不能读取真实个人备份。')
  }
  if (!isLabBuild && marker === ISOLATED_LAB_MARKER) {
    throw new Error('虚构测试备份不能恢复到正式个人状态观察器。')
  }
}
