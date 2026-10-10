import { useEffect, useState } from 'react';
import { Lobby } from './ui/Lobby';
import { TableScreen } from './ui/TableScreen';

/**
 * Two screens, so a router library would be overkill: "/" is the lobby and "/r/CODE" is a table.
 * navigate() uses the History API so links are shareable and the back button works.
 */
const roomFromPath = (path: string) => /^\/r\/([A-Za-z0-9]{4,8})\/?$/.exec(path)?.[1]?.toUpperCase() ?? null;

export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const code = roomFromPath(path);
  return code ? <TableScreen key={code} code={code} /> : <Lobby />;
}
