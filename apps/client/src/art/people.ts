import type { Look } from '@omni/shared';
import { canvas, px } from './canvas';
import { PAL, shadeHex } from './palette';

/** 16x22 player sprite: three frames side by side (normal, blink, shocked). */
const BODY = [
  '....hhhhhhhh....',
  '...hhhhhhhhhh...',
  '..hhhhhhhhhhhh..',
  '..hhsssssssshh..',
  '..hssssssssssh..',
  '..sswesssswess..',
  '..ssssssssssss..',
  '..ssssskssssss..',
  '..ssssmmmmssss..',
  '...ssssssssss...',
  '....ssssssss....',
  '......nnnn......',
  '...cccccccccc...',
  '..cccccccccccc..',
  '.cccccccccccccc.',
  'dccccccccccccccd',
  'dccccccccccccccd',
  'dccccccccccccccd',
  'dccccccccccccccd',
  'sccccccccccccccs',
  'ss.cccccccccc.ss',
  '...cccccccccc...',
];

export function personURL(l: Look): string {
  const [c, x] = canvas(48, 22);
  const map: Record<string, string> = {
    h: l.h,
    s: l.s,
    k: shadeHex(l.s, 0.78),
    n: shadeHex(l.s, 0.85),
    w: PAL.paper,
    e: PAL.night,
    m: PAL.purple,
    c: l.c,
    d: shadeHex(l.c, 0.7),
  };
  const cap = l.cap ?? l.h;
  for (let f = 0; f < 3; f++) {
    x.save();
    x.translate(f * 16, 0);
    BODY.forEach((r, j) => {
      for (let i = 0; i < 16; i++) {
        const col = map[r[i]!];
        if (col) px(x, i, j, col);
      }
    });
    if (f === 1) {
      px(x, 4, 5, map.k!, 2);
      px(x, 10, 5, map.k!, 2);
    }
    if (f === 2) {
      px(x, 4, 4, PAL.paper, 2, 2);
      px(x, 10, 4, PAL.paper, 2, 2);
      px(x, 5, 5, PAL.night);
      px(x, 10, 5, PAL.night);
      px(x, 6, 8, l.s, 4);
      px(x, 7, 8, PAL.night, 2, 2);
      px(x, 3, 7, PAL.pink);
      px(x, 12, 7, PAL.pink);
    }
    const xs = l.x;
    if (xs.includes('long')) {
      px(x, 1, 3, l.h, 1, 11);
      px(x, 14, 3, l.h, 1, 11);
      px(x, 2, 9, l.h, 1, 4);
      px(x, 13, 9, l.h, 1, 4);
    }
    if (xs.includes('spiky')) {
      x.clearRect(0, 0, 16, 1);
      [3, 5, 7, 9, 11].forEach((a) => px(x, a, 0, l.h));
      px(x, 1, 1, l.h);
      px(x, 14, 1, l.h);
      px(x, 2, 2, l.h);
      px(x, 13, 2, l.h);
    }
    if (xs.includes('bun')) {
      x.clearRect(0, 0, 16, 1);
      px(x, 6, 0, l.h, 4, 1);
      px(x, 5, 1, shadeHex(l.h, 0.75), 6, 1);
    }
    if (xs.includes('cap')) {
      px(x, 3, 0, cap, 10, 3);
      px(x, 3, 3, cap, 12, 1);
      px(x, 6, 1, PAL.paper, 2, 1);
    }
    if (xs.includes('beanie')) {
      px(x, 3, 0, cap, 10, 2);
      px(x, 2, 2, cap, 12, 2);
      px(x, 2, 3, shadeHex(cap, 0.7), 12, 1);
      px(x, 7, 0, PAL.paper, 2, 1);
    }
    if (xs.includes('band')) px(x, 2, 3, cap, 12, 1);
    if (xs.includes('beard')) {
      px(x, 2, 8, l.h, 4, 1);
      px(x, 10, 8, l.h, 4, 1);
      px(x, 3, 9, l.h, 10, 1);
      px(x, 4, 10, l.h, 8, 1);
    }
    if (xs.includes('glasses')) {
      const g = PAL.night;
      [3, 9].forEach((a) => {
        px(x, a, 4, g, 4);
        px(x, a, 6, g, 4);
        px(x, a, 4, g, 1, 3);
        px(x, a + 3, 4, g, 1, 3);
      });
      px(x, 7, 5, g, 2);
    }
    x.restore();
  }
  return c.toDataURL();
}
