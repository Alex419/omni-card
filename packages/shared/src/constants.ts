/** Game-wide constants shared by the client, the server and the reducer. */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
export const MAX_DECKS = 4;
/** One card-back color per deck, so mixed decks can be sorted back out. */
export const BACK_COUNT = 4;

/** Card footprint on the table, in table units: [width, height, hand-scale multiplier]. */
export const CARD_SIZES = {
  S: [60, 84, 0.85],
  M: [75, 105, 1],
  L: [90, 126, 1.15],
} as const;
export type CardSize = keyof typeof CARD_SIZES;

export const NOTE_COLORS = ['yel', 'pink', 'blue', 'green'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** What a player shouts when someone sticks a note on them. Picked by the server so everyone sees the same one. */
export const QUIPS = ['HEY!', 'REALLY?', 'WHAT DOES IT SAY?', 'NOT COOL', 'LOL OK', 'I SAW THAT', 'RUDE!'];

export const LIMITS = {
  tableMinW: 760,
  tableMaxW: 1800,
  tableMinH: 500,
  tableMaxH: 1150,
  zoneName: 12,
  noteText: 24,
  playerName: 12,
  dealMax: 26,
  history: 60,
  notesPerSeat: 6,
  zones: 40,
  tableNotes: 40,
  /** A seat whose player has been disconnected this long can be taken by someone else. */
  seatReclaimMs: 60_000,
} as const;

/** Default table size grows with the number of seats, like the prototype. */
export function tableSizeFor(seats: number): [number, number] {
  return seats <= 4 ? [1000, 640] : seats <= 6 ? [1120, 720] : [1240, 800];
}

/** Sprite look for each seat: hair, skin, clothes, extras, hat color. Seat 0 wears the prototype's "YOU" look. */
export interface Look {
  h: string;
  s: string;
  c: string;
  x: string[];
  cap?: string;
}
export const LOOKS: readonly Look[] = [
  { h: '#5f574f', s: '#ffccaa', c: '#ff004d', x: [] },
  { h: '#7e2553', s: '#ffccaa', c: '#29adff', x: ['long'] },
  { h: '#1d2b53', s: '#ab5236', c: '#ffa300', x: ['cap', 'glasses'], cap: '#ff004d' },
  { h: '#ffa300', s: '#ffccaa', c: '#00e436', x: ['spiky'] },
  { h: '#5f574f', s: '#e8b087', c: '#ff77a8', x: ['bun'] },
  { h: '#ab5236', s: '#ffccaa', c: '#83769c', x: ['beanie'], cap: '#29adff' },
  { h: '#ffec27', s: '#c98a62', c: '#7e2553', x: ['long', 'band'], cap: '#ff77a8' },
  { h: '#1d2b53', s: '#7a4a2a', c: '#ffec27', x: ['beard'] },
];
