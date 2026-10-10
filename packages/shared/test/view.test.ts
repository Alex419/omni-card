import { describe, expect, it } from 'vitest';
import { faceOf } from '../src/cards';
import type { Intent } from '../src/protocol';
import { applyIntent } from '../src/reducer';
import { mulberry32, pick, type Rng } from '../src/rng';
import type { GameState } from '../src/state';
import type { Zone } from '../src/state';
import { viewFor, type TableView } from '../src/view';
import { act, ctx, deckOf, player, setup } from './helpers';

/**
 * Redaction is the most important correctness property in the app: a player who opens dev tools
 * must learn nothing a player at a real table couldn't see. These tests check it two ways:
 * targeted scenarios, and a fuzz run that checks every invariant after every random intent.
 */

interface Truth {
  /** Card ids this viewer may see the face of. */
  visible: Set<string>;
  /** Card ids this viewer must not be able to identify. */
  hidden: Set<string>;
  /** Tags of hidden cards that may appear in vids. */
  tags: Set<string>;
}

/**
 * The visibility rule, written out again independently of src/view.ts on purpose: if the test
 * reused the implementation's helper, a bug there would make the test agree with the bug.
 */
function canSee(z: Zone, i: number): boolean {
  const c = z.cards[i]!;
  const messy =
    z.layout === 'stack' &&
    z.cards.length > 1 &&
    z.cards.some((q) => q.fan || (q.j && q.j.some((v) => v !== 0)));
  return c.up && (z.layout === 'spread' || messy || i === z.cards.length - 1);
}

function truthFor(game: GameState, seat: number | null): Truth {
  const visible = new Set<string>();
  const hidden = new Set<string>();
  const tags = new Set<string>();
  game.table.hands.forEach((hand, s) => hand.forEach((id) => (s === seat ? visible : hidden).add(id)));
  for (const l of game.table.loose) {
    if (l.up) visible.add(l.id);
    else {
      hidden.add(l.id);
      tags.add(l.tag);
    }
  }
  for (const z of game.table.zones) {
    z.cards.forEach((c, i) => {
      if (canSee(z, i)) visible.add(c.id);
      else {
        hidden.add(c.id);
        tags.add(c.tag);
      }
    });
  }
  return { visible, hidden, tags };
}

/** Every card-like object in a view. Other players' hands deliberately contribute nothing. */
function cardsIn(view: TableView) {
  return [...(view.hand ?? []), ...view.loose, ...view.zones.flatMap((z) => z.cards)];
}

function assertRedacted(game: GameState, playerId: string) {
  const view = viewFor(game, playerId, 0);
  const seat = game.players.find((p) => p.id === playerId)!.seat;
  const truth = truthFor(game, seat);
  const json = JSON.stringify(view);

  // 1. No hidden card's real id appears anywhere in the payload, not even inside another string.
  //    (Ids are upper-case with a dot, tags are lower-case base-36, so they can't collide.)
  for (const id of truth.hidden) expect(json, `leaked ${id} to ${playerId}`).not.toContain(id);

  // 2. Each face appears no more often than cards with that face are visible to this viewer.
  //    (With several decks a face like "AS" can legitimately appear more than once.)
  const allowed = new Map<string, number>();
  for (const id of truth.visible) allowed.set(faceOf(id), (allowed.get(faceOf(id)) ?? 0) + 1);
  for (const c of cardsIn(view)) {
    if (!c.face) continue;
    const left = allowed.get(c.face) ?? 0;
    expect(left, `${playerId} sees one ${c.face} too many`).toBeGreaterThan(0);
    allowed.set(c.face, left - 1);
  }

  // 3. Every vid is either a visible card's id or an opaque tag of a hidden card.
  for (const c of cardsIn(view)) {
    if (c.face) expect(truth.visible.has(c.vid)).toBe(true);
    else {
      expect(c.vid.startsWith('h')).toBe(true);
      expect(truth.tags.has(c.vid.slice(1))).toBe(true);
    }
  }

  // 4. Other players' hands: count and back colors only.
  for (const s of view.seats) {
    expect(Object.keys(s).sort()).toEqual(['handBacks', 'handCount', 'open', 'player', 'score', 'seat']);
    expect(s.handBacks.every((b) => typeof b === 'number')).toBe(true);
    expect(s.handCount).toBe(game.table.hands[s.seat]!.length);
  }
  if (seat === null) expect(view.hand).toBeNull();

  // 5. Server-only fields never leave: tags (outside vids), history snapshots, tokens.
  expect(json).not.toMatch(/"(tag|table|history|token|awaySince)"/);
}

