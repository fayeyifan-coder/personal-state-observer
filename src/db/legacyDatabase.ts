import type { LegacyDailyRecord } from './legacyMigration';

export const LEGACY_DB_NAME = 'state-observer-db';
export const LEGACY_DB_VERSION = 3;
export const LEGACY_RECORD_STORE = 'daily_records';
export const LEGACY_LABEL_STORE = 'period_labels';

export type LegacyPeriodLabel = Record<string, unknown>;

export interface LegacyDatabaseSnapshot {
  records: LegacyDailyRecord[];
  periodLabels: LegacyPeriodLabel[];
}

export async function hasLegacyDatabase(): Promise<boolean> {
  const idb = globalThis.indexedDB as unknown as { databases?: () => Promise<Array<{ name: string; version: number }>> };
  
  if (typeof idb.databases !== 'function') {
    throw new Error('当前浏览器不支持 indexedDB.databases()，无法安全检测旧库是否存在。请勿冒险操作。');
  }

  const dbs = await idb.databases();
  return dbs.some(db => db.name === LEGACY_DB_NAME);
}

export async function readLegacyDatabase(): Promise<LegacyDatabaseSnapshot> {
  const exists = await hasLegacyDatabase();
  if (!exists) {
    throw new Error(`Legacy database '${LEGACY_DB_NAME}' does not exist. Aborting read.`);
  }

  return new Promise((resolve, reject) => {
    // 故意不传版本号，坚决不触发不可控的升/降级
    const request = indexedDB.open(LEGACY_DB_NAME);

    request.onupgradeneeded = (event) => {
      const transaction = (event.target as IDBOpenDBRequest).transaction;
      if (transaction) {
        transaction.abort();
      }
      reject(new Error('Unexpected upgrade needed. Aborted to prevent modifying legacy database.'));
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // 安全检查 1：确保版本是 3
      if (db.version !== LEGACY_DB_VERSION) {
        db.close();
        return reject(new Error(`Migration Failed: Database version mismatch. Expected ${LEGACY_DB_VERSION}, got ${db.version}.`));
      }

      // 安全检查 2：确保必需的 Object Store 存在
      if (!db.objectStoreNames.contains(LEGACY_RECORD_STORE) || !db.objectStoreNames.contains(LEGACY_LABEL_STORE)) {
        db.close();
        return reject(new Error('Migration Failed: Missing required object stores in legacy database.'));
      }

      try {
        const transaction = db.transaction([LEGACY_RECORD_STORE, LEGACY_LABEL_STORE], 'readonly');
        
        transaction.onabort = () => {
          db.close();
          reject(new Error('Legacy database transaction aborted.'));
        };

        const recordStore = transaction.objectStore(LEGACY_RECORD_STORE);
        const labelStore = transaction.objectStore(LEGACY_LABEL_STORE);

        const recordsRequest = recordStore.getAll();
        const labelsRequest = labelStore.getAll();

        transaction.oncomplete = () => {
          db.close();
          resolve({
            records: recordsRequest.result || [],
            periodLabels: labelsRequest.result || []
          });
        };

        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}