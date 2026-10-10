import { describe, expect, it } from 'vitest';
import { allCardIds } from '../src/cards';
import { applyIntent } from '../src/reducer';
import type { GameState } from '../src/state';
import { viewFor } from '../src/view';
import { act, ctx, deckOf, deepFreeze, setup } from './helpers';

/** Every card is somewhere exactly once. The reducer must never create or lose a card. */
function allCards(game: GameState): string[] {
  const t = game.table;
  return [
    ...t.hands.flat(),
    ...t.loose.map((c) => c.id),
    ...t.zones.flatMap((z) => z.cards.map((c) => c.id)),
  ].sort();
}

describe('applyIntent basics', () => {
  it('never mutates the input state', () => {
    const { game, rng } = setup(3);
    deepFreeze(game);
    expect(() => act(game, 0, { type: 'deal', count: 5 }, rng)).not.toThrow();
    expect(() => act(game, 0, { type: 'shuffleZone' }, rng)).not.toThrow();
    expect(() => act(game, 0, { type: 'collect' }, rng)).not.toThrow();
  });

  it('rejects instead of throwing for bad references', () => {
    const { game, rng } = setup(2);
    const r = applyIntent(game, { type: 'tidyZone', id: 'nope' }, ctx(game, 0, rng));
    expect(r).toEqual({ ok: false, error: 'THAT ZONE IS GONE' });
  });
});

describe('deal', () => {
  it('deals clockwise from the dealer’s left, dealer last, to occupied seats only', () => {
    const { game, rng } = setup(3, { seats: 5 });
    const topThree = deckOf(game)
      .cards.slice(-3)
      .map((c) => c.id)
      .reverse();
    const { game: g } = act(game, 1, { type: 'deal', count: 5 }, rng);
    expect(g.table.hands.slice(0, 5).map((h) => h.length)).toEqual([5, 5, 5, 0, 0]);
    // Dealer is seat 1, so seat 2 gets the first card, then seat 0, then the dealer.
    expect(g.table.hands[2]![0]).toBe(topThree[0]);
    expect(g.table.hands[0]![0]).toBe(topThree[1]);
    expect(g.table.hands[1]![0]).toBe(topThree[2]);
    expect(deckOf(g).cards).toHaveLength(52 - 15);
    expect(allCards(g)).toEqual(allCardIds(1, false).sort());
  });

  it('stops when the deck runs out', () => {
    const { game, rng } = setup(4);
    const r = act(game, 0, { type: 'deal', count: 26 }, rng);
    expect(deckOf(r.game).cards).toHaveLength(0);
    expect(r.events[0]).toMatchObject({ type: 'log', text: 'DEALT. THE DECK RAN OUT' });
    expect(applyIntent(r.game, { type: 'deal', count: 1 }, ctx(r.game, 0, rng))).toEqual({
      ok: false,
      error: 'THE DECK IS EMPTY',
    });
  });
});

