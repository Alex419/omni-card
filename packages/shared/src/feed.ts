import type { Face } from './cards';
import type { GameEvent } from './events';

/**
 * The move feed: a running, public log of what happened at the table, plus chat.
 *
 * It's built by the server from the same public events that drive the toasts, so it can never say
 * more than the events do (and events never name a hidden card; see the redaction fuzz test).
 * It lives in the Room rather than in GameState so UNDO can't rewrite history: "ALEX UNDID ..."
 * is added to the feed instead.
 */
export interface FeedEntry {
  id: number;
  at: number;
  kind: 'move' | 'chat' | 'notice';
  /** Who did it, by name at the time. Null for room notices (joins, leaves). */
  by: string | null;
  /** Their seat at the time, for coloring the name. Null for notices and spectators. */
  seat: number | null;
  /** For moves, `%c` stands for `cards`. Chat text is exactly what was typed. */
  text: string;
  cards?: Face[];
}

export const FEED = {
  /** Entries a room keeps. */
  keep: 200,
  /** Entries a (re)joining player is sent. */
  send: 100,
  /** Longest chat message, in characters. */
  chatMax: 200,
} as const;

export type NewFeedEntry = Omit<FeedEntry, 'id' | 'at'>;

/** Feed lines for a batch of events. `nameOf` resolves a seat to the player sitting there now. */
export function feedFromEvents(events: GameEvent[], nameOf: (seat: number) => string): NewFeedEntry[] {
  const out: NewFeedEntry[] = [];
  for (const e of events) {
    if (e.type === 'log') {
      const text = e.feed ?? e.text;
      if (!text) continue;
      out.push({
        kind: 'move',
        by: nameOf(e.by),
        seat: e.by,
        text,
        ...(e.cards?.length ? { cards: e.cards } : {}),
      });
    } else if (e.type === 'notice') {
      out.push({ kind: 'notice', by: null, seat: null, text: e.text });
    }
  }
  return out;
}

/** Chat as typed, minus control characters and runs of whitespace. Empty means nothing to send. */
export const cleanChat = (raw: string) =>
  raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FEED.chatMax);
