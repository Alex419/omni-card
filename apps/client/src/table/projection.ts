/**
 * The seated, tilted view. The table is a flat DOM plane transformed with
 *   perspective(P) at (px, py)  +  scale3d(s)  +  rotateX(TILT)
 * proj() maps a point on the plane (view coordinates) to screen pixels and unproj() inverts it.
 * Both must match the CSS transform in Table.tsx exactly, or clicks land in the wrong place.
 */
export const TILT = 40;
const RAD = (TILT * Math.PI) / 180;

export interface Layout {
  /** Plane size in view coordinates. */
  W: number;
  H: number;
  /** Scale, plane centre on screen, perspective origin and distance. */
  s: number;
  Ox: number;
  Oy: number;
  px: number;
  py: number;
  P: number;
  /** Scene size in pixels. */
  SW: number;
  SH: number;
  /** Hand card scale: screen pixels per sprite pixel. */
  hs: number;
  handH: number;
}

export function proj(L: Layout, u: number, v: number, s = L.s, Oy = L.Oy) {
  const U = s * (u - L.W / 2);
  const V = s * (v - L.H / 2);
  const X = L.Ox + U;
  const Y = Oy + V * Math.cos(RAD);
  const Z = V * Math.sin(RAD);
  const k = L.P / (L.P - Z);
  return { x: L.px + (X - L.px) * k, y: L.py + (Y - L.py) * k, k };
}

export function unproj(L: Layout, sx: number, sy: number) {
  const V = (L.P * (sy - L.py - (L.Oy - L.py))) / (L.P * Math.cos(RAD) + (sy - L.py) * Math.sin(RAD));
  const k = L.P / (L.P - V * Math.sin(RAD));
  const X = (sx - L.px) / k + L.px;
  return { x: (X - L.Ox) / L.s + L.W / 2, y: V / L.s + L.H / 2 };
}

/**
 * Find the largest scale at which the whole table fits between the toolbar and the hand,
 * leaving room for the side seats. Same search as the prototype: try scales from big to small,
 * and for each binary-search the vertical offset that centres the table.
 */
export function fit(SW: number, SH: number, W: number, H: number, sizeMul: number): Layout {
  const hs = (SW < 640 ? 2.2 : SH < 620 ? 2.6 : 3.2) * sizeMul;
  const handH = 35 * hs * 0.8;
  const L: Layout = {
    W,
    H,
    s: 0.25,
    Ox: SW / 2,
    Oy: SH / 2,
    px: SW / 2,
    py: SH * 0.22,
    P: Math.max(900, SH * 1.5),
    SW,
    SH,
    hs,
    handH,
  };
  const topPad = SW < 640 ? 100 : 136;
  const botLim = SH - handH * 0.5;
  const sideMax = SW - 20;
  const sideNeed = SW >= 900 ? 110 : SW >= 700 ? 70 : 0;
  for (let s = 1.6; s > 0.15; s -= 0.01) {
    const target = (topPad + botLim) / 2;
    let lo = -SH;
    let hi = 2 * SH;
    for (let i = 0; i < 32; i++) {
      const m = (lo + hi) / 2;
      const c = (proj(L, W / 2, 0, s, m).y + proj(L, W / 2, H, s, m).y) / 2;
      if (c < target) lo = m;
      else hi = m;
    }
    const Oy = (lo + hi) / 2;
    const top = proj(L, W / 2, 0, s, Oy).y;
    const bot = proj(L, W / 2, H, s, Oy).y;
    const wN = proj(L, W, H, s, Oy).x - proj(L, 0, H, s, Oy).x;
    if (
      top >= topPad - 1 &&
      bot <= botLim + 1 &&
      wN <= sideMax &&
      proj(L, 0, H * 0.47, s, Oy).x >= sideNeed
    ) {
      L.s = s;
      L.Oy = Oy;
      return L;
    }
  }
  return L;
}

/** The CSS that places the plane so that proj() is true. */
export function planeStyle(L: Layout) {
  return {
    width: L.W,
    height: L.H,
    left: L.Ox - L.W / 2,
    top: L.Oy - L.H / 2,
    transform: `scale3d(${L.s},${L.s},${L.s}) rotateX(${TILT}deg)`,
  };
}