describe('viewFor redaction', () => {
  it('shows your hand, and only counts and back colors of other hands', () => {
    const { game, rng } = setup(3);
    const g = act(game, 0, { type: 'deal', count: 5 }, rng).game;
    const view = viewFor(g, 'p0', 0);
    expect(view.hand!.map((c) => c.vid)).toEqual(g.table.hands[0]);
    expect(view.seats[1]).toEqual({
      seat: 1,
      player: { id: 'p1', name: 'MAYA', connected: true },
      open: false,
      handCount: 5,
      handBacks: [0, 0, 0, 0, 0],
      score: 0,
    });
    for (const p of g.players) assertRedacted(g, p.id);
  });

  it('never sends deck order: a 52-card pile sends only its top few cards, face down', () => {
    const { game } = setup(2);
    const deck = viewFor(game, 'p0', 0).zones.find((z) => z.deck)!;
    expect(deck.count).toBe(52);
    expect(deck.cards).toHaveLength(4);
    expect(deck.cards.every((c) => c.face === null && c.vid.startsWith('h'))).toBe(true);
  });

  it('shows only the top face of a neat face-up pile', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'updateZone', id: 'z1', face: 'up' }, rng).game;
    g = act(g, 0, { type: 'updateZone', id: 'z1', mess: false }, rng).game;
    const cards = viewFor(g, 'p1', 0).zones[0]!.cards;
    expect(cards.map((c) => c.face !== null)).toEqual([false, false, false, true]);
    assertRedacted(g, 'p1');
  });

  it('gives hidden cards new ids after a shuffle, so they cannot be tracked', () => {
    const { game, rng } = setup(2);
    const before = new Set(viewFor(game, 'p0', 0).zones[0]!.cards.map((c) => c.vid));
    const g = act(game, 1, { type: 'shuffleZone' }, rng).game;
    const after = viewFor(g, 'p0', 0).zones[0]!.cards.map((c) => c.vid);
    for (const vid of after) expect(before.has(vid)).toBe(false);
    // Every tag in the pile changed, not just the ones on top.
    const oldTags = new Set(game.table.zones[0]!.cards.map((c) => c.tag));
    expect(g.table.zones[0]!.cards.some((c) => oldTags.has(c.tag))).toBe(false);
  });

  it('gives a card a new id when it leaves a hand, so you can’t tell which card was played', () => {
    const { game, rng } = setup(2);
    // Seat 0 deals one each. Seat 1 is first, so it gets the top card, which seat 0 could see by vid.
    const topVid = viewFor(game, 'p0', 0).zones[0]!.cards.at(-1)!.vid;
    let g = act(game, 0, { type: 'deal', count: 1 }, rng).game;
    const card = g.table.hands[1]![0]!;
    g = act(
      g,
      1,
      {
        type: 'moveCards',
        from: { kind: 'hand' },
        vids: [card],
        to: { kind: 'table', x: 500, y: 300 },
        up: false,
      },
      rng,
    ).game;
    const seen = viewFor(g, 'p0', 0).loose[0]!;
    expect(seen.face).toBeNull();
    expect(seen.vid).not.toBe(topVid);
    assertRedacted(g, 'p0');
  });

  it('with matching backs, nothing tells which deck a hidden card came from', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'setDecks', decks: 2, jokers: false }, rng).game;
    g = act(g, 0, { type: 'setBacks', backs: [1, 1] }, rng).game;
    g = act(g, 0, { type: 'deal', count: 8 }, rng).game;
    const view = viewFor(g, 'p1', 0);
    const backs = [
      ...view.zones.flatMap((z) => z.cards.map((c) => c.back)),
      ...view.seats.flatMap((s) => s.handBacks),
    ];
    expect(new Set(backs)).toEqual(new Set([1]));
    // Both decks really are in play, so this is the redaction at work, not luck.
    expect(new Set(g.table.hands.flat().map((id) => id.split('.')[1]))).toEqual(new Set(['0', '1']));
    assertRedacted(g, 'p1');
  });

  it('will not resolve a guessed real id for a hidden card', () => {
    const { game, rng } = setup(2);
    const topId = deckOf(game).cards.at(-1)!.id;
    const r = applyIntent(
      game,
      { type: 'moveCards', from: { kind: 'zone', id: 'z1' }, vids: [topId], to: { kind: 'hand' } },
      ctx(game, 0, rng),
    );
    expect(r).toEqual({ ok: false, error: 'THOSE CARDS MOVED' });
  });

  it('will not resolve cards buried below what you were shown', () => {
    const { game, rng } = setup(2);
    const buried = `h${deckOf(game).cards[0]!.tag}`;
    const r = applyIntent(
      game,
      { type: 'moveCards', from: { kind: 'zone', id: 'z1' }, vids: [buried], to: { kind: 'hand' } },
      ctx(game, 0, rng),
    );
    expect(r.ok).toBe(false);
  });

  it('gives spectators no hand and no hand identities', () => {
    const { game, rng } = setup(2);
    const g = act(game, 0, { type: 'deal', count: 5 }, rng).game;
    g.players.push(player(null, 7));
    const view = viewFor(g, 'p7', 0);
    expect(view.hand).toBeNull();
    expect(view.spectators.map((s) => s.name)).toEqual(['KAI']);
    assertRedacted(g, 'p7');
  });
});

