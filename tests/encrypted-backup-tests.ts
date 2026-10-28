import assert from 'node:assert/strict'
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  ENCRYPTED_BACKUP_FORMAT,
  MIN_BACKUP_PASSPHRASE_LENGTH
} from '../src/services/encryptedBackup'
import type { AppBackup } from '../src/types'

const snapshot: AppBackup = {
  format: 'personal-state-observer-backup',
  formatVersion: 1,
  appVersion: '1.5',
  schemaVersion: '0.8',
  exportedAt: '2026-10-28T00:00:00.000Z',
  dailyRecords: [{
    id: 'day_2026-10-27',
    recordDate: '2026-10-27',
    recordingStatus: 'recorded',
    startedAt: null,
    completedAt: null,
    optedOutAt: null,
    currentPhase: null,
    lastQuestionId: null,
    morningStatus: 'recorded',
    eveningStatus: 'draft',
    updatedAt: '2026-10-27T20:00:00.000Z',
    answers: { sleepQuality: 4, mood: null, sleepProblem: [] }
  }],
  periodLabels: [{
    id: 'period-1', name: '虚构时期',
    startDate: '2026-10-01', endDate: '2026-10-27',
    kind: 'user_period',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z'
  }],
  deviceData: [{
    id: 'device_2026-10-27', recordDate: '2026-10-27',
    source: 'manual', sleepDurationMin: null, steps: 2400,
    heartRateAvg: null, weightKg: null,
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z'
  }]
}

async function rejects(task: () => Promise<unknown>, expected: RegExp) {
  await assert.rejects(task, expected)
}

const phrase = 'long-unique-test-phrase-strong-2026'
const first = await encryptBackup(snapshot, phrase)
const second = await encryptBackup(snapshot, phrase)
assert.equal(first.format, ENCRYPTED_BACKUP_FORMAT)
assert.equal(isEncryptedBackup(first), true)
assert.equal(isEncryptedBackup(snapshot), false)
assert.deepEqual(await decryptBackup(first, phrase), snapshot,
  'roundtrip preserves morning/evening phase, null, empty arrays, periods and device data')
assert.notEqual(first.iv, second.iv, 'fresh IV per export')
assert.notEqual(first.salt, second.salt, 'fresh salt per export')
assert.notEqual(first.ciphertext, second.ciphertext)
assert.equal(JSON.stringify(first).includes('sleepQuality'), false, 'plain field names not exposed')
assert.equal(JSON.stringify(first).includes('虚构时期'), false, 'user labels not exposed')
assert.equal(JSON.stringify(first).includes(phrase), false, 'passphrase not serialized')
assert.equal(Object.keys(first).includes('exportedAt'), false, 'export timestamp is encrypted')
assert.equal(JSON.stringify(snapshot.dailyRecords[0].answers),
  JSON.stringify({ sleepQuality: 4, mood: null, sleepProblem: [] }),
  'input remains unmodified')

await rejects(() => encryptBackup(snapshot, 'short'), /至少需要/)
assert.equal(MIN_BACKUP_PASSPHRASE_LENGTH, 12)
await rejects(() => decryptBackup(first, 'bad-secret-password'), /密码不正确/)
await rejects(() => decryptBackup({ ...first, ciphertext: first.ciphertext.slice(0, -4) + 'AAAA' }, phrase),
  /密码不正确|编码格式/)
await rejects(() => decryptBackup({ ...first, iv: second.iv }, phrase), /密码不正确/)
await rejects(() => decryptBackup({ ...first, iterations: 1 }, phrase), /不支持/)
await rejects(() => decryptBackup({ ...first, cipher: 'AES-CBC' }, phrase), /不支持/)
await rejects(() => decryptBackup({ ...first, version: 99 }, phrase), /不支持/)
await rejects(() => decryptBackup({ ...first, salt: '!!!' }, phrase), /编码格式/)
await rejects(() => decryptBackup(snapshot, phrase), /不是个人状态观察器的加密备份/)
console.log('[PASS] encrypted snapshot: full data roundtrip, fresh randomness, wrong password, tamper & version rejection')