describe('moving cards', () => {
  it('plays from hand to the table with the chosen face, and back', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'deal', count: 3 }, rng).game;
    const [a, b] = g.table.hands[0]!;
    g = act(
      g,
      0,
      {
        type: 'moveCards',
        from: { kind: 'hand' },
        vids: [a!, b!],
        to: { kind: 'table', x: 500, y: 300 },
        up: false,
      },
      rng,
    ).game;
    expect(g.table.hands[0]).toHaveLength(1);
    expect(g.table.loose.map((l) => [l.id, l.up])).toEqual([
      [a, false],
      [b, false],
    ]);
    // Face down, so the player picks them up by their opaque vids.
    const vids = viewFor(g, 'p0', 0).loose.map((l) => l.vid);
    expect(vids.every((v) => v.startsWith('h'))).toBe(true);
    g = act(g, 0, { type: 'moveCards', from: { kind: 'loose' }, vids, to: { kind: 'hand' } }, rng).game;
    expect(g.table.hands[0]).toHaveLength(3);
    expect(g.table.loose).toHaveLength(0);
  });

  it('gives cards to another seat and logs it', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'deal', count: 2 }, rng).game;
    const card = g.table.hands[0]![0]!;
    const r = act(
      g,
      0,
      { type: 'moveCards', from: { kind: 'hand' }, vids: [card], to: { kind: 'seat', seat: 1 } },
      rng,
    );
    g = r.game;
    expect(g.table.hands[1]).toContain(card);
    expect(r.events).toContainEqual({ type: 'log', by: 0, text: 'GAVE 1 CARD TO MAYA', sfx: 'give' });
  });

  it('lands cards in a zone using the zone’s face and jitters messy piles', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'deal', count: 2 }, rng).game;
    const [a] = g.table.hands[0]!;
    g = act(
      g,
      0,
      {
        type: 'moveCards',
        from: { kind: 'hand' },
        vids: [a!],
        to: { kind: 'zone', id: 'z2', x: 600, y: 300 },
      },
      rng,
    ).game;
    const discard = g.table.zones.find((z) => z.id === 'z2')!;
    expect(discard.cards[0]).toMatchObject({ id: a, up: true });
    expect(discard.cards[0]!.j).not.toBeNull();
  });

  it('reorders your hand privately: no undo step, no event', () => {
    const { game, rng } = setup(2);
    const g = act(game, 0, { type: 'deal', count: 3 }, rng).game;
    const [a, b, c] = g.table.hands[0]!;
    const r = act(
      g,
      0,
      { type: 'moveCards', from: { kind: 'hand' }, vids: [a!], to: { kind: 'hand', index: 2 } },
      rng,
    );
    expect(r.game.table.hands[0]).toEqual([b, c, a]);
    expect(r.game.history).toHaveLength(g.history.length);
    expect(r.events).toEqual([]);
  });

  it('cannot take cards that are not in your hand', () => {
    const { game, rng } = setup(2);
    const g = act(game, 0, { type: 'deal', count: 2 }, rng).game;
    const theirs = g.table.hands[1]![0]!;
    const r = applyIntent(
      g,
      { type: 'moveCards', from: { kind: 'hand' }, vids: [theirs], to: { kind: 'hand' } },
      ctx(g, 0, rng),
    );
    expect(r.ok).toBe(false);
  });
});

describe('zones', () => {
  it('flips, shuffles, tidies and deletes', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'flipZone', id: 'z1' }, rng).game;
    expect(deckOf(g).cards.every((c) => c.up)).toBe(true);
    const before = deckOf(g).cards.map((c) => c.id);
    g = act(g, 0, { type: 'shuffleZone', id: 'z1' }, rng).game;
    const after = deckOf(g).cards.map((c) => c.id);
    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());
    g = act(g, 0, { type: 'deleteZone', id: 'z1' }, rng).game;
    expect(g.table.loose).toHaveLength(52);
    expect(g.table.zones.some((z) => z.id === 'z1')).toBe(false);
  });

  it('keeps at most one deck zone', () => {
    const { game, rng } = setup(2);
    const g = act(game, 0, { type: 'updateZone', id: 'z2', deck: true }, rng).game;
    expect(g.table.zones.filter((z) => z.deck).map((z) => z.id)).toEqual(['z2']);
  });

  it('turning a messy pile neat squares it up', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'deal', count: 3 }, rng).game;
    g = act(
      g,
      0,
      {
        type: 'moveCards',
        from: { kind: 'hand' },
        vids: g.table.hands[0]!,
        to: { kind: 'zone', id: 'z2', x: 0, y: 0 },
      },
      rng,
    ).game;
    expect(g.table.zones[1]!.cards.some((c) => c.j)).toBe(true);
    g = act(g, 0, { type: 'updateZone', id: 'z2', mess: false }, rng).game;
    expect(g.table.zones[1]!.cards.every((c) => c.j === null)).toBe(true);
  });

  it('creates a zone and tells its creator', () => {
    const { game, rng } = setup(2);
    const r = act(game, 1, { type: 'createZone', x: 5000, y: 300 }, rng);
    const z = r.game.table.zones.at(-1)!;
    expect(z.x).toBe(r.game.table.cfg.tw - 80);
    expect(r.events).toContainEqual({ type: 'zoneCreated', by: 1, id: z.id });
  });

  it('piles up loose cards into a new messy zone', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'deal', count: 3 }, rng).game;
    g = act(
      g,
      0,
      {
        type: 'moveCards',
        from: { kind: 'hand' },
        vids: g.table.hands[0]!,
        to: { kind: 'table', x: 400, y: 300 },
        up: true,
      },
      rng,
    ).game;
    const vids = viewFor(g, 'p0', 0).loose.map((l) => l.vid);
    g = act(g, 0, { type: 'pileUp', vids }, rng).game;
    expect(g.table.loose).toHaveLength(0);
    expect(g.table.zones.at(-1)).toMatchObject({ face: 'up', mess: true });
    expect(g.table.zones.at(-1)!.cards).toHaveLength(3);
  });
});

