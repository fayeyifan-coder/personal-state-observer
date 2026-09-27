import { createMigrationPreview, normalizeLegacyPeriodLabel } from '../src/db/migrationPreview';
import type { LegacyDatabaseSnapshot, LegacyPeriodLabel } from '../src/db/legacyDatabase';
import type { LegacyDailyRecord } from '../src/db/legacyMigration';

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

function expectThrow(fn: () => void, message: string) {
  let threw = false;

  try {
    fn();
  } catch (error) {
    threw = error instanceof Error;
  }

  assert(threw, message);
}

async function runTests() {
  console.log('Running Migration Preview Tests...\n');

  const isoTime = '2026-09-25T00:00:00.000Z';
  
  // 基础有效数据
  const validLegacyLabel: LegacyPeriodLabel = {
    id: 'lbl_123',
    name: '月经期',
    startDate: '2023-11-01',
    endDate: '2023-11-05',
    createdAt: isoTime,
    updatedAt: isoTime,
    kind: 'user_period'
  };

  // 1. 合法 PeriodLabel
  const normalizedLabel = normalizeLegacyPeriodLabel(validLegacyLabel);
  assert(normalizedLabel.id === 'lbl_123', '1. 合法 PeriodLabel 可以通过');

  // 2. 2024-02-29
  let leapYearPass = true;
  try {
    normalizeLegacyPeriodLabel({ ...validLegacyLabel, startDate: '2024-02-29', endDate: '2024-03-01' });
  } catch (e) {
    leapYearPass = false;
  }
  assert(leapYearPass, '2. 2024-02-29 作为合法闰年日期可以通过');

  // 3. 2023-02-31 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, startDate: '2023-02-31' }), '3. 2023-02-31 非法日期拒绝');
  
  // 4. 非法月份拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, endDate: '2023-99-01' }), '4. 非法月份拒绝');

  // 5. startDate > endDate 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, startDate: '2023-11-10', endDate: '2023-11-05' }), '5. startDate > endDate 拒绝');

  // 6. 缺失 createdAt 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, createdAt: undefined }), '6. 缺失 createdAt 拒绝');
  
  // 7. numeric createdAt 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, createdAt: 1700000000 }), '7. numeric createdAt 拒绝');

  // 8. 缺失 updatedAt 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, updatedAt: null }), '8. 缺失 updatedAt 拒绝');

  // 9. numeric updatedAt 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, updatedAt: 1700000000 }), '9. numeric updatedAt 拒绝');

  // 10. 错误 kind 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, kind: 'system_period' }), '10. 错误 kind 拒绝');

  // 11. unknown field 拒绝
  expectThrow(() => normalizeLegacyPeriodLabel({ ...validLegacyLabel, unknown_field: 'bad_value' }), '11. unknown field 拒绝');

  // --- Snapshot 预览与数据不可变测试 ---
  const record1: LegacyDailyRecord = { id: 'day_2023-11-01', recordDate: '2023-11-01', recordingStatus: 'recorded', updatedAt: isoTime };
  const record2: LegacyDailyRecord = { id: 'day_2023-11-05', recordDate: '2023-11-05', recordingStatus: 'opted_out', updatedAt: isoTime };
  const record3: LegacyDailyRecord = { id: 'day_2023-10-31', recordDate: '2023-10-31', recordingStatus: 'draft', updatedAt: isoTime };

  const snapshot: LegacyDatabaseSnapshot = {
    records: [record1, record2, record3],
    periodLabels: [validLegacyLabel, { ...validLegacyLabel, id: 'lbl_124' }]
  };
  
  // 16. snapshot 不被修改
  const snapshotJsonBefore = JSON.stringify(snapshot);
  const preview = createMigrationPreview(snapshot);
  const snapshotJsonAfter = JSON.stringify(snapshot);
  assert(snapshotJsonBefore === snapshotJsonAfter, '16. snapshot 不被修改 (纯函数)');

  // 12. daily record 数量
  assert(preview.legacyRecordCount === 3, '12. daily record 数量统计正确');
  
  // 13. period label 数量
  assert(preview.legacyPeriodLabelCount === 2, '13. period label 数量统计正确');
  
  // 14. draft / recorded / opted_out 数量
  assert(
    preview.statusCounts.recorded === 1 && 
    preview.statusCounts.opted_out === 1 && 
    preview.statusCounts.draft === 1, 
    '14. draft / recorded / opted_out 数量统计正确'
  );

  // 15. recordDateRange
  assert(
    preview.recordDateRange.start === '2023-10-31' && 
    preview.recordDateRange.end === '2023-11-05', 
    '15. recordDateRange 计算正确'
  );

  console.log('\nTests Completed.');
}

runTests();