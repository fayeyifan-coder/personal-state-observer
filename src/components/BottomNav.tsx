import type { ReactNode } from 'react'

type Item = { href: string; label: string; icon: ReactNode }
const items: Item[] = [
  { href: '/', label: '今天', icon: '○' },
  { href: '/timeline', label: '时间轴', icon: '／' },
  { href: '/data', label: '数据', icon: '□' }
]

export function BottomNav({ current }: { current: string }) {
  return <nav className="bottom-nav" aria-label="主要导航">
    {items.map(item => <a key={item.href} className={current === item.href ? 'active' : ''} href={item.href}>
      <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
    </a>)}
  </nav>
}
