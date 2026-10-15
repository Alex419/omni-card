import { BACK_COUNT, RANKS, SUITS } from './constants';

/**
 * A card's identity is `${face}.${deck}`, e.g. "AS.0", "10H.2", "JR.1" (red joker from deck 1).
 * The deck number picks the card back (see backFor). These identities are secret for hidden cards:
 * they live only on the server and are replaced by opaque ids in each player's view.
 */
export type CardId = string;
/** The printed face without the deck number, e.g. "AS" or "JB". What a player sees. */
export type Face = string;

export function allCardIds(decks: number, jokers: boolean): CardId[] {
  const out: CardId[] = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}.${d}`);
    if (jokers) out.push(`JR.${d}`, `JB.${d}`);
  }
  return out;
}

export const faceOf = (id: CardId): Face => id.split('.')[0]!;
/** Which deck a card belongs to (0-based). Server-side only for hidden cards. */
export const deckOf = (id: CardId): number => Number(id.split('.')[1] ?? 0);

/**
 * The back design players see. Each deck's design is chosen at the table (TableConfig.backs), and
 * several decks may share one, so the back alone can't tell anyone which deck a card came from.
 */
export const backFor = (cfg: { backs?: readonly number[] }, id: CardId): number => {
  const d = deckOf(id);
  return cfg.backs?.[d] ?? d % BACK_COUNT;
};

/* ---------- sorting a hand ---------- */

/** Ace high: 2 3 ... 10 J Q K A. */
const RANK_ORDER = [...RANKS.slice(1), 'A'];
/** Spades, hearts, clubs, diamonds: the colors alternate, so neighbouring suits are easy to tell apart. */
const SUIT_ORDER = ['S', 'H', 'C', 'D'];

const isJoker = (face: Face) => face === 'JR' || face === 'JB';
const rankIndex = (face: Face) => RANK_ORDER.indexOf(face.slice(0, -1));
const suitIndex = (face: Face) => SUIT_ORDER.indexOf(face.slice(-1));

/**
 * Order for "sort by rank" (rank, then suit) or "sort by suit" (suit, then rank). Jokers go last;
 * equal faces from different decks keep a fixed order by deck.
 */
export function compareCards(a: CardId, b: CardId, by: 'rank' | 'suit'): number {
  const fa = faceOf(a);
  const fb = faceOf(b);
  const ja = isJoker(fa);
  const jb = isJoker(fb);
  if (ja || jb) return ja && jb ? fa.localeCompare(fb) || deckOf(a) - deckOf(b) : ja ? 1 : -1;
  const [first, second] = by === 'rank' ? [rankIndex, suitIndex] : [suitIndex, rankIndex];
  return first(fa) - first(fb) || second(fa) - second(fb) || deckOf(a) - deckOf(b);
}
