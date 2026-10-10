import { applyIntent, type Ctx } from '../src/reducer';
import type { Intent } from '../src/protocol';
import { mulberry32, type Rng } from '../src/rng';
import { newGame } from '../src/setup';
import type { GameState, Player, TableConfig } from '../src/state';

export const NAMES = ['ALEX', 'MAYA', 'DEV', 'RIO', 'JUNE', 'OTTO', 'PIA', 'KAI'];

export function player(seat: number | null, i = seat ?? 9): Player {
  return { id: `p${i}`, name: NAMES[i] ?? `P${i}`, seat, connected: true, awaySince: null };
}

/** A game with `seated` players in seats 0..seated-1, using a seeded rng. */
export function setup(
  seated: number,
  cfg: Partial<TableConfig> = {},
  seed = 1,
): { game: GameState; rng: Rng } {
  const rng = mulberry32(seed);
  const game = newGame(rng, { seats: Math.max(2, seated), ...cfg });
  game.players = Array.from({ length: seated }, (_, s) => player(s));
  return { game, rng };
}

export const ctx = (game: GameState, seat: number, rng: Rng, now = 1_000_000): Ctx => ({
  seat,
  name: game.players.find((p) => p.seat === seat)?.name ?? `SEAT${seat}`,
  rng,
  now,
});

/** Apply an intent that must succeed. */
export function act(game: GameState, seat: number, intent: Intent, rng: Rng, now?: number) {
  const r = applyIntent(game, intent, ctx(game, seat, rng, now));
  if (!r.ok) throw new Error(`intent ${intent.type} failed: ${r.error}`);
  return r;
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const deckOf = (game: GameState) => game.table.zones.find((z) => z.deck)!;
