import { allCardIds } from './cards';
import { LIMITS, QUIPS, tableSizeFor } from './constants';
import type { GameEvent, Sfx } from './events';
import * as layout from './layout';
import type { Intent, Source, Target } from './protocol';
import { newTag, pick, randInt, shuffleInPlace, type Rng } from './rng';
import { freshDeck } from './setup';
import type { Card, GameState, HistoryEntry, Jitter, LooseCard, NoteSpot, TableState, Zone } from './state';
import { firstShown, looseVid, vidFor, zoneCardVisible } from './view';

/**
 * applyIntent(game, intent, ctx) -> new game + public events, or an error.
 *
 * Pure: it never mutates `game` and gets randomness and time from `ctx`. It works on a
 * structuredClone of the table, so old tables can be kept as undo snapshots for free.
 */

export interface Ctx {
  /** Seat of the player sending the intent. Spectators can't send intents. */
  seat: number;
  name: string;
  rng: Rng;
  now: number;
}

export type ApplyResult = { ok: true; game: GameState; events: GameEvent[] } | { ok: false; error: string };

/** Thrown inside handlers; caught by applyIntent and turned into { ok: false }. */
class Reject extends Error {}
// A function declaration (not an arrow) so TypeScript narrows types after `if (x) reject(...)`.
function reject(msg: string): never {
  throw new Reject(msg);
}

/** How the intent is recorded for undo. */
interface Outcome {
  /** What UNDO will say it takes back, e.g. "DEAL 5". null = not undoable (private or setup). */
  label: string | null;
  /** Consecutive steps with the same key from the same player merge into one undo step. */
  key?: string;
  clearHistory?: boolean;
}

export function applyIntent(game: GameState, intent: Intent, ctx: Ctx): ApplyResult {
  try {
    if (intent.type === 'undo') return undo(game, ctx);
    const table = structuredClone(game.table);
    const events: GameEvent[] = [];
    const out = run(table, intent, { ...ctx, game, events });
    return { ok: true, game: { ...game, table, history: record(game, out, ctx) }, events };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.message };
    throw e;
  }
}

function record(game: GameState, out: Outcome, ctx: Ctx): HistoryEntry[] {
  if (out.clearHistory) return [];
  if (out.label === null) return game.history;
  const top = game.history[game.history.length - 1];
  if (out.key && top && top.key === out.key && top.by === ctx.name && ctx.now - top.at < 4000) {
    // Keep the snapshot from before the first keystroke; just refresh the timer.
    return [...game.history.slice(0, -1), { ...top, at: ctx.now }];
  }
  // `game.table` is never mutated, so the old table itself is the snapshot.
  const entry: HistoryEntry = {
    label: out.label,
    by: ctx.name,
    key: out.key ?? null,
    at: ctx.now,
    table: game.table,
  };
  return [...game.history, entry].slice(-LIMITS.history);
}

function undo(game: GameState, ctx: Ctx): ApplyResult {
  const entry = game.history[game.history.length - 1];
  if (!entry) return { ok: false, error: 'NOTHING TO UNDO' };
  const table = structuredClone(entry.table);
  // Hand order is private and not undoable: keep each player's current arrangement.
  table.hands = table.hands.map((hand, s) => {
    const now = game.table.hands[s] ?? [];
    const pos = new Map(now.map((id, i) => [id, i]));
    return [...hand].sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity));
  });
  const whose = entry.by === ctx.name ? '' : `${entry.by}'S `;
  return {
    ok: true,
    game: { ...game, table, history: game.history.slice(0, -1) },
    events: [{ type: 'log', by: ctx.seat, text: `UNDID ${whose}${entry.label}`, sfx: 'flip' }],
  };
}

/* ---------- helpers ---------- */

