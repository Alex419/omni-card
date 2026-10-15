import { allCardIds } from './cards';
import { MAX_SEATS, tableSizeFor } from './constants';
import { newTag, shuffleInPlace, type Rng } from './rng';
import type { Card, GameState, TableConfig, TableState } from './state';

export const DEFAULT_CONFIG: TableConfig = {
  seats: 4,
  decks: 1,
  jokers: false,
  size: 'M',
  backs: [0, 1, 2, 3],
  tw: 1000,
  th: 640,
};

export function freshDeck(cfg: TableConfig, rng: Rng): Card[] {
  return shuffleInPlace(allCardIds(cfg.decks, cfg.jokers), rng).map((id) => ({
    id,
    up: false,
    tag: newTag(rng),
    j: null,
  }));
}

/**
 * A new table: a full shuffled deck, an empty discard pile and an empty spread for melds, kept in the
 * middle band so they don't sit under anyone's fan of cards whichever way the table is turned.
 */
export function newTable(rng: Rng, overrides: Partial<TableConfig> = {}): TableState {
  const seats = overrides.seats ?? DEFAULT_CONFIG.seats;
  const [tw, th] = tableSizeFor(seats);
  const cfg: TableConfig = { ...DEFAULT_CONFIG, tw, th, ...overrides };
  const cx = cfg.tw / 2;
  const cy = cfg.th / 2;
  return {
    cfg,
    zones: [
      {
        id: 'z1',
        name: 'DECK',
        x: cx - 90,
        y: cy - 70,
        face: 'down',
        layout: 'stack',
        deck: true,
        mess: false,
        w: 330,
        cards: freshDeck(cfg, rng),
      },
      {
        id: 'z2',
        name: 'DISCARD',
        x: cx + 90,
        y: cy - 70,
        face: 'up',
        layout: 'stack',
        deck: false,
        mess: true,
        w: 330,
        cards: [],
      },
      {
        id: 'z3',
        name: 'MELD',
        x: cx,
        y: cy + 90,
        face: 'up',
        layout: 'spread',
        deck: false,
        mess: false,
        w: 330,
        cards: [],
      },
    ],
    loose: [],
    hands: Array.from({ length: MAX_SEATS }, () => []),
    score: Array.from({ length: MAX_SEATS }, () => 0),
    notes: [],
    nextId: 4,
  };
}

export function newGame(rng: Rng, overrides: Partial<TableConfig> = {}): GameState {
  return { table: newTable(rng, overrides), players: [], history: [], peeks: [], asks: [] };
}
