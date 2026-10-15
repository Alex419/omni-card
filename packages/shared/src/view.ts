import { backFor, faceOf, type Face } from './cards';
import { LIMITS } from './constants';
import type { Card, GameState, Jitter, LooseCard, Note, Player, TableConfig, Zone } from './state';

/**
 * Redaction: turn the full GameState into what one player is allowed to see.
 *
 * Rules (the most important correctness property in the app, see test/view.test.ts):
 *  - Your own hand: full identities.
 *  - Other players' hands: count and back colors only. No ids of any kind.
 *  - Face-down cards, and cards buried in a neat pile: no identity, only an opaque view id
 *    (`vid`) made from the card's random tag. Tags are re-rolled on shuffle and whenever a card
 *    leaves a hand, so a hidden card can't be followed through either.
 *  - Piles (stack zones): only the top few cards are sent at all. Deck order never leaves the server.
 */

export interface CardView {
  /** What the client uses to refer to this card in intents. */
  vid: string;
  /** Printed face ("AS"), or null when this viewer can't see it. */
  face: Face | null;
  /** Back color index. Visible from across the table even when the face isn't. */
  back: number;
}

export interface LooseCardView extends CardView {
  x: number;
  y: number;
  r: number;
}

export interface ZoneCardView extends CardView {
  j: Jitter | null;
  /** Face up? Visible from the side of a pile even when the face itself is buried. */
  up: boolean;
  /** [index, size] when this card was played as part of a group (see Card.fan). */
  fan: [number, number] | null;
}

export interface ZoneView {
  id: string;
  name: string;
  x: number;
  y: number;
  face: Zone['face'];
  layout: Zone['layout'];
  deck: boolean;
  mess: boolean;
  w: number;
  messy: boolean;
  /** Total cards, including the ones not sent. */
  count: number;
  /** For a stack: the top few cards, bottom to top. For a spread: every card. */
  cards: ZoneCardView[];
}

export interface PlayerView {
  id: string;
  name: string;
  connected: boolean;
}

export interface SeatView {
  seat: number;
  player: PlayerView | null;
  /** Someone could sit here: the seat is empty, or its player has been gone a while. */
  open: boolean;
  handCount: number;
  handBacks: number[];
  score: number;
}

export interface TableView {
  you: { playerId: string; name: string; seat: number | null };
  cfg: TableConfig;
  zones: ZoneView[];
  loose: LooseCardView[];
  seats: SeatView[];
  /** Your hand, or null for spectators. */
  hand: CardView[] | null;
  notes: Note[];
  spectators: PlayerView[];
  /** The step UNDO would take back, so the button can say what it will do. */
  undo: { label: string; by: string } | null;
  /** Hands their owners let you see. The only way another player's cards ever reach you. */
  peeking: { seat: number; cards: CardView[] }[];
  /** Seats that can see your hand. */
  shownTo: number[];
  /** Seats asking to see your hand, waiting for your answer. */
  asksForMe: number[];
  /** Seats you've asked, still waiting. */
  asksFromMe: number[];
}

/* ---------- visibility, shared with the reducer so vids resolve the same way ---------- */

const NEAT_SHOWN = 4;
const MESSY_SHOWN = 14;

/** A pile is messy once any card in it is askew or fanned out. */
export const isMessy = (z: Zone) =>
  z.layout === 'stack' &&
  z.cards.length > 1 &&
  z.cards.some((c) => !!c.fan || (c.j !== null && (c.j[0] || c.j[1] || c.j[2])));

/** Index of the first card of a zone that gets sent to clients. */
export function firstShown(z: Zone): number {
  if (z.layout === 'spread') return 0;
  return Math.max(0, z.cards.length - (isMessy(z) ? MESSY_SHOWN : NEAT_SHOWN));
}

/**
 * Can players see the face of the card at `index` in this zone? Face-up cards in a spread or a
 * messy pile show; in a neat pile only the top one does (the rest are just edges).
 */
