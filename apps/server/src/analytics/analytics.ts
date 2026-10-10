import { createHmac } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from '../log';
import { supabaseInsert } from '../supabase';

/**
 * Game analytics: a handful of events that tell us whether people actually play.
 *
 * Privacy by design: no names, no IP addresses, no cookies, nothing anyone typed. A player
 * appears only as a pseudonym, an HMAC of their random browser token keyed with a server-only
 * secret, so the database can count returning players but nobody can link a row to a person.
 */
export type AnalyticsEventName =
  'room_created' | 'player_joined' | 'game_started' | 'room_ended' | 'feedback_sent';

export interface AnalyticsRow {
  at: string;
  name: AnalyticsEventName;
  room: string | null;
  player: string | null;
  props: Record<string, string | number | boolean>;
}

export interface Analytics {
  readonly name: string;
  track(
    name: AnalyticsEventName,
    fields?: { room?: string; player?: string; props?: AnalyticsRow['props'] },
  ): void;
  /** Send everything buffered. Called on a timer and before shutdown. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** Stable, non-reversible id for a browser token. Same token + same secret = same pseudonym. */
export function pseudonym(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex').slice(0, 16);
}

/** Where batches of rows end up. */
export type Sink = (rows: AnalyticsRow[]) => Promise<void>;

export const supabaseSink =
  (url: string, key: string): Sink =>
  (rows) =>
    supabaseInsert(url, key, 'analytics_events', rows);

export const fileSink =
  (path: string): Sink =>
  async (rows) => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };

const MAX_BUFFER = 2000;

/**
 * Collects events in memory and writes them in batches: one database request every
 * `intervalMs` (or once `batchSize` events pile up) instead of one per event. track() never
 * waits and never throws, so a slow or broken database can't slow down a game. If a write fails
 * the rows are kept for the next try, up to a cap, after which the oldest are dropped.
 */
export class BufferedAnalytics implements Analytics {
  private buffer: AnalyticsRow[] = [];
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    readonly name: string,
    private sink: Sink,
    private opts: { intervalMs?: number; batchSize?: number; now?: () => number } = {},
  ) {
    this.timer = setInterval(() => void this.flush(), opts.intervalMs ?? 15_000);
    this.timer.unref();
  }

  track(
    name: AnalyticsEventName,
    fields: { room?: string; player?: string; props?: AnalyticsRow['props'] } = {},
  ) {
    const at = new Date(this.opts.now?.() ?? Date.now()).toISOString();
    this.buffer.push({
      at,
      name,
      room: fields.room ?? null,
      player: fields.player ?? null,
      props: fields.props ?? {},
    });
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    if (this.buffer.length >= (this.opts.batchSize ?? 50)) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    this.flushing = this.sink(batch)
      .catch((err: unknown) => {
        log.warn('analytics write failed; will retry', {
          store: this.name,
          rows: batch.length,
          err: String(err),
        });
        this.buffer = [...batch, ...this.buffer].slice(-MAX_BUFFER);
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }
}

/** For tests and anywhere analytics should be switched off. */
export const noAnalytics: Analytics = {
  name: 'off',
  track: () => {},
  flush: async () => {},
  close: async () => {},
};
