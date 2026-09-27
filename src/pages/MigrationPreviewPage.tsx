import React, { useState } from 'react';
import { hasLegacyDatabase, readLegacyDatabase } from '../db/legacyDatabase';
import { createMigrationPreview } from '../db/migrationPreview';
import type { MigrationPreview } from '../db/migrationPreview';

export const MigrationPreviewPage: React.FC = () => {
  const [dbExists, setDbExists] = useState<boolean | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [reading, setReading] = useState<boolean>(false);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckDB = async () => {
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      const exists = await hasLegacyDatabase();
      setDbExists(exists);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDbExists(null);
    } finally {
      setChecking(false);
    }
  };

  const handleGeneratePreview = async () => {
    setReading(true);
    setError(null);
    try {
      const snapshot = await readLegacyDatabase();
      const previewData = createMigrationPreview(snapshot);
      setPreview(previewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="page pb-20 p-4">
      <header className="mb-6">
        <h1 className="text-xl font-bold brand">V1.4 → V1.5 迁移预览</h1>
        <p className="text-sm text-red-500 font-semibold mt-1">只读模式：不会修改旧数据</p>
      </header>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded mb-4 text-sm break-words border border-red-200">
          <strong>错误：</strong> {error}
        </div>
      )}

      <div className="mb-6">
        <button 
          onClick={handleCheckDB} 
          disabled={checking || reading}
          className="button btn-primary px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {checking ? '检查中...' : '检查旧库'}
        </button>
      </div>

      {dbExists === false && (
        <div className="empty-state text-gray-500 p-4 border border-dashed rounded">
          未发现旧版数据库 state-observer-db
        </div>
      )}

      {dbExists === true && !preview && (
        <div className="p-4 border rounded bg-gray-50">
          <p className="text-green-600 font-semibold mb-4">发现旧版数据库，可进行只读预览</p>
          <button 
            onClick={handleGeneratePreview}
            disabled={reading}
            className="button px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
          >
            {reading ? '读取中...' : '读取旧库并生成预览'}
          </button>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="p-3 bg-green-50 text-green-800 border border-green-200 rounded text-sm font-medium">
            旧库读取完成；本次操作未写入任何数据库。
          </div>

          <div className="border rounded p-4 shadow-sm bg-white">
            <h2 className="font-semibold mb-3 border-b pb-2">数据预览摘要</h2>
            <ul className="space-y-2 text-sm text-gray-700">
              <li><strong>历史 DailyRecord 数量:</strong> {preview.legacyRecordCount}</li>
              <li><strong>历史 PeriodLabel 数量:</strong> {preview.legacyPeriodLabelCount}</li>
              <li>
                <strong>数据跨度:</strong> {preview.recordDateRange.start || 'N/A'} ~ {preview.recordDateRange.end || 'N/A'}
              </li>
              <li className="pt-2"><strong>状态分布:</strong>
                <ul className="pl-4 list-disc mt-1">
                  <li>已记录 (recorded): {preview.statusCounts.recorded}</li>
                  <li>草稿 (draft): {preview.statusCounts.draft}</li>
                  <li>已跳过 (opted_out): {preview.statusCounts.opted_out}</li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};