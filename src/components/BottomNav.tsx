import type { ReactNode } from 'react'

type Item = { href: string; label: string; icon: ReactNode }

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

const CalendarIcon = () => (
  <svg {...iconProps}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
    <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
  </svg>
)

const TimelineIcon = () => (
  <svg {...iconProps}>
    <path d="M5 4v16M5 8h6M5 16h6" />
    <circle cx="15.5" cy="8" r="2" />
    <circle cx="15.5" cy="16" r="2" />
    <path d="M17.5 8H20M17.5 16H20" />
  </svg>
)

const DataIcon = () => (
  <svg {...iconProps}>
    <path d="M4 19.5h16" />
    <rect x="5" y="12" width="3" height="5.5" rx=".8" />
    <rect x="10.5" y="8.5" width="3" height="9" rx=".8" />
    <rect x="16" y="5" width="3" height="12.5" rx=".8" />
  </svg>
)

const SettingsIcon = () => (
  <svg {...iconProps}>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2" fill="var(--paper)" />
    <circle cx="15" cy="12" r="2" fill="var(--paper)" />
    <circle cx="11" cy="18" r="2" fill="var(--paper)" />
  </svg>
)

const items: Item[] = [
  { href: '#/', label: '今日', icon: <CalendarIcon /> },
  { href: '#/timeline', label: '时间线', icon: <TimelineIcon /> },
  { href: '#/data', label: '数据', icon: <DataIcon /> },
  { href: '#/settings', label: '设置', icon: <SettingsIcon /> },
]

export function BottomNav({ current }: { current: string }) {
  return (
    <nav className="bottom-nav" aria-label="主要导航">
      {items.map(item => {
        const isActive = current === item.href.replace('#', '')
        return (
          <a key={item.href} className={isActive ? 'active' : ''} href={item.href}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        )
      })}
    </nav>
  )
}
