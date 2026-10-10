/**
 * Seat geometry and per-player view rotation.
 *
 * Seats live on the edges of the table in table coordinates. Each client turns the table so
 * its own edge is at the bottom (a multiple of 90 degrees) and then draws everyone else on the
 * left (L), far (T) or right (R) edge, like the prototype. Cards and notes stay upright for
 * every viewer; only positions rotate. See docs/decisions.md, "Per-seat view rotation".
 */

export type Edge = 'B' | 'L' | 'T' | 'R';
export interface SeatSpot {
  edge: Edge;
  /** Fraction along the edge, measured in table coordinates (left to right, top to bottom). */
  f: number;
}

/**
 * Seats clockwise from seat 0, seen from above. Clockwise means: along the bottom edge from
 * right to left, up the left edge, along the top from left to right, down the right edge.
 */
const SEAT_LAYOUTS: Record<number, [Edge, number][]> = {
  2: [
    ['B', 0.5],
    ['T', 0.5],
  ],
  3: [
    ['B', 0.5],
    ['L', 0.5],
    ['R', 0.5],
  ],
  4: [
    ['B', 0.5],
    ['L', 0.5],
    ['T', 0.5],
    ['R', 0.5],
  ],
  5: [
    ['B', 0.5],
    ['L', 0.5],
    ['T', 0.3],
    ['T', 0.7],
    ['R', 0.5],
  ],
  6: [
    ['B', 0.7],
    ['B', 0.3],
    ['L', 0.5],
    ['T', 0.3],
    ['T', 0.7],
    ['R', 0.5],
  ],
  7: [
    ['B', 0.5],
    ['L', 0.7],
    ['L', 0.3],
    ['T', 0.3],
    ['T', 0.7],
    ['R', 0.3],
    ['R', 0.7],
  ],
  8: [
    ['B', 0.7],
    ['B', 0.3],
    ['L', 0.7],
    ['L', 0.3],
    ['T', 0.3],
    ['T', 0.7],
    ['R', 0.3],
    ['R', 0.7],
  ],
};

export function seatSpots(seats: number): SeatSpot[] {
  const layout = SEAT_LAYOUTS[seats];
  if (!layout) throw new Error(`No seat layout for ${seats} seats`);
  return layout.map(([edge, f]) => ({ edge, f }));
}

/** Where a seat sits, in table coordinates. */
export function seatPoint(spot: SeatSpot, W: number, H: number): { x: number; y: number } {
  switch (spot.edge) {
    case 'B':
      return { x: spot.f * W, y: H };
    case 'T':
      return { x: spot.f * W, y: 0 };
    case 'L':
      return { x: 0, y: spot.f * H };
    case 'R':
      return { x: W, y: spot.f * H };
  }
}

/** Size of the table as the viewer sees it: side seats look down the long axis. */
export function viewSize(edge: Edge, W: number, H: number): { w: number; h: number } {
  return edge === 'L' || edge === 'R' ? { w: H, h: W } : { w: W, h: H };
}

/** Table coordinates to the viewer's coordinates (viewer's edge at the bottom). */
export function toView(edge: Edge, x: number, y: number, W: number, H: number): { x: number; y: number } {
  switch (edge) {
    case 'B':
      return { x, y };
    case 'T':
      return { x: W - x, y: H - y };
    case 'L':
      return { x: y, y: W - x };
    case 'R':
      return { x: H - y, y: x };
  }
}

/** Inverse of toView. */
export function toTable(edge: Edge, x: number, y: number, W: number, H: number): { x: number; y: number } {
  switch (edge) {
    case 'B':
      return { x, y };
    case 'T':
      return { x: W - x, y: H - y };
    case 'L':
      return { x: W - y, y: x };
    case 'R':
      return { x: y, y: H - x };
  }
}

/** Rotate an offset vector (like a messy-pile jitter) from table into view orientation. */
export function offsetToView(edge: Edge, dx: number, dy: number): { x: number; y: number } {
  switch (edge) {
    case 'B':
      return { x: dx, y: dy };
    case 'T':
      return { x: -dx, y: -dy };
    case 'L':
      return { x: dy, y: -dx };
    case 'R':
      return { x: -dy, y: dx };
  }
}

export interface OtherSeat {
  seat: number;
  /** Edge in the viewer's frame. Never 'B': that is where the viewer sits. */
  side: 'L' | 'T' | 'R';
  /** Fraction along that edge in the viewer's frame. */
  f: number;
}

/**
 * Where to draw every other seat for one viewer. Seats on the viewer's own edge would be
 * hidden behind the hand, so they slide to the near end of the left or right edge, the way
 * a neighbour on your side of a long table sits just round the corner from you.
 * Spectators (viewer = null) watch from seat 0's chair and see every seat.
 */
export function seatsForViewer(seats: number, viewer: number | null): { edge: Edge; others: OtherSeat[] } {
  const spots = seatSpots(seats);
  const edge = viewer === null ? 'B' : spots[viewer]!.edge;
  // Use a unit table: only the edge and fraction matter here, not the size.
  const W = 1;
  const H = 1;
  const { w, h } = viewSize(edge, W, H);
  const others: OtherSeat[] = [];
  spots.forEach((spot, seat) => {
    if (seat === viewer) return;
    const p = seatPoint(spot, W, H);
    const v = toView(edge, p.x, p.y, W, H);
    const eps = 1e-9;
    if (v.y < eps) others.push({ seat, side: 'T', f: v.x / w });
    else if (v.x < eps) others.push({ seat, side: 'L', f: v.y / h });
    else if (v.x > w - eps) others.push({ seat, side: 'R', f: v.y / h });
    else others.push({ seat, side: v.x < w / 2 ? 'L' : 'R', f: 0.9 });
  });
  return { edge, others };
}