describe('table setup', () => {
  it('collect puts every card back in one shuffled deck', () => {
    const { game, rng } = setup(3);
    let g = act(game, 0, { type: 'deal', count: 5 }, rng).game;
    g = act(g, 0, { type: 'collect' }, rng).game;
    expect(g.table.hands.every((h) => h.length === 0)).toBe(true);
    expect(deckOf(g).cards).toHaveLength(52);
  });

  it('setDecks rebuilds the deck with the right cards', () => {
    const { game, rng } = setup(2);
    const g = act(game, 0, { type: 'setDecks', decks: 2, jokers: true }, rng).game;
    expect(deckOf(g).cards).toHaveLength(108);
    expect(allCards(g)).toEqual(allCardIds(2, true).sort());
  });

  it('will not remove an occupied seat; removing empty ones returns their cards', () => {
    const { game, rng } = setup(3, { seats: 6 });
    expect(applyIntent(game, { type: 'setSeats', count: 2 }, ctx(game, 0, rng)).ok).toBe(false);
    let g = act(
      game,
      0,
      {
        type: 'moveCards',
        from: { kind: 'zone', id: 'z1' },
        vids: [viewFor(game, 'p0', 0).zones[0]!.cards.at(-1)!.vid],
        to: { kind: 'seat', seat: 5 },
      },
      rng,
    ).game;
    expect(g.history).toHaveLength(1);
    g = act(g, 0, { type: 'setSeats', count: 4 }, rng).game;
    expect(g.table.cfg.seats).toBe(4);
    expect(g.table.hands[5]).toEqual([]);
    expect(deckOf(g).cards).toHaveLength(52);
    expect(g.history).toHaveLength(0);
  });

  it('resizing clamps the size and keeps things on the table', () => {
    const { game, rng } = setup(2);
    const g = act(game, 0, { type: 'resizeTable', tw: 99_999, th: 1 }, rng).game;
    expect([g.table.cfg.tw, g.table.cfg.th]).toEqual([1800, 500]);
    for (const z of g.table.zones) expect(z.y).toBeLessThanOrEqual(500 - 80);
  });

  it('keeps score per seat', () => {
    const { game, rng } = setup(2);
    const g = act(
      act(game, 0, { type: 'score', seat: 1, delta: 5 }, rng).game,
      1,
      { type: 'score', seat: 1, delta: -1 },
      rng,
    ).game;
    expect(g.table.score[1]).toBe(4);
  });
});