interface RunCtx extends Ctx {
  game: GameState;
  events: GameEvent[];
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'S'}`;
const cleanText = (s: string, max: number) => s.toUpperCase().replace(/\s+/g, ' ').trim().slice(0, max);

function log(c: RunCtx, text: string, sfx: Sfx, zone?: string) {
  c.events.push(zone ? { type: 'log', by: c.seat, text, sfx, zone } : { type: 'log', by: c.seat, text, sfx });
}

function seatName(c: RunCtx, seat: number): string {
  return c.game.players.find((p) => p.seat === seat)?.name ?? `SEAT ${seat + 1}`;
}

// Clamps take the table's config; these wrappers keep the call sites short.
const clampLoose = (t: TableState, x: number, y: number) => layout.clampLoose(t.cfg, x, y);
const clampZone = (t: TableState, z: Zone, x: number, y: number) => layout.clampZone(t.cfg, z, x, y);
const clampTableNote = (t: TableState, x: number, y: number) => layout.clampTableNote(t.cfg, x, y);

function zoneById(t: TableState, id: string | undefined): Zone {
  return t.zones.find((z) => z.id === id) ?? reject('THAT ZONE IS GONE');
}

const deckZone = (t: TableState) => t.zones.find((z) => z.deck);

function checkSeat(t: TableState, seat: number) {
  if (seat >= t.cfg.seats) reject('NO SUCH SEAT');
}

const jitter = (rng: Rng, bx = 0, by = 0): Jitter => [
  Math.round(bx + randInt(rng, -10, 10)),
  Math.round(by + randInt(rng, -8, 8)),
  randInt(rng, -24, 24),
];

/**
 * Remove the cards a player referred to (by vid) from a source and return them.
 * vids resolve exactly the way viewFor produced them for this player, so a client can only
 * grab cards it was actually shown, and guessing a real id for a hidden card finds nothing.
 */
function take(t: TableState, c: RunCtx, from: Source, vids: string[]): Card[] {
  const want = new Set(vids);
  if (want.size !== vids.length) reject('DUPLICATE CARDS');
  let out: Card[];
  if (from.kind === 'hand') {
    const hand = t.hands[c.seat]!;
    const ids = hand.filter((id) => want.has(id));
    if (ids.length !== want.size) reject('THOSE CARDS ARE NOT IN YOUR HAND');
    t.hands[c.seat] = hand.filter((id) => !want.has(id));
    // Leaving a hand re-rolls the tag: nobody can tell which card of the hand this was.
    out = ids.map((id) => ({ id, up: true, tag: newTag(c.rng), j: null }));
  } else if (from.kind === 'loose') {
    const hit = t.loose.filter((l) => want.has(looseVid(l)));
    if (hit.length !== want.size) reject('THOSE CARDS MOVED');
    t.loose = t.loose.filter((l) => !hit.includes(l));
    out = hit.map((l) => ({ id: l.id, up: l.up, tag: l.tag, j: null }));
  } else {
    const z = zoneById(t, from.id);
    const idx = shownIndexes(z, want);
    if (idx.length !== want.size) reject('THOSE CARDS MOVED');
    out = idx.map((i) => z.cards[i]!);
    z.cards = z.cards.filter((_, i) => !idx.includes(i));
  }
  return out;
}

/** Indexes of zone cards whose vid (as shown to clients) is in `want`. */
function shownIndexes(z: Zone, want: Set<string>): number[] {
  const out: number[] = [];
  for (let i = firstShown(z); i < z.cards.length; i++) {
    if (want.has(vidFor(z.cards[i]!, zoneCardVisible(z, i)))) out.push(i);
  }
  return out;
}

function intoZone(t: TableState, c: RunCtx, z: Zone, cards: Card[], tossX: number, tossY: number) {
  const bx = clamp((tossX - z.x) * 0.4, -24, 24);
  const by = clamp((tossY - z.y) * 0.4, -18, 18);
  const messy = z.layout === 'stack' && z.mess;
  // Several cards played at once onto a messy pile land as one fanned group, so all stay readable.
  const group = messy && cards.length > 1;
  const base = jitter(c.rng, bx, by);
  const tilt = randInt(c.rng, -6, 6);
  cards.forEach((card, i) => {
    z.cards.push({
      id: card.id,
      up: z.face === 'up',
      tag: card.tag,
      j: !messy ? null : group ? [base[0], base[1], tilt] : jitter(c.rng, bx, by),
      fan: group ? [i, cards.length] : null,
    });
  });
}

function onTable(t: TableState, c: RunCtx, cards: Card[], x: number, y: number, up: boolean | undefined) {
  const n = cards.length;
  cards.forEach((card, i) => {
    const [lx, ly] = clampLoose(t, x + (i - (n - 1) / 2) * 26, y);
    t.loose.push({
      id: card.id,
      up: up ?? card.up,
      tag: card.tag,
      j: null,
      x: lx,
      y: ly,
      r: randInt(c.rng, -6, 6),
    });
  });
}

/** Everything back into one shuffled deck. Used by COLLECT and by changing decks. */
function gatherAll(t: TableState, c: RunCtx): Zone {
  let z = deckZone(t);
  if (!z) {
    z = {
      id: `z${t.nextId++}`,
      name: 'DECK',
      x: t.cfg.tw / 2,
      y: t.cfg.th / 2,
      face: 'down',
      layout: 'stack',
      deck: true,
      mess: false,
      w: 330,
      cards: [],
    };
    t.zones.push(z);
  }
  for (const o of t.zones) o.cards = [];
  t.hands = t.hands.map(() => []);
  t.loose = [];
  z.cards = freshDeck(t.cfg, c.rng);
  return z;
}

function resize(t: TableState, nw: number, nh: number) {
  const { cfg, dx, dy } = layout.resizedConfig(t.cfg, nw, nh);
  t.cfg = cfg;
  for (const z of t.zones) [z.x, z.y] = clampZone(t, z, z.x + dx, z.y + dy);
  for (const l of t.loose) [l.x, l.y] = clampLoose(t, l.x + dx, l.y + dy);
  for (const n of t.notes)
    if (n.at.kind === 'table') [n.at.x, n.at.y] = clampTableNote(t, n.at.x + dx, n.at.y + dy);
}

function placeNote(t: TableState, c: RunCtx, at: NoteSpot): NoteSpot {
  if (at.kind === 'table') {
    const [x, y] = clampTableNote(t, at.x, at.y);
    return { kind: 'table', x, y };
  }
  checkSeat(t, at.seat);
  if (!c.game.players.some((p) => p.seat === at.seat)) reject('NOBODY IS SITTING THERE');
  return { kind: 'seat', seat: at.seat, x: clamp(at.x, 0.16, 0.84), y: clamp(at.y, 0.14, 0.7) };
}

/** Keep at most a handful of notes on each person; the oldest falls off. */
function trimNotes(t: TableState) {
  const tableNotes = t.notes.filter((n) => n.at.kind === 'table');
  if (tableNotes.length > LIMITS.tableNotes) t.notes = t.notes.filter((n) => n !== tableNotes[0]);
  for (let s = 0; s < t.cfg.seats; s++) {
    const on = t.notes.filter((n) => n.at.kind === 'seat' && n.at.seat === s);
    if (on.length > LIMITS.notesPerSeat) t.notes = t.notes.filter((n) => n !== on[0]);
  }
}

function noteStuck(c: RunCtx, at: NoteSpot) {
  if (at.kind !== 'seat') {
    log(c, '', 'stick');
    return;
  }
  if (at.seat !== c.seat)
    c.events.push({ type: 'noteStuck', by: c.seat, on: at.seat, quip: pick(c.rng, QUIPS) });
  log(
    c,
    at.seat === c.seat ? 'STUCK A NOTE ON THEMSELF' : `STUCK A NOTE ON ${seatName(c, at.seat)}`,
    'stick',
  );
}

function targetLabel(to: Target, n: number): string {
  if (to.kind === 'seat') return `GIVE ${plural(n, 'CARD')}`;
  if (to.kind === 'hand') return `TAKE ${plural(n, 'CARD')}`;
  return `MOVE ${plural(n, 'CARD')}`;
}

/* ---------- intent handlers ---------- */

function run(t: TableState, intent: Exclude<Intent, { type: 'undo' }>, c: RunCtx): Outcome {
  switch (intent.type) {
    case 'moveCards': {
      const { from, to, vids } = intent;
      // Reorder within your own hand: private, so not undoable and no event.
      if (from.kind === 'hand' && to.kind === 'hand') {
        const hand = t.hands[c.seat]!;
        const moving = vids.filter((v) => hand.includes(v));
        if (moving.length !== vids.length) reject('THOSE CARDS ARE NOT IN YOUR HAND');
        const rest = hand.filter((id) => !moving.includes(id));
        rest.splice(clamp(to.index ?? rest.length, 0, rest.length), 0, ...moving);
        t.hands[c.seat] = rest;
        return { label: null };
      }
      if (to.kind === 'seat') checkSeat(t, to.seat);
      if (to.kind === 'zone') {
        const z = zoneById(t, to.id);
        if (from.kind === 'zone' && from.id === to.id && z.layout !== 'stack') return { label: null };
      }
      const cards = take(t, c, from, vids);
      const n = cards.length;
      if (to.kind === 'hand') {
        t.hands[c.seat]!.push(...cards.map((x) => x.id));
        log(c, '', 'drop');
      } else if (to.kind === 'seat') {
        t.hands[to.seat]!.push(...cards.map((x) => x.id));
        log(c, to.seat === c.seat ? '' : `GAVE ${plural(n, 'CARD')} TO ${seatName(c, to.seat)}`, 'give');
      } else if (to.kind === 'zone') {
        const z = zoneById(t, to.id);
        intoZone(t, c, z, cards, to.x, to.y);
        // Playing several cards from your hand is worth announcing: others should look.
        log(c, from.kind === 'hand' && n > 1 ? `PLAYED ${n} CARDS ON ${z.name}` : '', 'drop');
      } else {
        onTable(t, c, cards, to.x, to.y, intent.up);
        log(c, from.kind === 'hand' && n > 1 ? `PLAYED ${n} CARDS` : '', 'drop');
      }
      return { label: targetLabel(to, n) };
    }

    case 'flipCards': {
      const { from, vids } = intent;
      const want = new Set(vids);
      if (from.kind === 'hand') reject('FLIP CARDS ON THE TABLE');
      if (from.kind === 'loose') {
        const hit = t.loose.filter((l) => want.has(looseVid(l)));
        if (hit.length !== want.size) reject('THOSE CARDS MOVED');
        for (const l of hit) l.up = !l.up;
      } else {
        const z = zoneById(t, from.id);
        const idx = shownIndexes(z, want);
        if (idx.length !== want.size) reject('THOSE CARDS MOVED');
        for (const i of idx) z.cards[i]!.up = !z.cards[i]!.up;
      }
      log(c, '', 'flip');
      return { label: `FLIP ${plural(vids.length, 'CARD')}` };
    }

    case 'moveItems': {
      for (const it of intent.items) {
        if (it.kind === 'zone') {
          const z = zoneById(t, it.id);
          [z.x, z.y] = clampZone(t, z, it.x, it.y);
        } else if (it.kind === 'loose') {
          const l = t.loose.find((q) => looseVid(q) === it.id) ?? reject('THOSE CARDS MOVED');
          [l.x, l.y] = clampLoose(t, it.x, it.y);
        } else {
          const n = t.notes.find((q) => q.id === it.id) ?? reject('THAT NOTE IS GONE');
          if (n.at.kind !== 'table') reject('THAT NOTE IS GONE');
          [n.at.x, n.at.y] = clampTableNote(t, it.x, it.y);
        }
      }
      log(c, '', 'drop');
      return { label: intent.items.length === 1 && intent.items[0]!.kind === 'zone' ? 'MOVE ZONE' : 'MOVE' };
    }

    case 'pileUp': {
      if (intent.vids.length < 2) reject('PICK AT LEAST 2 CARDS');
      if (t.zones.length >= LIMITS.zones) reject('TOO MANY ZONES');
      const want = new Set(intent.vids);
      const ls: LooseCard[] = t.loose.filter((l) => want.has(looseVid(l)));
      if (ls.length !== want.size) reject('THOSE CARDS MOVED');
      const x = ls.reduce((s, l) => s + l.x, 0) / ls.length;
      const y = ls.reduce((s, l) => s + l.y, 0) / ls.length;
      const up = ls.filter((l) => l.up).length >= ls.length / 2;
      const n = t.nextId++;
      const z: Zone = {
        id: `z${n}`,
        name: `PILE ${n}`,
        x,
        y,
        face: up ? 'up' : 'down',
        layout: 'stack',
        deck: false,
        mess: true,
        w: 330,
        cards: [],
      };
      [z.x, z.y] = clampZone(t, z, x, y);
      z.cards = ls.map((l) => ({ id: l.id, up: l.up, tag: l.tag, j: jitter(c.rng) }));
      t.zones.push(z);
      t.loose = t.loose.filter((l) => !ls.includes(l));
      log(c, `MADE ${z.name} FROM ${ls.length} CARDS`, 'tidy');
      return { label: 'PILE UP' };
    }

    case 'createZone': {
      if (t.zones.length >= LIMITS.zones) reject('TOO MANY ZONES');
      const n = t.nextId++;
      const z: Zone = {
        id: `z${n}`,
        name: `ZONE ${n}`,
        x: 0,
        y: 0,
        face: 'up',
        layout: 'stack',
        deck: false,
        mess: true,
        w: 330,
        cards: [],
      };
      [z.x, z.y] = clampZone(t, z, intent.x, intent.y);
      t.zones.push(z);
      c.events.push({ type: 'zoneCreated', by: c.seat, id: z.id });
      log(c, '', 'drop');
      return { label: 'NEW ZONE' };
    }

    case 'updateZone': {
      const z = zoneById(t, intent.id);
      if (intent.name !== undefined) {
        z.name = cleanText(intent.name, LIMITS.zoneName) || 'ZONE';
        return { label: 'RENAME ZONE', key: `zname:${z.id}` };
      }
      if (intent.face !== undefined) {
        z.face = intent.face;
        for (const card of z.cards) card.up = z.face === 'up';
        log(c, '', 'flip');
      }
      if (intent.layout !== undefined) {
        z.layout = intent.layout;
        if (z.layout === 'spread') [z.x, z.y] = clampZone(t, z, z.x, z.y);
      }
      if (intent.mess !== undefined) {
        z.mess = intent.mess;
        if (!z.mess) for (const card of z.cards) [card.j, card.fan] = [null, null];
      }
      if (intent.deck !== undefined) {
        if (intent.deck) for (const o of t.zones) o.deck = false;
        z.deck = intent.deck;
      }
      if (intent.face === undefined) log(c, '', 'deal');
      return { label: 'ZONE SETTINGS' };
    }

    case 'tidyZone': {
      const z = zoneById(t, intent.id);
      for (const card of z.cards) [card.j, card.fan] = [null, null];
      log(c, '', 'tidy');
      return { label: `TIDY ${z.name}` };
    }

    case 'shuffleZone': {
      const z = intent.id
        ? zoneById(t, intent.id)
        : (deckZone(t) ?? reject('NO DECK ZONE. MARK ONE AS DECK IN ITS SETTINGS'));
      if (z.cards.length < 2) reject('NOTHING TO SHUFFLE');
      shuffleInPlace(z.cards, c.rng);
      // New tags: after a shuffle nobody can follow a hidden card.
      for (const card of z.cards) {
        card.j = null;
        card.fan = null;
        card.tag = newTag(c.rng);
      }
      log(c, `SHUFFLED ${z.name}`, 'shuffle', z.id);
      return { label: `SHUFFLE ${z.name}` };
    }

    case 'flipZone': {
      const z = zoneById(t, intent.id);
      z.cards.reverse();
      for (const card of z.cards) card.up = !card.up;
      log(c, `FLIPPED ${z.name}`, 'flip');
      return { label: `FLIP ${z.name}` };
    }

    case 'deleteZone': {
      const z = zoneById(t, intent.id);
      z.cards.forEach((card, i) => {
        const [x, y] = clampLoose(t, z.x + (i % 6) * 16 - 40, z.y + Math.floor(i / 6) * 10);
        t.loose.push({ id: card.id, up: card.up, tag: card.tag, j: null, x, y, r: randInt(c.rng, -8, 8) });
      });
      t.zones = t.zones.filter((o) => o !== z);
      log(c, `REMOVED ${z.name}`, 'drop');
      return { label: `DELETE ${z.name}` };
    }

    case 'deal': {
      const z = deckZone(t) ?? reject('NO DECK ZONE. MARK ONE AS DECK IN ITS SETTINGS');
      if (!z.cards.length) reject('THE DECK IS EMPTY');
      const N = t.cfg.seats;
      // Clockwise from the dealer's left, dealer last, skipping empty seats.
      const order = c.game.players
        .map((p) => p.seat)
        .filter((s): s is number => s !== null && s < N)
        .sort((a, b) => ((a - c.seat - 1 + N) % N) - ((b - c.seat - 1 + N) % N));
      let dealt = 0;
      for (let i = 0; i < intent.count && z.cards.length; i++) {
        for (const s of order) {
          const card = z.cards.pop();
          if (!card) break;
          t.hands[s]!.push(card.id);
          dealt++;
        }
      }
      const each = Math.floor(dealt / Math.max(1, order.length));
      log(
        c,
        z.cards.length || dealt === intent.count * order.length
          ? `DEALT ${each} EACH`
          : 'DEALT. THE DECK RAN OUT',
        'deal',
      );
      return { label: `DEAL ${intent.count}` };
    }

    case 'collect': {
      gatherAll(t, c);
      log(c, `COLLECTED ALL ${allCardIds(t.cfg.decks, t.cfg.jokers).length} CARDS`, 'shuffle');
      return { label: 'COLLECT' };
    }

    case 'setSeats': {
      const n = intent.count;
      if (n === t.cfg.seats) return { label: null };
      if (c.game.players.some((p) => p.seat !== null && p.seat >= n))
        reject('SOMEONE IS SITTING IN A SEAT THAT WOULD GO');
      const deck = deckZone(t);
      for (let s = n; s < t.cfg.seats; s++) {
        const ids = t.hands[s]!;
        t.hands[s] = [];
        t.score[s] = 0;
        const cards: Card[] = ids.map((id) => ({ id, up: false, tag: newTag(c.rng), j: null }));
        if (deck) deck.cards.unshift(...cards);
        else onTable(t, c, cards, t.cfg.tw / 2, t.cfg.th / 2, false);
        t.notes = t.notes.filter((o) => !(o.at.kind === 'seat' && o.at.seat === s));
      }
      t.cfg.seats = n;
      const [tw, th] = tableSizeFor(n);
      if (tw > t.cfg.tw || th > t.cfg.th) resize(t, Math.max(t.cfg.tw, tw), Math.max(t.cfg.th, th));
      log(c, `SET THE TABLE FOR ${n}`, 'join');
      // Undo snapshots assume a seat layout; changing it starts a fresh history.
      return { label: null, clearHistory: true };
    }

    case 'setDecks': {
      t.cfg.decks = intent.decks;
      t.cfg.jokers = intent.jokers;
      gatherAll(t, c);
      const total = allCardIds(t.cfg.decks, t.cfg.jokers).length;
      log(
        c,
        `SWITCHED TO ${plural(t.cfg.decks, 'DECK')}${t.cfg.jokers ? ' + JOKERS' : ''}: ${total} CARDS`,
        'shuffle',
      );
      return { label: 'CHANGE DECKS' };
    }

    case 'setCardSize': {
      t.cfg.size = intent.size;
      log(c, '', 'deal');
      return { label: 'CARD SIZE' };
    }

    case 'resizeTable': {
      resize(t, intent.tw, intent.th);
      log(c, '', 'drop');
      return { label: 'RESIZE TABLE' };
    }

    case 'score': {
      checkSeat(t, intent.seat);
      t.score[intent.seat] = (t.score[intent.seat] ?? 0) + intent.delta;
      const sign = intent.delta > 0 ? '+' : '';
      log(c, `GAVE ${seatName(c, intent.seat)} ${sign}${intent.delta}`, intent.delta > 0 ? 'give' : 'drop');
      return { label: 'SCORE' };
    }

    case 'stickNote': {
      const text = cleanText(intent.text, LIMITS.noteText);
      if (!text) reject('WRITE SOMETHING FIRST');
      const at = placeNote(t, c, intent.at);
      t.notes.push({ id: `n${t.nextId++}`, text, color: intent.color, r: randInt(c.rng, -10, 10), at });
      trimNotes(t);
      noteStuck(c, at);
      return { label: 'STICK NOTE' };
    }

    case 'moveNote': {
      const n = t.notes.find((o) => o.id === intent.id) ?? reject('THAT NOTE IS GONE');
      const was = n.at;
      n.at = placeNote(t, c, intent.at);
      n.r = randInt(c.rng, -10, 10);
      trimNotes(t);
      const sameSeat = was.kind === 'seat' && n.at.kind === 'seat' && was.seat === n.at.seat;
      if (sameSeat) log(c, '', 'stick');
      else noteStuck(c, n.at);
      return { label: 'MOVE NOTE' };
    }

    case 'editNote': {
      const n = t.notes.find((o) => o.id === intent.id) ?? reject('THAT NOTE IS GONE');
      if (intent.text !== undefined) n.text = cleanText(intent.text, LIMITS.noteText) || '...';
      if (intent.color !== undefined) n.color = intent.color;
      return { label: 'EDIT NOTE', key: `note:${n.id}` };
    }

    case 'ripNote': {
      const n = t.notes.find((o) => o.id === intent.id) ?? reject('THAT NOTE IS GONE');
      t.notes = t.notes.filter((o) => o !== n);
      if (n.at.kind === 'table') log(c, 'TORE UP A NOTE', 'rip');
      else if (n.at.seat === c.seat) log(c, 'PEELED A NOTE OFF', 'rip');
      else log(c, `RIPPED A NOTE OFF ${seatName(c, n.at.seat)}`, 'rip');
      return { label: 'RIP NOTE' };
    }
  }
}
