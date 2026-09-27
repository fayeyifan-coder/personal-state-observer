import { MigrationPreviewPage } from './pages/MigrationPreviewPage';
import { RecordPage } from './pages/RecordPage'
import { TodayPage } from './pages/TodayPage'
import { TimelinePage } from './pages/TimelinePage'
import { DataPage } from './pages/DataPage'
import { SettingsPage } from './pages/SettingsPage'

export function App() {
  const path = window.location.pathname
  if (path.startsWith('/migration-preview')) {
    return <MigrationPreviewPage />;
  }
  if (path.startsWith('/record')) return <RecordPage />
  if (path.startsWith('/timeline')) return <TimelinePage />
  if (path.startsWith('/data')) return <DataPage />
  if (path.startsWith('/settings')) return <SettingsPage />
  return <TodayPage />
}