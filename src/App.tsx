import { RecordPage } from './pages/RecordPage'
import { TodayPage } from './pages/TodayPage'
import { TimelinePage } from './pages/TimelinePage'
import { DataPage } from './pages/DataPage'

export function App() {
  const path = window.location.pathname
  if (path.startsWith('/record')) return <RecordPage />
  if (path.startsWith('/timeline')) return <TimelinePage />
  if (path.startsWith('/data')) return <DataPage />
  return <TodayPage />
}