describe('sticky notes', () => {
  it('sticking a note on someone makes them react', () => {
    const { game, rng } = setup(3);
    const r = act(
      game,
      0,
      {
        type: 'stickNote',
        text: ' kick  me ',
        color: 'pink',
        at: { kind: 'seat', seat: 2, x: 0.5, y: 0.99 },
      },
      rng,
    );
    expect(r.game.table.notes[0]).toMatchObject({ text: 'KICK ME', at: { kind: 'seat', seat: 2, y: 0.7 } });
    expect(r.events.find((e) => e.type === 'noteStuck')).toMatchObject({ by: 0, on: 2 });
  });

  it('refuses notes on empty seats and blank notes', () => {
    const { game, rng } = setup(2, { seats: 4 });
    expect(
      applyIntent(
        game,
        { type: 'stickNote', text: 'HI', color: 'yel', at: { kind: 'seat', seat: 3, x: 0.5, y: 0.5 } },
        ctx(game, 0, rng),
      ).ok,
    ).toBe(false);
    expect(
      applyIntent(
        game,
        { type: 'stickNote', text: '   ', color: 'yel', at: { kind: 'table', x: 1, y: 1 } },
        ctx(game, 0, rng),
      ).ok,
    ).toBe(false);
  });

  it('keeps only the newest notes on a person', () => {
    const { game, rng } = setup(2);
    let g = game;
    for (let i = 0; i < 9; i++)
      g = act(
        g,
        0,
        { type: 'stickNote', text: `N${i}`, color: 'yel', at: { kind: 'seat', seat: 1, x: 0.5, y: 0.5 } },
        rng,
      ).game;
    expect(g.table.notes.map((n) => n.text)).toEqual(['N3', 'N4', 'N5', 'N6', 'N7', 'N8']);
  });

  it('moves, edits and rips notes', () => {
    const { game, rng } = setup(2);
    let g = act(
      game,
      0,
      { type: 'stickNote', text: 'DEALER', color: 'yel', at: { kind: 'table', x: 300, y: 300 } },
      rng,
    ).game;
    const id = g.table.notes[0]!.id;
    const moved = act(g, 0, { type: 'moveNote', id, at: { kind: 'seat', seat: 1, x: 0.5, y: 0.5 } }, rng);
    expect(moved.events.some((e) => e.type === 'noteStuck')).toBe(true);
    g = act(moved.game, 1, { type: 'editNote', id, text: 'boss', color: 'blue' }, rng).game;
    expect(g.table.notes[0]).toMatchObject({ text: 'BOSS', color: 'blue' });
    g = act(g, 1, { type: 'ripNote', id }, rng).game;
    expect(g.table.notes).toHaveLength(0);
  });
});

describe('undo', () => {
  it('takes back the last step for everyone and says whose it was', () => {
    const { game, rng } = setup(2);
    const dealt = act(game, 0, { type: 'deal', count: 5 }, rng).game;
    expect(viewFor(dealt, 'p1', 0).undo).toEqual({ label: 'DEAL 5', by: 'ALEX' });
    const r = act(dealt, 1, { type: 'undo' }, rng);
    expect(r.game.table).toEqual(game.table);
    expect(r.events).toEqual([{ type: 'log', by: 1, text: "UNDID ALEX'S DEAL 5", sfx: 'flip' }]);
    expect(applyIntent(r.game, { type: 'undo' }, ctx(r.game, 1, rng))).toEqual({
      ok: false,
      error: 'NOTHING TO UNDO',
    });
  });

  it('merges a burst of renames into one step', () => {
    const { game, rng } = setup(2);
    let g = game;
    for (const [i, name] of ['D', 'DR', 'DRA', 'DRAW'].entries())
      g = act(g, 0, { type: 'updateZone', id: 'z2', name }, rng, 1000 + i * 500).game;
    expect(g.history).toHaveLength(1);
    g = act(g, 0, { type: 'undo' }, rng).game;
    expect(g.table.zones[1]!.name).toBe('DISCARD');
  });

  it('does not scramble the order players arranged their hands in', () => {
    const { game, rng } = setup(2);
    let g = act(game, 0, { type: 'deal', count: 3 }, rng).game;
    g = act(g, 1, { type: 'score', seat: 0, delta: 1 }, rng).game;
    const [a, b, c] = g.table.hands[0]!;
    g = act(
      g,
      0,
      { type: 'moveCards', from: { kind: 'hand' }, vids: [c!], to: { kind: 'hand', index: 0 } },
      rng,
    ).game;
    g = act(g, 1, { type: 'undo' }, rng).game;
    expect(g.table.score[0]).toBe(0);
    expect(g.table.hands[0]).toEqual([c, a, b]);
  });
});
