import {
  CARD_SIZES,
  clampLoose,
  clampTableNote,
  clampZone,
  resizedConfig,
  offsetToView,
  seatsForViewer,
  toTable,
  toView,
  viewSize,
  type Edge,
  type SeatView,
  type TableView,
  type ZoneView,
} from '@omni/shared';
import { proj, type Layout } from './projection';

/**
 * Everything the table needs to draw, worked out once per view: the viewer's rotation, card size,
 * and where every other seat and its fan of cards sit in the viewer's frame.
 *
 * Coordinate spaces, from the server outwards:
 *   table coords (shared by everyone) -> view coords (rotated so you sit at the bottom)
 *   -> screen pixels (after the CSS 3D tilt; see projection.ts).
 */
export interface SeatGeom {
  seat: number;
  side: 'L' | 'T' | 'R';
  f: number;
  sv: SeatView;
  /** Centre and rotation of this seat's fan of cards, in view coords. */
  fan: { x: number; y: number; r: number };
  /** Space along the edge this seat can use. */
  room: number;
}

export interface Model {
  edge: Edge;
  /** Table size in table coords. */
  W: number;
  H: number;
  /** Table size as this viewer sees it. */
  VW: number;
  VH: number;
  CW: number;
  CH: number;
  sizeMul: number;
  others: SeatGeom[];
  toView: (x: number, y: number) => { x: number; y: number };
  toTable: (x: number, y: number) => { x: number; y: number };
}

export function buildModel(view: TableView): Model {
  const { tw: W, th: H, seats, size } = view.cfg;
  const { edge, others } = seatsForViewer(seats, view.you.seat);
  const { w: VW, h: VH } = viewSize(edge, W, H);
  const [CW, CH, sizeMul] = CARD_SIZES[size];
  const counts = { L: 0, T: 0, R: 0 };
  others.forEach((o) => counts[o.side]++);
  return {
    edge,
    W,
    H,
    VW,
    VH,
    CW,
    CH,
    sizeMul,
    toView: (x, y) => toView(edge, x, y, W, H),
    toTable: (x, y) => toTable(edge, x, y, W, H),
    others: others.map((o) => {
      const fan =
        o.side === 'T'
          ? { x: o.f * VW, y: 92, r: 180 }
          : o.side === 'L'
            ? { x: 92, y: o.f * VH, r: 90 }
            : { x: VW - 92, y: o.f * VH, r: -90 };
      const room = o.side === 'T' ? (VW - 120) / counts.T : (VH - 140) / counts[o.side];
      return { ...o, sv: view.seats[o.seat]!, fan, room };
    }),
  };
}

/** Screen position and scale for a seated sprite, just outside its table edge (from the prototype). */
export function seatScreenPos(L: Layout, m: Model, g: SeatGeom, crowd: boolean) {
  const mul = crowd ? 0.85 : 1;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  if (g.side === 'T') {
    const p = proj(L, g.f * m.VW, 0);
    const k = clamp(p.k * L.s * 1.3 * mul, 0.42, 1.35);
    return { x: p.x, y: p.y + 30 * k, k, depth: 0 };
  }
  const left = g.side === 'L';
  const p = proj(L, left ? 0 : m.VW, g.f * m.VH);
  const k = clamp(p.k * L.s * 1.35 * mul, 0.42, 1.4);
  const half = 40 * k;
  const x = clamp(left ? p.x - half + 16 * k : p.x + half - 16 * k, half * 0.6, L.SW - half * 0.6);
  return { x, y: p.y + 46 * k, k, depth: g.f };
}

/** A zone's outline size in the viewer's frame. Spreads run along the viewer's horizontal or vertical. */
export function zoneBox(z: ZoneView, m: Model) {
  const vertical = z.layout === 'spread' && (m.edge === 'L' || m.edge === 'R');
  if (z.layout === 'stack') return { w: m.CW + 22, h: m.CH + 22, vertical: false };
  return vertical ? { w: m.CH + 22, h: z.w, vertical } : { w: z.w, h: m.CH + 22, vertical };
}

/** Where each sent card of a zone sits inside the zone box, plus its rotation. */
export function zoneCardSpots(z: ZoneView, m: Model) {
  const box = zoneBox(z, m);
  const n = z.cards.length;
  if (z.layout === 'spread') {
    if (box.vertical) {
      const step = n > 1 ? Math.min(m.CH * 0.3, (box.h - 22 - m.CH) / (n - 1)) : 0;
      return z.cards.map((_, i) => ({ x: box.w / 2, y: 11 + m.CH / 2 + i * step, r: 0, depth: n - 1 - i }));
    }
    const step = n > 1 ? Math.min(m.CW * 0.55, (box.w - 22 - m.CW) / (n - 1)) : 0;
    return z.cards.map((_, i) => ({ x: 11 + m.CW / 2 + i * step, y: 11 + m.CH / 2, r: 0, depth: n - 1 - i }));
  }
  return z.cards.map((c, i) => {
    const depth = n - 1 - i;
    const j = c.j ?? [0, 0, 0];
    const o = offsetToView(m.edge, j[0], j[1]);
    // A group played together fans left to right in *your* view, whichever way the table is
    // turned, with each card far enough along to show the corner of the one beneath.
    const fanX = c.fan ? (c.fan[0] - (c.fan[1] - 1) / 2) * m.CW * 0.32 : 0;
    return {
      x: box.w / 2 + o.x + fanX,
      y: box.h / 2 + o.y + (z.messy ? 0 : Math.min(depth, 3) * 2),
      r: j[2],
      depth,
    };
  });
}

/**
 * The view as it will look once a table resize is applied, computed with the same clamps the
 * server uses. Shown while you drag the resize grip; only the final size is sent to the server.
 */
export function previewResize(view: TableView, nw: number, nh: number): TableView {
  const { cfg, dx, dy } = resizedConfig(view.cfg, nw, nh);
  return {
    ...view,
    cfg,
    zones: view.zones.map((z) => {
      const [x, y] = clampZone(cfg, z, z.x + dx, z.y + dy);
      return { ...z, x, y };
    }),
    loose: view.loose.map((c) => {
      const [x, y] = clampLoose(cfg, c.x + dx, c.y + dy);
      return { ...c, x, y };
    }),
    notes: view.notes.map((n) => {
      if (n.at.kind !== 'table') return n;
      const [x, y] = clampTableNote(cfg, n.at.x + dx, n.at.y + dy);
      return { ...n, at: { ...n.at, x, y } };
    }),
  };
}
