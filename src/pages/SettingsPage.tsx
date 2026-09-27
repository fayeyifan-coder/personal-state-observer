import { useState, useEffect } from 'react';
import { getBarkKey, saveBarkKey, clearBarkKey, sendBarkNotification } from '../services/bark';
import { BottomNav } from '../components/BottomNav';

export function SettingsPage() {
  const [hasKey, setHasKey] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    setHasKey(!!getBarkKey());
  }, []);

  const handleSave = () => {
    try {
      saveBarkKey(inputKey);
      setHasKey(true);
      setInputKey(''); // 保存后清空，不明文展示
      setMessage('保存成功');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessage('');
    }
  };

  const handleClear = () => {
    clearBarkKey();
    setHasKey(false);
    setMessage('已清除');
    setError('');
  };

  const handleTest = async () => {
    setIsTesting(true);
    setMessage('测试中...');
    setError('');
    try {
      await sendBarkNotification('测试通知', '这是一条来自私人观察台的测试通知。');
      setMessage('测试通知已发送。');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessage('');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="page shell">
      <header className="brand mb-6">私人观察台</header>
      <section className="settings-section">
        <h1>设置</h1>
        
        <div className="settings-card">
          <h2>Bark 提醒</h2>
          <p className="settings-desc">用于接收每日状态记录提醒。</p>
          
          <div className="settings-status">
            <span>状态：</span>
            {hasKey ? (
              <span className="status-active">已配置</span>
            ) : (
              <span className="status-inactive">未配置</span>
            )}
          </div>

          <div className="settings-form">
            <input 
              type="text" 
              placeholder="输入 Bark Key" 
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              className="settings-input"
            />
            <div className="settings-actions">
              <button onClick={handleSave} className="primary">保存</button>
              <button onClick={handleTest} disabled={!hasKey || isTesting} className="quiet">测试通知</button>
              <button onClick={handleClear} disabled={!hasKey} className="quiet danger-text">清除 Key</button>
            </div>
          </div>
          
          {message && <p className="success-msg">{message}</p>}
          {error && <p className="error-msg">{error}</p>}
        </div>
      </section>
      <BottomNav current="/settings" />
    </div>
  );
}