export function zoneCardVisible(z: Zone, index: number): boolean {
  const c = z.cards[index];
  if (!c || !c.up) return false;
  return z.layout === 'spread' || index === z.cards.length - 1 || isMessy(z);
}

/** Hidden cards are named by their random tag; visible ones by their real id. */
export const vidFor = (c: Card, visible: boolean) => (visible ? c.id : `h${c.tag}`);

export const looseVid = (c: LooseCard) => vidFor(c, c.up);

function cardView(cfg: TableConfig, c: Card, visible: boolean): CardView {
  return { vid: vidFor(c, visible), face: visible ? faceOf(c.id) : null, back: backFor(cfg, c.id) };
}

/* ---------- the view ---------- */

export function seatIsOpen(players: Player[], seat: number, now: number): boolean {
  const p = players.find((q) => q.seat === seat);
  return !p || (!p.connected && p.awaySince !== null && now - p.awaySince >= LIMITS.seatReclaimMs);
}

const playerView = (p: Player): PlayerView => ({ id: p.id, name: p.name, connected: p.connected });

export function viewFor(game: GameState, playerId: string, now: number): TableView {
  const { table, players } = game;
  const me = players.find((p) => p.id === playerId);
  if (!me) throw new Error(`viewFor: unknown player ${playerId}`);
  const mySeat = me.seat;

  const zones: ZoneView[] = table.zones.map((z) => {
    const start = firstShown(z);
    const cards: ZoneCardView[] = [];
    for (let i = start; i < z.cards.length; i++) {
      const c = z.cards[i]!;
      cards.push({ ...cardView(table.cfg, c, zoneCardVisible(z, i)), j: c.j, up: c.up, fan: c.fan ?? null });
    }
    return {
      id: z.id,
      name: z.name,
      x: z.x,
      y: z.y,
      face: z.face,
      layout: z.layout,
      deck: z.deck,
      mess: z.mess,
      w: z.w,
      messy: isMessy(z),
      count: z.cards.length,
      cards,
    };
  });

  const loose: LooseCardView[] = table.loose.map((c) => ({
    ...cardView(table.cfg, c, c.up),
    x: c.x,
    y: c.y,
    r: c.r,
  }));

  const seats: SeatView[] = [];
  for (let s = 0; s < table.cfg.seats; s++) {
    const p = players.find((q) => q.seat === s);
    const hand = table.hands[s] ?? [];
    seats.push({
      seat: s,
      player: p ? playerView(p) : null,
      open: seatIsOpen(players, s, now),
      handCount: hand.length,
      handBacks: hand.map((id) => backFor(table.cfg, id)),
      score: table.score[s] ?? 0,
    });
  }

  const handOf = (s: number): CardView[] =>
    (table.hands[s] ?? []).map((id) => ({ vid: id, face: faceOf(id), back: backFor(table.cfg, id) }));
  const hand = mySeat === null ? null : handOf(mySeat);
  // Spectators have no seat, so they can't be granted a peek (or asked for one).
  const mine = <T>(list: T[], pick: (x: T) => boolean) => (mySeat === null ? [] : list.filter(pick));

  const last = game.history[game.history.length - 1];
  return {
    you: { playerId: me.id, name: me.name, seat: mySeat },
    cfg: { ...table.cfg, backs: [...table.cfg.backs] },
    zones,
    loose,
    seats,
    hand,
    notes: table.notes.map((n) => ({ ...n, at: { ...n.at } })),
    spectators: players.filter((p) => p.seat === null).map(playerView),
    undo: last ? { label: last.label, by: last.by } : null,
    peeking: mine(game.peeks, (p) => p.viewer === mySeat).map((p) => ({
      seat: p.owner,
      cards: handOf(p.owner),
    })),
    shownTo: mine(game.peeks, (p) => p.owner === mySeat).map((p) => p.viewer),
    asksForMe: mine(game.asks, (a) => a.to === mySeat).map((a) => a.from),
    asksFromMe: mine(game.asks, (a) => a.from === mySeat).map((a) => a.to),
  };
}
