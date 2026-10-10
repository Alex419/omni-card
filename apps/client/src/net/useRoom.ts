import { useEffect, useState, useSyncExternalStore } from 'react';
import { RoomClient } from './RoomClient';

/** Connect to a table for as long as the component is mounted. */
export function useRoom(code: string, name: string, token: string) {
  const [client] = useState(() => new RoomClient(code, name, token));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  const snap = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return { client, ...snap };
}
