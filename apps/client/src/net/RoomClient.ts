import type { ClientMessage, GameEvent, Intent, ServerMessage, TableView } from '@omni/shared';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'failed';

export interface RoomSnapshot {
  status: ConnStatus;
  view: TableView | null;
  /** Fatal problem (unknown room, table full). */
  error: string | null;
}

type Listener = () => void;
type EventListener = (events: GameEvent[], view: TableView) => void;

/**
 * Owns the WebSocket for one table, outside React. It reconnects with backoff, re-sends
 * `hello` with the same token (which restores your seat), and tracks intents until the server
 * acknowledges them. React reads it through useSyncExternalStore (see useRoom.ts), which is the
 * standard way to subscribe components to state that lives outside React.
 */
export class RoomClient {
  private ws: WebSocket | null = null;
  private snap: RoomSnapshot = { status: 'connecting', view: null, error: null };
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private pending = new Map<number, { resolve: (err: string | null) => void }>();
  private nextId = 1;
  private attempts = 0;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly room: string,
    private name: string,
    private token: string,
    private url = defaultUrl(),
  ) {}

  start() {
    this.closed = false;
    this.open();
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  getSnapshot = () => this.snap;
  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  onEvents(fn: EventListener) {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  /** Send an intent. Resolves with null once the server applied it, or with its error message. */
  send(intent: Intent): Promise<string | null> {
    const id = this.nextId++;
    if (!this.raw({ t: 'intent', id, intent })) return Promise.resolve('NOT CONNECTED');
    return new Promise((resolve) => this.pending.set(id, { resolve }));
  }

  sit(seat: number) {
    this.raw({ t: 'sit', seat });
  }
  stand() {
    this.raw({ t: 'stand' });
  }

  private raw(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private set(patch: Partial<RoomSnapshot>) {
    // A new object each time: useSyncExternalStore re-renders when the reference changes.
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  private open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.raw({ t: 'hello', room: this.room, name: this.name, token: this.token });
      clearInterval(this.pingTimer);
      // Keeps proxies from closing an idle connection.
      this.pingTimer = setInterval(() => this.raw({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.handle(JSON.parse(String(e.data)) as ServerMessage);
    };
    ws.onclose = () => {
      // Ignore sockets we've already replaced (e.g. React StrictMode's mount/unmount/mount in dev).
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      for (const p of this.pending.values()) p.resolve('CONNECTION LOST');
      this.pending.clear();
      if (this.closed || this.snap.status === 'failed') return;
      // Exponential backoff with jitter: 0.5s, 1s, 2s ... capped at 8s.
      const delay = Math.min(8000, 500 * 2 ** this.attempts++) * (0.75 + Math.random() * 0.5);
      this.set({ status: 'reconnecting' });
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private handle(msg: ServerMessage) {
    switch (msg.t) {
      case 'view':
        this.set({ status: 'open', view: msg.view });
        if (msg.events.length) this.eventListeners.forEach((l) => l(msg.events, msg.view));
        break;
      case 'ack': {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve(msg.ok ? null : msg.error);
        break;
      }
      case 'error':
        if (msg.code === 'room-not-found' || msg.code === 'room-full') {
          this.set({ status: 'failed', error: msg.message });
          this.ws?.close();
        } else
          this.eventListeners.forEach((l) =>
            l([{ type: 'notice', text: msg.message, sfx: 'err' }], this.snap.view!),
          );
        break;
      case 'welcome':
      case 'pong':
        break;
    }
  }
}

function defaultUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
