/**
 * Randomness is injected rather than read from Math.random so the reducer stays pure:
 * the same state + intent + rng always gives the same result, which makes tests deterministic.
 * The server passes a crypto-backed rng (see apps/server/src/rng.ts); tests pass a seeded one.
 */
export type Rng = () => number;

/** Small seeded PRNG for tests and reproducible scenarios. Not for production shuffles. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [a, b], inclusive. */
export const randInt = (rng: Rng, a: number, b: number) => Math.round(a + rng() * (b - a));

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

/** Fisher-Yates shuffle, in place. */
export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

const TAG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** Opaque random label for a hidden card. 12 base-36 chars is about 62 bits: unguessable. */
export function newTag(rng: Rng): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += TAG_CHARS[Math.floor(rng() * TAG_CHARS.length)];
  return s;
}
