import { CARD_SIZES, LIMITS } from './constants';
import type { TableConfig, Zone } from './state';

/**
 * Where things are allowed to sit on the table. Shared so the client can preview a change
 * (like resizing the table while you drag) and land exactly where the server will put it.
 */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function clampLoose(cfg: TableConfig, x: number, y: number): [number, number] {
  const [cw, ch] = CARD_SIZES[cfg.size];
  return [
    Math.round(clamp(x, 26 + cw / 2, cfg.tw - 26 - cw / 2)),
    Math.round(clamp(y, 26 + ch / 2, cfg.th - 26 - ch / 2)),
  ];
}

export function clampZone(
  cfg: TableConfig,
  z: Pick<Zone, 'layout' | 'w'>,
  x: number,
  y: number,
): [number, number] {
  const half = z.layout === 'spread' ? Math.min(z.w / 2 + 26, cfg.tw / 2) : 80;
  return [Math.round(clamp(x, half, cfg.tw - half)), Math.round(clamp(y, 90, cfg.th - 80))];
}

export const clampTableNote = (cfg: TableConfig, x: number, y: number): [number, number] => [
  Math.round(clamp(x, 80, cfg.tw - 80)),
  Math.round(clamp(y, 80, cfg.th - 80)),
];

/**
 * A resized table: the new size (within limits) and how far everything shifts so it stays centred.
 * Callers then re-clamp each item against the new config.
 */
export function resizedConfig(cfg: TableConfig, nw: number, nh: number) {
  const tw = Math.round(clamp(nw, LIMITS.tableMinW, LIMITS.tableMaxW));
  const th = Math.round(clamp(nh, LIMITS.tableMinH, LIMITS.tableMaxH));
  return { cfg: { ...cfg, tw, th }, dx: (tw - cfg.tw) / 2, dy: (th - cfg.th) / 2 };
}
