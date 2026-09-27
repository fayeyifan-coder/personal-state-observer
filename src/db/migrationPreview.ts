import type { DailyRecord, PeriodLabel } from '../types';
import { normalizeLegacyDailyRecord } from './legacyMigration';
import type { LegacyDatabaseSnapshot, LegacyPeriodLabel } from './legacyDatabase';

export interface MigrationPreview {
  legacyRecordCount: number;
  legacyPeriodLabelCount: number;
  migratedRecords: DailyRecord[];
  migratedPeriodLabels: PeriodLabel[];
  recordDateRange: {
    start: string | null;
    end: string | null;
  };
  statusCounts: {
    draft: number;
    recorded: number;
    opted_out: number;
  };
}

const ALLOWED_LABEL_KEYS = new Set<string>([
  'id', 'name', 'startDate', 'endDate', 'createdAt', 'updatedAt', 'kind'
]);

function isValidCalendarDate(dateString: unknown): dateString is string {
  if (typeof dateString !== 'string') return false;
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year && 
    d.getUTCMonth() + 1 === month && 
    d.getUTCDate() === day
  );
}

export function normalizeLegacyPeriodLabel(legacy: LegacyPeriodLabel): PeriodLabel {
  for (const key of Object.keys(legacy)) {
    if (!ALLOWED_LABEL_KEYS.has(key)) {
      throw new Error(`Migration Failed: PeriodLabel contains unknown field '${key}'.`);
    }
  }

  if (typeof legacy.id !== 'string' || legacy.id.trim() === '') {
    throw new Error('Migration Failed: PeriodLabel missing or empty id.');
  }
  if (typeof legacy.name !== 'string' || legacy.name.trim() === '') {
    throw new Error('Migration Failed: PeriodLabel missing or empty name.');
  }

  if (!isValidCalendarDate(legacy.startDate)) {
    throw new Error(`Migration Failed: PeriodLabel invalid startDate '${legacy.startDate}'. Expected valid calendar YYYY-MM-DD.`);
  }
  if (!isValidCalendarDate(legacy.endDate)) {
    throw new Error(`Migration Failed: PeriodLabel invalid endDate '${legacy.endDate}'. Expected valid calendar YYYY-MM-DD.`);
  }

  if (legacy.startDate > legacy.endDate) {
    throw new Error(`Migration Failed: PeriodLabel startDate '${legacy.startDate}' cannot be after endDate '${legacy.endDate}'.`);
  }

  if (typeof legacy.createdAt !== 'string') {
    throw new Error(`Migration Failed: PeriodLabel missing or invalid createdAt. Expected ISO string.`);
  }
  if (typeof legacy.updatedAt !== 'string') {
    throw new Error(`Migration Failed: PeriodLabel missing or invalid updatedAt. Expected ISO string.`);
  }

  if (legacy.kind !== 'user_period') {
    throw new Error(`Migration Failed: PeriodLabel invalid kind '${legacy.kind}'. Expected 'user_period'.`);
  }

  return {
    id: legacy.id,
    name: legacy.name,
    startDate: legacy.startDate,
    endDate: legacy.endDate,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    kind: 'user_period'
  };
}

export function createMigrationPreview(snapshot: LegacyDatabaseSnapshot): MigrationPreview {
  const migratedRecords = snapshot.records.map(r => normalizeLegacyDailyRecord(r));
  const migratedPeriodLabels = snapshot.periodLabels.map(l => normalizeLegacyPeriodLabel(l));

  let start: string | null = null;
  let end: string | null = null;
  
  const statusCounts = {
    draft: 0,
    recorded: 0,
    opted_out: 0
  };

  for (const record of migratedRecords) {
    if (start === null || record.recordDate < start) {
      start = record.recordDate;
    }
    if (end === null || record.recordDate > end) {
      end = record.recordDate;
    }

    if (record.recordingStatus === 'draft' || record.recordingStatus === 'recorded' || record.recordingStatus === 'opted_out') {
      statusCounts[record.recordingStatus]++;
    }
  }

  return {
    legacyRecordCount: snapshot.records.length,
    legacyPeriodLabelCount: snapshot.periodLabels.length,
    migratedRecords,
    migratedPeriodLabels,
    recordDateRange: { start, end },
    statusCounts
  };
}