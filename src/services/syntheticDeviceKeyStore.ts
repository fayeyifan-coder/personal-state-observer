/**
 * Isolated synthetic-lab-only P-256 key persistence experiment.
 * No server registration, enrollment, cloud uploads or actual publisher grants.
 *
 * DO NOT import this from the normal GitHub Pages app. It refuses to operate
 * except in the synthetic Vite build on localhost / the specific Netlify lab.
 */
const DB_NAME = 'personal-state-observer-synthetic-device-key-v1'
const STORE_NAME = 'keys'
const RECORD_KEY = 'local-signing-key'
const PURPOSE = 'pso:synthetic-device-local-self-test:v1'

type LocalFixtureKey = {
  slot: typeof RECORD_KEY
  deviceId: string
  createdAt: string
  privateKey: CryptoKey
  publicJwk: JsonWebKey
}

export type LocalTestKeyDetails = {
  deviceId: string
  createdAt: string
  fingerprint: string
  locallyVerified: boolean
}

// Diagnostic stages contain no private key bytes, public coordinates or account IDs.
export type LocalKeyVerifyStage =
  | 'opening-database'
  | 'reading-key'
  | 'checking-metadata'
  | 'importing-public-key'
  | 'hashing-fingerprint'
  | 'signing-challenge'
  | 'verifying-signature'


function assertSyntheticLab(): void {
  const hostname = location.hostname
  const allowedHost = hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === 'cheerful-licorice-f4602a.netlify.app' ||
    hostname.endsWith('--cheerful-licorice-f4602a.netlify.app')
  if (import.meta.env.VITE_ISOLATED_LAB !== '1' || !allowedHost ||
    !(location.protocol === 'https:' ||
      (location.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')))) {
    throw new Error('仅允许在独立虚构测试站生成本机测试密钥。')
  }
  if (!crypto?.subtle || !indexedDB) {
    throw new Error('当前浏览器无法使用安全密钥存储。')
  }
}

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'slot' })
      }
    }
    request.onerror = () => reject(request.error ?? Error('本机密钥数据库无法打开。'))
    request.onblocked = () => reject(Error('另一个页面占用本机密钥数据库，请关闭其他测试标签页。'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function readStoredKey(database: IDBDatabase): Promise<LocalFixtureKey | null> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(RECORD_KEY)
    request.onerror = () => reject(request.error ?? Error('本机密钥读取失败。'))
    request.onsuccess = () => resolve((request.result as LocalFixtureKey | undefined) ?? null)
    tx.onerror = () => reject(tx.error ?? Error('本机密钥读取事务失败。'))
  })
}

async function saveIfAbsent(database: IDBDatabase, record: LocalFixtureKey): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite')
    // IDB add (not put) forbids silent replacement or key rotation.
    tx.objectStore(STORE_NAME).add(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(Error('本机测试密钥已有记录，或无法安全保存；不会覆盖旧密钥。'))
    tx.onabort = () => reject(Error('测试密钥写入被取消；旧密钥不会被覆盖。'))
  })
}

function validKey(record: LocalFixtureKey): void {
  if (record.slot !== RECORD_KEY || !/^[\da-f-]{36}$/i.test(record.deviceId) ||
    typeof record.createdAt !== 'string' ||
    record.privateKey?.type !== 'private' ||
    record.privateKey.extractable !== false ||
    record.privateKey.algorithm?.name !== 'ECDSA' ||
    !record.privateKey.usages.includes('sign') ||
    record.publicJwk?.kty !== 'EC' || record.publicJwk.crv !== 'P-256' ||
    typeof record.publicJwk.x !== 'string' || typeof record.publicJwk.y !== 'string' ||
    record.publicJwk.d !== undefined) {
    throw new Error('已有测试密钥格式异常；请勿直接替换或清空。')
  }
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Return only non-secret metadata, never raw CryptoKey / public-key coordinates. */
async function details(
  record: LocalFixtureKey, verify: boolean,
  onStage?: (stage: LocalKeyVerifyStage) => void
): Promise<LocalTestKeyDetails> {
  onStage?.('checking-metadata')
  validKey(record)
  onStage?.('importing-public-key')
  const publicKey = await crypto.subtle.importKey(
    'jwk', record.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  )
  const fingerprintText = JSON.stringify({
    kty: 'EC', crv: 'P-256',
    x: record.publicJwk.x, y: record.publicJwk.y
  })
  onStage?.('hashing-fingerprint')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintText))
  let verified = false
  if (verify) {
    const nonce = crypto.getRandomValues(new Uint8Array(32))
    const signed = new Uint8Array(new TextEncoder().encode(PURPOSE).length + nonce.length)
    signed.set(new TextEncoder().encode(PURPOSE))
    signed.set(nonce, signed.length - nonce.length)
    onStage?.('signing-challenge')
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, signed
    )
    onStage?.('verifying-signature')
    verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, signed
    )
    if (!verified) throw Error('密钥签名校验失败；此设备不能进行配对。')
  }
  return {
    deviceId: record.deviceId,
    createdAt: record.createdAt,
    fingerprint: toHex(digest).slice(0, 16),
    locallyVerified: verified
  }
}

export async function readLocalTestPhoneKey(): Promise<LocalTestKeyDetails | null> {
  assertSyntheticLab()
  const db = await openKeyStore()
  try {
    const record = await readStoredKey(db)
    return record ? details(record, false) : null
  } finally {
    db.close()
  }
}

export async function createLocalTestPhoneKey(): Promise<LocalTestKeyDetails> {
  assertSyntheticLab()
  const db = await openKeyStore()
  try {
    if (await readStoredKey(db)) {
      throw Error('此浏览器已经保存测试密钥；不会自动重新生成或替换。')
    }
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
    )
    if (pair.privateKey.extractable) {
      throw Error('浏览器生成了可导出私钥，已拒绝保存。')
    }
    const record: LocalFixtureKey = {
      slot: RECORD_KEY,
      deviceId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      privateKey: pair.privateKey,
      publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey)
    }
    await saveIfAbsent(db, record)
    return details(record, true)
  } finally {
    db.close()
  }
}

/** Proves possession locally; doesn't transmit a signature to any server. */
export async function verifyLocalTestPhoneKey(
  onStage?: (stage: LocalKeyVerifyStage) => void
): Promise<LocalTestKeyDetails> {
  assertSyntheticLab()
  onStage?.('opening-database')
  const db = await openKeyStore()
  try {
    onStage?.('reading-key')
    const record = await readStoredKey(db)
    if (!record) throw Error('此浏览器尚未生成测试密钥。')
    return details(record, true, onStage)
  } finally {
    db.close()
  }
}

/**
 * Only after the user explicitly confirms: deletes this unpaired synthetic
 * key. Does not revoke any *server* credential (there is none in this phase).
 */
export async function discardUnpairedLocalTestPhoneKey(): Promise<void> {
  assertSyntheticLab()
  const db = await openKeyStore()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(Error('无法删除本地测试密钥。'))
      tx.onabort = () => reject(Error('删除测试密钥的事务已取消。'))
    })
  } finally {
    db.close()
  }
}
