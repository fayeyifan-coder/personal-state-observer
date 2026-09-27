import { useEffect, useState } from 'react';
import { MigrationPreviewPage } from './pages/MigrationPreviewPage';
import { RecordPage } from './pages/RecordPage';
import { TodayPage } from './pages/TodayPage';
import { TimelinePage } from './pages/TimelinePage';
import { DataPage } from './pages/DataPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  // 监听网页 hash 的变化
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // 去掉开头的 '#' 号，默认为 '/'
  const currentPath = hash.replace(/^#/, '') || '/';

  if (currentPath.startsWith('/migration-preview')) return <MigrationPreviewPage />;
  if (currentPath.startsWith('/record')) return <RecordPage />;
  if (currentPath.startsWith('/timeline')) return <TimelinePage />;
  if (currentPath.startsWith('/data')) return <DataPage />;
  if (currentPath.startsWith('/settings')) return <SettingsPage />;
  
  return <TodayPage />;
}