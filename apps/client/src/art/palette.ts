/** PICO-8-style palette used by every generated sprite. Mirrors the CSS custom properties in styles/base.css. */
export const PAL = {
  night: '#0e1325',
  ink: '#1d2b53',
  paper: '#fff1e8',
  shade: '#c2c3c7',
  red: '#ff004d',
  purple: '#7e2553',
  gold: '#ffec27',
  peach: '#ffccaa',
  felt: '#008751',
  feltD: '#00663d',
  feltL: '#00a05f',
  wood: '#ab5236',
  woodD: '#7a3a24',
  woodL: '#c4693f',
  mist: '#e4e2ec',
  pink: '#ff77a8',
  lilac: '#83769c',
} as const;

/** One card back per deck: base, border, pattern, emblem. */
export const BACKS: readonly [string, string, string, string][] = [
  ['#1d2b53', '#ff004d', '#7e2553', '#ffec27'],
  ['#7e2553', '#ffec27', '#ff77a8', '#fff1e8'],
  ['#ab5236', '#fff1e8', '#ffa300', '#1d2b53'],
  ['#5f574f', '#29adff', '#83769c', '#ffec27'],
];

export function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * f);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}
