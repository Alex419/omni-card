import { describe, expect, it } from 'vitest';
import { fit, proj, unproj } from '../src/table/projection';

describe('projection', () => {
  it.each([
    [1440, 820, 1000, 640],
    [390, 700, 640, 1000],
    [1920, 1000, 1240, 800],
  ])('unproj inverts proj on a %ix%i screen', (SW, SH, W, H) => {
    const L = fit(SW, SH, W, H, 1);
    for (const [u, v] of [
      [0, 0],
      [W / 2, H / 2],
      [W * 0.9, H * 0.2],
      [W, H],
    ] as const) {
      const p = proj(L, u, v);
      const back = unproj(L, p.x, p.y);
      expect(back.x).toBeCloseTo(u, 6);
      expect(back.y).toBeCloseTo(v, 6);
    }
  });

  it('fits the table between the toolbar and the hand', () => {
    const L = fit(1440, 820, 1000, 640, 1);
    expect(proj(L, 500, 0).y).toBeGreaterThanOrEqual(135);
    expect(proj(L, 500, 640).y).toBeLessThanOrEqual(820 - L.handH * 0.5 + 1);
  });
});
