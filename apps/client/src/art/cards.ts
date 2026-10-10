import { blit, canvas, type Ctx2D } from './canvas';
import { PAL } from './palette';

/** 25x35 pixel card faces and backs, drawn once at startup and used as CSS background images. */

const GLY: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '0': ['111', '101', '101', '101', '111'],
  J: ['001', '001', '001', '101', '111'],
  Q: ['010', '101', '101', '110', '011'],
  K: ['101', '101', '110', '101', '101'],
};
const SM: Record<string, string[]> = {
  S: ['00100', '01110', '11111', '00100', '01110'],
  H: ['01010', '11111', '11111', '01110', '00100'],
  D: ['00100', '01110', '11111', '01110', '00100'],
  C: ['01110', '01110', '11011', '11111', '00100'],
  X: ['00100', '11111', '01110', '01010', '10001'],
};
const BIG: Record<string, string[]> = {
  H: ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  D: [
    '....#....',
    '...###...',
    '..#####..',
    '.#######.',
    '#########',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
  ],
  S: [
    '....#....',
    '...###...',
    '..#####..',
    '.#######.',
    '#########',
    '#########',
    '.##.#.##.',
    '....#....',
    '...###...',
  ],
  C: [
    '...###...',
    '..#####..',
    '...###...',
    '.##.#.##.',
    '#########',
    '#########',
    '.##.#.##.',
    '....#....',
    '...###...',
  ],
  X: [
    '....#....',
    '....#....',
    '...###...',
    '#########',
    '.#######.',
    '..#####..',
    '..##.##..',
    '.##...##.',
    '##.....##',
  ],
};
const QMARK = ['.#####.', '##...##', '.....##', '...###.', '...##..', '.......', '...##..'];
const RED: Record<string, boolean> = { H: true, D: true };

function rank(x: Ctx2D, rk: string, ox: number, oy: number, col: string, sc = 1) {
  if (rk === '10') {
    blit(x, GLY['1']!, ox, oy, col, sc);
    blit(x, GLY['0']!, ox + 3 * sc, oy, col, sc);
  } else blit(x, GLY[rk]!, ox, oy, col, sc);
}

function frame(x: Ctx2D, fill: string, line: string) {
  x.fillStyle = line;
  x.fillRect(1, 0, 23, 1);
  x.fillRect(1, 34, 23, 1);
  x.fillRect(0, 1, 1, 33);
  x.fillRect(24, 1, 1, 33);
  x.fillStyle = fill;
  x.fillRect(1, 1, 23, 33);
}

/** rk is 'A'..'K', or 'R'/'B' for a red/black joker (su = 'X'). */
export function faceURL(rk: string, su: string): string {
  const [c, x] = canvas(25, 35);
  const joker = su === 'X';
  const col = RED[su] || rk === 'R' ? PAL.red : PAL.ink;
  frame(x, PAL.paper, PAL.night);
  x.fillStyle = PAL.shade;
  x.fillRect(2, 33, 21, 1);
  x.fillRect(23, 2, 1, 31);
  const corner = () => {
    if (joker) {
      blit(x, GLY.J!, 2, 2, col);
      blit(x, SM.X!, 1, 8, col);
    } else {
      rank(x, rk, 2, 2, col);
      blit(x, SM[su]!, 2, 8, col);
    }
  };
  corner();
  x.save();
  x.translate(25, 35);
  x.rotate(Math.PI);
  corner();
  x.restore();
  if (joker) {
    x.fillStyle = rk === 'R' ? PAL.peach : PAL.mist;
    x.fillRect(6, 8, 13, 19);
    blit(x, BIG.X!, 8, 11, col);
    x.fillStyle = PAL.gold;
    x.fillRect(12, 13, 1, 1);
    x.fillStyle = col;
    x.fillRect(8, 22, 9, 1);
  } else if ('JQK'.includes(rk)) {
    x.fillStyle = RED[su] ? PAL.peach : PAL.mist;
    x.fillRect(6, 8, 13, 19);
    x.fillStyle = col;
    x.fillRect(6, 8, 13, 1);
    x.fillRect(6, 26, 13, 1);
    x.fillRect(6, 8, 1, 19);
    x.fillRect(18, 8, 1, 19);
    rank(x, rk, 9, 10, col, 2);
    blit(x, SM[su]!, 10, 21, col);
  } else blit(x, BIG[su]!, 8, 13, col);
  return c.toDataURL();
}

export function backURL([base, border, pat, emb]: readonly [string, string, string, string]): string {
  const [c, x] = canvas(25, 35);
  frame(x, base, PAL.night);
  x.fillStyle = border;
  x.fillRect(2, 2, 21, 1);
  x.fillRect(2, 32, 21, 1);
  x.fillRect(2, 2, 1, 31);
  x.fillRect(22, 2, 1, 31);
  x.fillStyle = pat;
  for (let j = 4; j <= 30; j++)
    for (let i = 4; i <= 20; i++) if ((i + j) % 4 === 0 || (i - j + 40) % 4 === 0) x.fillRect(i, j, 1, 1);
  x.fillStyle = base;
  x.fillRect(8, 13, 9, 9);
  blit(x, ['0001000', '0011100', '0111110', '1111111', '0111110', '0011100', '0001000'], 9, 14, emb);
  x.fillStyle = border;
  x.fillRect(12, 17, 1, 1);
  return c.toDataURL();
}

/** A blank face (the visible edge of buried cards in a face-up pile). */
export function blankURL(): string {
  const [c, x] = canvas(25, 35);
  frame(x, PAL.paper, PAL.night);
  x.fillStyle = PAL.shade;
  x.fillRect(2, 33, 21, 1);
  x.fillRect(23, 2, 1, 31);
  return c.toDataURL();
}

/** Shown while dragging a hidden card you've flipped face up with F: you'll find out when it lands. */
export function mysteryURL(): string {
  const [c, x] = canvas(25, 35);
  frame(x, PAL.paper, PAL.night);
  blit(x, QMARK, 9, 13, PAL.lilac);
  return c.toDataURL();
}
