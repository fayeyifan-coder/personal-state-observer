const BARK_KEY_STORAGE = 'bark_key';

export function getBarkKey(): string | null {
  return localStorage.getItem(BARK_KEY_STORAGE);
}

export function saveBarkKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error('Bark Key 不能为空');
  }
  localStorage.setItem(BARK_KEY_STORAGE, trimmed);
}

export function clearBarkKey(): void {
  localStorage.removeItem(BARK_KEY_STORAGE);
}

export async function sendBarkNotification(title: string, body: string): Promise<void> {
  const key = getBarkKey();
  if (!key) {
    throw new Error('未配置 Bark Key');
  }

  const url = `https://api.day.app/${key}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bark API 请求失败: ${response.status} ${response.statusText}`);
  }
}