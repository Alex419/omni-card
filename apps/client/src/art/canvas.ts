/** Tiny helpers for drawing 1-bit glyph bitmaps onto a canvas, pixel by pixel. */
export type Ctx2D = CanvasRenderingContext2D;

export function canvas(w: number, h: number): [HTMLCanvasElement, Ctx2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Draw a bitmap given as rows of '1'/'#' (on) and anything else (off). */
export function blit(x: Ctx2D, rows: readonly string[], ox: number, oy: number, col: string, sc = 1) {
  x.fillStyle = col;
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++)
      if (r[i] === '1' || r[i] === '#') x.fillRect(ox + i * sc, oy + j * sc, sc, sc);
  });
}

export function px(x: Ctx2D, a: number, b: number, col: string, w = 1, h = 1) {
  x.fillStyle = col;
  x.fillRect(a, b, w, h);
}
