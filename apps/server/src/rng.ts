import { randomInt, webcrypto } from 'node:crypto';
import type { Rng } from '@omni/shared';

/**
 * Production randomness for shuffles and card tags. Math.random is not enough here:
 * V8's generator is predictable once you've seen a few outputs, and a player who can predict
 * it can predict the deck. crypto.getRandomValues is unpredictable.
 */
const buf = new Uint32Array(64);
let i = buf.length;
export const cryptoRng: Rng = () => {
  if (i >= buf.length) {
    webcrypto.getRandomValues(buf);
    i = 0;
  }
  return buf[i++]! / 4294967296;
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1: easy to read out loud
export function roomCode(length = 5): string {
  let s = '';
  for (let k = 0; k < length; k++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

export const randomId = (bytes = 9) =>
  Buffer.from(webcrypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
