import { useState } from 'react'

type CheckState = 'unchecked' | 'checking' | 'verified' |
  'not-verified' | 'not-deployed' | 'failed'

/**
 * Explicit, read-only check. Never transmits personal observations,
 * local backups, passwords, phone keys or IndexedDB content.
 */
export function LabLoginDiagnostic() {
  const [check, setCheck] = useState<CheckState>('unchecked')

  async function checkLogin() {
    if (check === 'checking') return
    setCheck('checking')
    try {
      const response = await fetch('/api/lab-login-status', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error'
      })
      const type = response.headers.get('content-type') || ''
      // A static host's SPA fallback may answer 200 with index.html when
      // the Netlify Function is not deployed. Never interpret that as login.
      if (response.status === 404 ||
          !type.toLowerCase().includes('application/json')) {
        setCheck('not-deployed')
        return
      }
      if (response.status === 401 || response.status === 403) {
        setCheck('not-verified')
        return
      }
      if (!response.ok) {
        setCheck('failed')
        return
      }
      const data: unknown = await response.json()
      if (data && typeof data === 'object' &&
        'authenticated' in data && data.authenticated === true &&
        'status' in data && data.status === 'verified-private-login' &&
        'permission' in data && data.permission === 'read-only' &&
        'cloudSync' in data && data.cloudSync === 'not-configured') {
        setCheck('verified')
      } else {
        setCheck('not-verified')
      }
    } catch {
      setCheck('failed')
    }
  }

  const messages: Record<CheckState, string> = {
    unchecked: '尚未检查。测试不会读取本机记录或连接数据库。',
    checking: '正在询问 Netlify 是否确认当前登录……',
    verified: '已验证 Netlify 私有站点登录。仅有只读身份确认；云端同步未开启。',
    'not-verified': '未能确认 Netlify 登录，请检查是否通过私有站点登录。',
    'not-deployed': '只读诊断接口尚未部署，不能判断是否已登录。',
    failed: '诊断请求未完成，可能是网络、访问保护或服务暂不可用。'
  }

  return (
    <section role="region" aria-label="只读登录诊断"
      style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #bfa66d' }}>
      <strong>Netlify 登录诊断 · 只读</strong>
      <p>仅确认当前浏览器的 Netlify 登录是否经过验证；不显示账号 ID、邮箱，不上传虚构记录，也不启用云同步。</p>
      <div className="isolated-lab-actions">
        <button type="button" onClick={() => void checkLogin()}
          disabled={check === 'checking'}>
          {check === 'checking' ? '检查中……' : '检查 Netlify 登录（只读）'}
        </button>
      </div>
      <p role="status" aria-live="polite">{messages[check]}</p>
    </section>
  )
}
