import { describe, expect, it } from 'vitest';
import { offsetToView, seatsForViewer, toTable, toView, viewSize, type Edge } from '../src/geometry';

const EDGES: Edge[] = ['B', 'L', 'T', 'R'];

describe('view rotation', () => {
  it.each(EDGES)('toTable undoes toView for edge %s', (edge) => {
    for (const [x, y] of [
      [0, 0],
      [123, 456],
      [1000, 640],
    ] as const) {
      const v = toView(edge, x, y, 1000, 640);
      const { w, h } = viewSize(edge, 1000, 640);
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(w);
      expect(v.y).toBeLessThanOrEqual(h);
      expect(toTable(edge, v.x, v.y, 1000, 640)).toEqual({ x, y });
    }
  });

  it.each(EDGES)('puts the viewer’s own edge at the bottom (%s)', (edge) => {
    const mid = { B: [500, 640], T: [500, 0], L: [0, 320], R: [1000, 320] }[edge];
    const { h } = viewSize(edge, 1000, 640);
    expect(toView(edge, mid[0]!, mid[1]!, 1000, 640).y).toBe(h);
  });

  it('rotates offsets the same way as points', () => {
    for (const edge of EDGES) {
      const a = toView(edge, 100, 100, 1000, 640);
      const b = toView(edge, 103, 107, 1000, 640);
      const o = offsetToView(edge, 3, 7);
      expect([b.x - a.x, b.y - a.y]).toEqual([o.x, o.y]);
    }
  });
});

describe('seatsForViewer', () => {
  it('matches the prototype for 4 players: left, far, right', () => {
    expect(seatsForViewer(4, 0).others).toEqual([
      { seat: 1, side: 'L', f: 0.5 },
      { seat: 2, side: 'T', f: 0.5 },
      { seat: 3, side: 'R', f: 0.5 },
    ]);
  });

  // Going round the viewer's screen from bottom-left, up, across and down the right side
  // must meet the other players in clockwise seat order, for every table and every chair.
  it.each([2, 3, 4, 5, 6, 7, 8])('lists the others clockwise from your left with %i seats', (n) => {
    for (let me = 0; me < n; me++) {
      const { others } = seatsForViewer(n, me);
      expect(others).toHaveLength(n - 1);
      const around = (o: (typeof others)[number]) =>
        o.side === 'L' ? 1 - o.f : o.side === 'T' ? 1 + o.f : 2 + o.f;
      const bySeat = [...others].sort((a, b) => ((a.seat - me + n) % n) - ((b.seat - me + n) % n));
      const positions = bySeat.map(around);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('shows spectators every seat', () => {
    expect(seatsForViewer(4, null).others.map((o) => o.seat)).toEqual([0, 1, 2, 3]);
  });
});
