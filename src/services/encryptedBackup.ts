import type { AppBackup } from '../types'

export const ENCRYPTED_BACKUP_FORMAT = 'personal-state-observer-encrypted-backup' as const
export const ENCRYPTED_BACKUP_VERSION = 1 as const
export const KDF_ITERATIONS = 600_000 as const
export const MIN_BACKUP_PASSPHRASE_LENGTH = 12
export const MAX_BACKUP_PLAINTEXT_BYTES = 20 * 1024 * 1024
export const MAX_ENCRYPTED_BACKUP_FILE_BYTES = 35 * 1024 * 1024

const AAD = new TextEncoder().encode('personal-state-observer:encrypted-backup:v1')
const encoder = new TextEncoder()

export type EncryptedBackupV1 = {
  format: typeof ENCRYPTED_BACKUP_FORMAT
  version: typeof ENCRYPTED_BACKUP_VERSION
  cipher: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA-256'
  iterations: typeof KDF_ITERATIONS
  salt: string
  iv: string
  ciphertext: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(text: string, exactLength?: number): Uint8Array<ArrayBuffer> {
  if (text.length === 0 || text.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('加密备份的编码格式不正确。')
  }
  const binary = atob(text)
  if (exactLength !== undefined && binary.length !== exactLength) {
    throw new Error('加密备份的随机参数长度不正确。')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: KDF_ITERATIONS },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encryption happens locally in the browser. No passphrase or plaintext is
 * persisted by this module, sent over the network, or included in metadata.
 * This is a transportable encrypted FILE, not cloud synchronization.
 */
export async function encryptBackup(
  snapshot: AppBackup,
  passphrase: string
): Promise<EncryptedBackupV1> {
  if (passphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
    throw new Error('加密密码至少需要 12 个字符。建议使用更长、唯一的密码短语。')
  }
  const plaintext = encoder.encode(JSON.stringify(snapshot))
  if (plaintext.length > MAX_BACKUP_PLAINTEXT_BYTES) {
    throw new Error('备份过大，超过加密文件的安全处理上限。')
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 },
    key,
    plaintext
  ))
  return {
    format: ENCRYPTED_BACKUP_FORMAT, version: ENCRYPTED_BACKUP_VERSION,
    cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  }
}

export function isEncryptedBackup(value: unknown): boolean {
  return value !== null && typeof value === 'object' &&
    (value as { format?: unknown }).format === ENCRYPTED_BACKUP_FORMAT
}

function validateEncryptedBackup(value: unknown): EncryptedBackupV1 {
  if (!isEncryptedBackup(value)) throw new Error('这不是个人状态观察器的加密备份。')
  const data = value as Partial<EncryptedBackupV1>
  if (data.version !== 1 || data.cipher !== 'AES-256-GCM' ||
    data.kdf !== 'PBKDF2-SHA-256' || data.iterations !== KDF_ITERATIONS ||
    typeof data.salt !== 'string' || typeof data.iv !== 'string' ||
    typeof data.ciphertext !== 'string') {
    throw new Error('不支持此加密备份版本或加密参数。')
  }
  // Check allocations and KDF costs BEFORE attempting to decrypt.
  if (data.ciphertext.length > MAX_ENCRYPTED_BACKUP_FILE_BYTES ||
    data.ciphertext.length < 24) {
    throw new Error('加密备份内容长度异常。')
  }
  if (data.salt.length !== 24 || data.iv.length !== 16) {
    throw new Error('加密备份的随机参数长度不正确。')
  }
  base64ToBytes(data.salt, 16)
  base64ToBytes(data.iv, 12)
  return data as EncryptedBackupV1
}

/** Caller must validate the decrypted value with parseBackup before any restore. */
export async function decryptBackup(value: unknown, passphrase: string): Promise<unknown> {
  const envelope = validateEncryptedBackup(value)
  if (!passphrase) throw new Error('请输入加密备份密码。')
  const salt = base64ToBytes(envelope.salt, 16)
  const iv = base64ToBytes(envelope.iv, 12)
  const ciphertext = base64ToBytes(envelope.ciphertext)
  const key = await deriveKey(passphrase, salt)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 },
      key, ciphertext
    )
  } catch {
    throw new Error('密码不正确，或加密备份已经损坏。未修改任何本机记录。')
  }
  if (plaintext.byteLength > MAX_BACKUP_PLAINTEXT_BYTES) {
    throw new Error('解密后的数据超过允许大小。')
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
  } catch {
    throw new Error('解密文件不是有效的 JSON 备份。')
  }
}


/** Save the ciphertext only; the password never enters the file. */
export function downloadEncryptedBackup(snapshot: EncryptedBackupV1): void {
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'personal-state-observer-encrypted-' +
    new Date().toISOString().slice(0, 10) + '.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
