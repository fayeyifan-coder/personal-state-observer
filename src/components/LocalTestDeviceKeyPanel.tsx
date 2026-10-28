import { useEffect, useState } from 'react'
import {
  createLocalTestPhoneKey,
  discardUnpairedLocalTestPhoneKey,
  readLocalTestPhoneKey,
  verifyLocalTestPhoneKey,
  type LocalTestKeyDetails
} from '../services/syntheticDeviceKeyStore'

/**
 * Synthetic-only local browser key experiment. Generating a key is NOT
 * enrollment, pairing, or permission to upload snapshots.
 */
export function LocalTestDeviceKeyPanel() {
  const [key, setKey] = useState<LocalTestKeyDetails | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('正在查看此浏览器是否保存了测试设备密钥……')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    void readLocalTestPhoneKey()
      .then(found => {
        if (!active) return
        setKey(found)
        setMessage(found
          ? '已找到此前生成的本机测试密钥；尚未进行签名校验。'
          : '此浏览器尚未生成测试设备密钥。')
      })
      .catch(error => {
        if (active) setMessage(error instanceof Error ? error.message : '密钥存储不可用。')
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => { active = false }
  }, [])

  async function generate() {
    if (busy || !ready || key) return
    setBusy(true)
    try {
      const created = await createLocalTestPhoneKey()
      setKey(created)
      setMessage('已保存不可导出的本地私钥，且完成一次本机签名验证。尚未与服务器配对。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法生成测试设备密钥。')
      const existing = await readLocalTestPhoneKey().catch(() => null)
      if (existing) setKey(existing)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    if (!key || busy) return
    setBusy(true)
    try {
      const result = await verifyLocalTestPhoneKey()
      if (result.deviceId !== key.deviceId || result.fingerprint !== key.fingerprint) {
        throw Error('密钥身份与原记录不一致，已停止。')
      }
      setKey(result)
      setMessage('本机签名验证通过：刷新后仍能使用原有密钥。服务器尚未配对。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '本机签名校验失败。')
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!key || busy) return
    if (!window.confirm('只删除当前浏览器中尚未配对的虚构测试密钥。该操作不可撤销，未来真实设备的撤销不能用这种方法替代。确定删除吗？')) return
    setBusy(true)
    try {
      await discardUnpairedLocalTestPhoneKey()
      setKey(null)
      setMessage('仅清除了当前浏览器的未配对测试密钥，原有虚构记录未改变。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '测试密钥清除失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section role="region" aria-label="设备密钥本机测试"
      style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #bfa66d' }}>
      <strong>设备密钥 · 本机测试（未配对）</strong>
      <p>仅在此浏览器生成并保存测试私钥，服务器不会收到私钥、公钥或记录。生成密钥不代表获得手机发布权限，也不会启动同步。</p>
      {key && <p data-testid="fixture-key-identity">
        设备编号：<code>{key.deviceId}</code>
        {'　'}公钥指纹：<code>{key.fingerprint}</code>
        <span style={{ display: 'block', marginTop: 6 }}>
          状态：{key.locallyVerified ? '本机签名已验证' : '已保存，等待签名校验'} · 服务器尚未配对
        </span>
      </p>}
      <div className="isolated-lab-actions">
        {!key && <button type="button" onClick={() => void generate()}
          disabled={!ready || busy}>生成此浏览器测试密钥</button>}
        {key && <button type="button" onClick={() => void verify()} disabled={busy}>
          验证本机签名（不联网）
        </button>}
        {key && <button type="button" onClick={() => void discard()} disabled={busy}>
          清除未配对测试密钥
        </button>}
      </div>
      <p role="status">{message}</p>
      <p>注意：清除 Safari 网站数据可能导致测试私钥丢失。正式设备配对与服务器撤销将在后续独立开发。</p>
    </section>
  )
}