/* ---------- fuzz: random play, check every invariant for every viewer after every step ---------- */

function randomIntent(game: GameState, seat: number, rng: Rng): Intent {
  const view = viewFor(game, `p${seat}`, 0);
  const W = view.cfg.tw;
  const H = view.cfg.th;
  const xy = () => ({ x: Math.round(rng() * W), y: Math.round(rng() * H) });
  const zone = view.zones.length ? pick(rng, view.zones) : null;
  const target = () =>
    pick(rng, [
      { kind: 'hand' as const },
      { kind: 'seat' as const, seat: Math.floor(rng() * view.seats.length) },
      { kind: 'table' as const, ...xy() },
      ...(zone ? [{ kind: 'zone' as const, id: zone.id, ...xy() }] : []),
    ]);
  const options: (() => Intent | null)[] = [
    () => ({ type: 'deal', count: 1 + Math.floor(rng() * 3) }),
    () =>
      view.hand?.length
        ? {
            type: 'moveCards',
            from: { kind: 'hand' },
            vids: [pick(rng, view.hand).vid],
            to: target(),
            up: rng() < 0.5,
          }
        : null,
    () =>
      view.loose.length
        ? { type: 'moveCards', from: { kind: 'loose' }, vids: [pick(rng, view.loose).vid], to: target() }
        : null,
    () => {
      const z = view.zones.find((q) => q.cards.length);
      return z
        ? {
            type: 'moveCards',
            from: { kind: 'zone', id: z.id },
            vids: [z.cards.at(-1)!.vid],
            to: target(),
            up: rng() < 0.5,
          }
        : null;
    },
    () =>
      view.loose.length
        ? { type: 'flipCards', from: { kind: 'loose' }, vids: [pick(rng, view.loose).vid] }
        : null,
    () =>
      zone?.cards.length
        ? { type: 'flipCards', from: { kind: 'zone', id: zone.id }, vids: [zone.cards.at(-1)!.vid] }
        : null,
    () => (zone ? { type: 'shuffleZone', id: zone.id } : null),
    () => (zone ? { type: 'flipZone', id: zone.id } : null),
    () => (zone ? { type: 'updateZone', id: zone.id, face: rng() < 0.5 ? 'up' : 'down' } : null),
    () => (zone ? { type: 'updateZone', id: zone.id, layout: rng() < 0.5 ? 'stack' : 'spread' } : null),
    () => (zone ? { type: 'updateZone', id: zone.id, mess: rng() < 0.5 } : null),
    () => (view.loose.length > 1 ? { type: 'pileUp', vids: view.loose.slice(0, 3).map((l) => l.vid) } : null),
    () => ({ type: 'createZone', ...xy() }),
    () => (rng() < 0.1 && zone ? { type: 'deleteZone', id: zone.id } : null),
    () => (rng() < 0.05 ? { type: 'collect' } : null),
    () => (rng() < 0.1 ? { type: 'setBacks', backs: [Math.floor(rng() * 4), Math.floor(rng() * 4)] } : null),
    () => (rng() < 0.03 ? { type: 'setDecks', decks: 1 + Math.floor(rng() * 2), jokers: rng() < 0.5 } : null),
    () => ({ type: 'undo' }),
  ];
  for (;;) {
    const intent = pick(rng, options)();
    if (intent) return intent;
  }
}

describe('redaction fuzz', () => {
  it.each([1, 2, 3, 4, 5])('holds after every step of a random 4-player game (seed %i)', (seed) => {
    const { game } = setup(4, {}, seed);
    game.players.push(player(null, 7));
    const rng = mulberry32(seed * 7919);
    let g = game;
    let applied = 0;
    for (let step = 0; step < 150; step++) {
      const seat = Math.floor(rng() * 4);
      const r = applyIntent(g, randomIntent(g, seat, rng), ctx(g, seat, rng));
      if (!r.ok) continue;
      g = r.game;
      applied++;
      for (const p of g.players) assertRedacted(g, p.id);
    }
    expect(applied).toBeGreaterThan(100);
  });
});
