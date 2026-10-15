import type { CardId } from './cards';
import type { CardSize, NoteColor } from './constants';

/**
 * The authoritative game state. Only the server holds a full GameState; clients receive
 * a redacted TableView built by `viewFor` (see view.ts).
 *
 * All positions are in *table coordinates*: (0,0) is the top-left of the felt as seen from
 * seat 0, x grows right, y grows toward seat 0. Each client rotates this into its own view.
 */

/** Messy-pile offset for a card: [dx, dy, rotation in degrees]. */
export type Jitter = [number, number, number];

export interface Card {
  id: CardId;
  /** Face up? */
  up: boolean;
  /**
   * Opaque label sent to players while the card is hidden. Re-rolled whenever a player at a
   * real table would lose track of the card: on shuffle, and whenever it leaves a hand.
   */
  tag: string;
  /** Messy-pile jitter, or null when neat. Only used inside stack zones. */
  j: Jitter | null;
  /**
   * Position in a group played together onto a messy pile: [index, group size]. The group is
   * drawn as a small fan, left to right for every viewer, so a run like 2-3-4-5-6 stays readable.
   */
  fan?: [number, number] | null;
}

export interface LooseCard extends Card {
  x: number;
  y: number;
  r: number;
}

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Cards that land here are turned this way. */
  face: 'up' | 'down';
  layout: 'stack' | 'spread';
  /** The deck zone is where DEAL, SHUFFLE and COLLECT work from. At most one. */
  deck: boolean;
  /** Messy piles keep a per-card jitter based on where the card was tossed. */
  mess: boolean;
  /** Width of a spread zone. */
  w: number;
  /** Bottom to top. */
  cards: Card[];
}

export type NoteSpot =
  | { kind: 'table'; x: number; y: number }
  /** Stuck on a player's sprite; x and y are fractions of the sprite box. */
  | { kind: 'seat'; seat: number; x: number; y: number };

export interface Note {
  id: string;
  text: string;
  color: NoteColor;
  r: number;
  at: NoteSpot;
}

export interface TableConfig {
  seats: number;
  decks: number;
  jokers: boolean;
  size: CardSize;
  /** Back design for each deck (index = deck number, value 0..BACK_COUNT-1). Repeats allowed. */
  backs: number[];
  /** Table width and height in table units. */
  tw: number;
  th: number;
}

/** Everything on the table. This is what undo snapshots. */
export interface TableState {
  cfg: TableConfig;
  zones: Zone[];
  loose: LooseCard[];
  /** One hand per possible seat (always MAX_SEATS long), so a hand survives its player leaving. */
  hands: CardId[][];
  score: number[];
  notes: Note[];
  /** Counter for zone and note ids. */
  nextId: number;
}

export interface Player {
  /** Public id. The secret reconnect token stays in the server's room. */
  id: string;
  name: string;
  seat: number | null;
  connected: boolean;
  /** When the player last disconnected (ms epoch), or null while connected. */
  awaySince: number | null;
}

export interface HistoryEntry {
  label: string;
  by: string;
  /** Collapses rapid edits (typing a zone name) into one undo step. */
  key: string | null;
  at: number;
  table: TableState;
}

/** Seat `viewer` may see seat `owner`'s hand: the owner agreed or offered. */
export interface Peek {
  viewer: number;
  owner: number;
}

/** Seat `from` asked to see seat `to`'s hand and is waiting for an answer. */
export interface HandAsk {
  from: number;
  to: number;
  at: number;
}

export interface GameState {
  table: TableState;
  players: Player[];
  history: HistoryEntry[];
  /**
   * Hand peeks live beside the table, not in it: UNDO restores table snapshots, and it must never
   * re-open a hand that its owner has since hidden.
   */
  peeks: Peek[];
  asks: HandAsk[];
}
