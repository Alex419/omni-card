import { BACK_COUNT, LOOKS, RANKS, SUITS } from '@omni/shared';
import { backURL, blankURL, faceURL, mysteryURL, pipURL } from './cards';
import { canvas, blit } from './canvas';
import { BACKS, PAL } from './palette';
import { personURL } from './people';

/**
 * Generates every sprite once and installs them as CSS classes (.c-AS, .c-b0, .av-3, .felt ...).
 * Cards then render as plain divs with a class, which is cheap for React to update.
 */

function tileURL(w: number, h: number, base: string, dots: [string, number[][]][]): string {
  const [c, x] = canvas(w, h);
  x.fillStyle = base;
  x.fillRect(0, 0, w, h);
  dots.forEach(([col, pts]) => {
    x.fillStyle = col;
    pts.forEach(([a, b, ww = 1, hh = 1]) => x.fillRect(a!, b!, ww, hh));
  });
  return c.toDataURL();
}

/** 7x7 pixel cog for the zone settings button. */
function cogURL(): string {
  const [c, x] = canvas(7, 7);
  blit(x, ['..#.#..', '.#####.', '##...##', '.#.#.#.', '##...##', '.#####.', '..#.#..'], 0, 0, PAL.paper);
  return c.toDataURL();
}

/** 5x5 grip: a centred 3x3 grid of dots for dragging a zone. */
function gripURL(): string {
  const [c, x] = canvas(5, 5);
  blit(x, ['#.#.#', '.....', '#.#.#', '.....', '#.#.#'], 0, 0, PAL.paper);
  return c.toDataURL();
}

/** 11x9 speaker: a solid speaker with the classic two sound waves when on, or an X when muted. */
const SPEAKER = [
  '....#......',
  '...##......',
  '#####......',
  '#####......',
  '#####......',
  '#####......',
  '#####......',
  '...##......',
  '....#......',
];
function speakerURL(on: boolean): string {
  const [c, x] = canvas(11, 9);
  blit(x, SPEAKER, 0, 0, PAL.paper);
  if (on)
    blit(
      x,
      [
        '........#..',
        '.........#.',
        '......#...#',
        '.......#..#',
        '.......#..#',
        '.......#..#',
        '......#...#',
        '.........#.',
        '........#..',
      ],
      0,
      0,
      PAL.gold,
    );
  else
    blit(
      x,
      [
        '...........',
        '...........',
        '......#...#',
        '.......#.#.',
        '........#..',
        '.......#.#.',
        '......#...#',
        '...........',
        '...........',
      ],
      0,
      0,
      PAL.red,
    );
  return c.toDataURL();
}

/** 11x10 open hand for the hand menu button. */
function handURL(): string {
  const [c, x] = canvas(11, 10);
  blit(
    x,
    [
      '....#......',
      '..#.#.#....',
      '..#.#.#.#..',
      '..#.#.#.#..',
      '..#######..',
      '#.#######..',
      '##########.',
      '.#########.',
      '..#######..',
      '...#####...',
    ],
    0,
    0,
    PAL.paper,
  );
  return c.toDataURL();
}

let installed = false;
export function installSpriteSheet() {
  if (installed) return;
  installed = true;
  let css = '';
  for (const s of SUITS) for (const r of RANKS) css += `.c-${r}${s}{background-image:url(${faceURL(r, s)})}`;
  css += `.c-JR{background-image:url(${faceURL('R', 'X')})}.c-JB{background-image:url(${faceURL('B', 'X')})}`;
  for (let i = 0; i < BACK_COUNT; i++) css += `.c-b${i}{background-image:url(${backURL(BACKS[i]!)})}`;
  css += `.c-blank{background-image:url(${blankURL()})}.c-q{background-image:url(${mysteryURL()})}`;
  css += `.felt{background-image:url(${tileURL(8, 8, PAL.felt, [
    [
      PAL.feltD,
      [
        [1, 1],
        [5, 3],
        [3, 6],
        [7, 7],
      ],
    ],
    [
      PAL.feltL,
      [
        [6, 1],
        [2, 4],
      ],
    ],
  ])})}`;
  css += `.wood{background-image:url(${tileURL(16, 8, PAL.wood, [
    [
      PAL.woodD,
      [
        [0, 3, 16, 1],
        [0, 7, 16, 1],
        [11, 0, 1, 3],
        [4, 4, 1, 3],
      ],
    ],
    [
      PAL.woodL,
      [
        [2, 1],
        [9, 5],
        [13, 1],
        [6, 5],
      ],
    ],
  ])})}`;
  LOOKS.forEach((look, seat) => (css += `.av-${seat}{background-image:url(${personURL(look)})}`));
  css += `.i-cog{background-image:url(${cogURL()})}.i-grip{background-image:url(${gripURL()})}`;
  css += `.i-snd-on{background-image:url(${speakerURL(true)})}.i-snd-off{background-image:url(${speakerURL(false)})}`;
  css += `.i-hand{background-image:url(${handURL()})}`;
  for (const s of SUITS) css += `.pip-${s}{background-image:url(${pipURL(s)})}`;
  css += `.pip-JR{background-image:url(${pipURL('X', true)})}.pip-JB{background-image:url(${pipURL('X')})}`;
  const el = document.createElement('style');
  el.dataset.sprites = '';
  el.textContent = css;
  document.head.appendChild(el);
}

/** CSS class that draws a card: its face if visible, otherwise its back. */
export const cardClass = (face: string | null, back: number) => (face ? `c-${face}` : `c-b${back}`);
