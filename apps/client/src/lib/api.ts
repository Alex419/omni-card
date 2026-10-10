import type { Feedback } from '@omni/shared';

/** The small HTTP API. Live play goes over the WebSocket instead (net/RoomClient.ts). */

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const createRoom = () => post<{ code: string }>('/api/rooms');
export const sendFeedback = (f: Feedback) => post<{ ok: true }>('/api/feedback', f);
