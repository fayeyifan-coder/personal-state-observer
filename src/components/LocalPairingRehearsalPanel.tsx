import { useState } from 'react'
import {
  proveSyntheticPairing,
  startSyntheticPairing,
  type SyntheticPendingCandidate
} from '../services/syntheticPairingContract'

type RehearsalState = 'empty' | 'pending' | 'proved'

/**
 * A zero-network wire-format rehearsal, not a pairing UI.
 * A successful proof never registers a publisher or changes server state.
 */
export function LocalPairingRehearsalPanel() {
  const [candidate, setCandidate] = useState<SyntheticPendingCandidate | null>(null)
  const [phase, setPhase] = useState<RehearsalState>('empty')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(
    '尚未生成模拟申请。请先保留并验证上方已经存在的本机测试密钥。'
  )

  async function makeCandidate() {
    if (busy) return
    setBusy(true)
    setCandidate(null)
    setPhase('empty')
    setMessage('正在读取已有公钥并生成本地模拟挑战……')
    try {
      const pending = await startSyntheticPairing()
      setCandidate(pending)
      setPhase('pending')
      setMessage('模拟申请已生成。服务器并未收到申请；请核对公钥指纹，再手动测试持有证明。')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '无法生成模拟申请。')
    } finally {
      setBusy(false)
    }
  }

  async function prove() {
    if (busy || !candidate || phase !== 'pending') return
    setBusy(true)
    setMessage('已收到点击，正在读取原私钥并本机验签……')
    let timeout: number | undefined
    try {
      const overdue = new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(Error('Safari 本机签名未及时完成，原测试密钥未删除。')), 20000
        )
      })
      const result = await Promise.race([
        proveSyntheticPairing(candidate), overdue
      ])
      if (!result.passed || result.fingerprint !== candidate.fingerprint) {
        throw Error('公钥指纹不一致，停止演练。')
      }
      setPhase('proved')
      setMessage('本机持有证明通过。但没有服务器申请、没有人工审核，设备仍未配对，无法上传。')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '本机持有证明失败。')
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout)
      setBusy(false)
    }
  }

  return (
    <section role="region" aria-label="本地配对演练"
      style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #bfa66d' }}>
      <strong>配对协议 · 本地演练（不联网）</strong>
      <p>使用上方的原有测试私钥，演练「公钥申请 → 一次性挑战 → 私钥签名证明」。
        本轮没有服务器登记与设备审核，也不会产生真实的上传权限。</p>
      {candidate && (
        <div data-testid="synthetic-pairing-candidate">
          <p>候选状态：{phase === 'proved'
            ? '本机持有证明通过（未配对）'
            : '待本机证明（未配对）'}</p>
          <p>完整公钥指纹（仅用于人工核对的演练数据）：
            <code style={{ overflowWrap: 'anywhere' }}>{candidate.fingerprint}</code>
          </p>
          <p>模拟挑战有效期截止：{new Date(candidate.expiresAt).toLocaleTimeString()}</p>
        </div>
      )}
      <div className="isolated-lab-actions">
        <button type="button" disabled={busy}
          onClick={() => void makeCandidate()}>
          {busy ? '本机处理中……' : '生成本地模拟配对申请'}
        </button>
        {candidate && phase === 'pending' &&
          <button type="button" disabled={busy} onClick={() => void prove()}>
            {busy ? '本机处理中……' : '使用原密钥证明持有（不联网）'}
          </button>}
      </div>
      <p role="status" aria-live="polite" data-testid="synthetic-pairing-status">{message}</p>
      <p>刷新页面只会丢弃此次模拟申请；不会清除浏览器中保存的测试私钥。
        电脑同样能执行本地演练，但绝不能因此获得服务器发布权。</p>
    </section>
  )
}
