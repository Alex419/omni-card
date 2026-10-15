import { LIMITS, mulberry32, type FeedEntry, type ServerMessage, type TableView } from '@omni/shared';
import { describe, expect, it } from 'vitest';
import { cleanName, Room, type Peer } from '../src/room';

class FakePeer implements Peer {
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  /** Every feed line received since the last reset. */
  get feed(): FeedEntry[] {
    let out: FeedEntry[] = [];
    for (const m of this.inbox) if (m.t === 'feed') out = m.reset ? [...m.entries] : [...out, ...m.entries];
    return out;
  }
  get view(): TableView {
    const last = [...this.inbox].reverse().find((m) => m.t === 'view');
    if (!last || last.t !== 'view') throw new Error('no view yet');
    return last.view;
  }
}

function room() {
  let now = 1_000_000;
  const r = new Room('ABCDE', mulberry32(3), () => now);
  return { r, tick: (ms: number) => (now += ms) };
}

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

describe('Room', () => {
  it('lets players join, pick seats and play', () => {
    const { r } = room();
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'maya', TOKEN_B);
    expect(a.inbox[0]).toMatchObject({ t: 'welcome', room: 'ABCDE' });
    expect(a.view.you.seat).toBe(0);
    expect(r.sit(b, 0)).toBe('THAT SEAT IS TAKEN');
    expect(r.sit(b, 2)).toBeNull();
    expect(r.intent(a, { type: 'deal', count: 5 })).toBeNull();
    // Each player sees only their own hand.
    expect(a.view.hand).toHaveLength(5);
    expect(b.view.hand).toHaveLength(5);
    expect(a.view.hand!.map((c) => c.vid)).not.toEqual(b.view.hand!.map((c) => c.vid));
    expect(JSON.stringify(a.view)).not.toContain(b.view.hand![0]!.vid);
    expect(a.view.seats[2]).toMatchObject({ handCount: 5, player: { name: 'MAYA' } });
  });

  it('seats whoever opens an empty table; later players pick a seat', () => {
    const { r } = room();
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'maya', TOKEN_B);
    expect(a.view.you.seat).toBe(0);
    expect(b.view.you.seat).toBeNull();
  });

  it('does not let spectators play', () => {
    const { r } = room();
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'maya', TOKEN_B);
    expect(r.intent(b, { type: 'deal', count: 1 })).toBe('TAKE A SEAT TO PLAY');
  });

  it('puts a reconnecting player back in their seat with their hand', () => {
    const { r } = room();
    const a = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.sit(a, 1);
    r.intent(a, { type: 'deal', count: 3 });
    const hand = a.view.hand;
    r.leave(a);
    expect(r.game.players[0]).toMatchObject({ connected: false, seat: 1 });

    const again = new FakePeer();
    r.join(again, 'whatever', TOKEN_A);
    expect(again.view.you).toMatchObject({ name: 'ALEX', seat: 1 });
    expect(again.view.hand).toEqual(hand);
  });

  it('keeps an away player’s seat for a while, then lets someone else take it', () => {
    const { r, tick } = room();
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'maya', TOKEN_B);
    r.sit(a, 0);
    r.leave(a);
    expect(r.sit(b, 0)).toBe('THAT SEAT IS TAKEN');
    tick(LIMITS.seatReclaimMs);
    expect(r.sit(b, 0)).toBeNull();
    expect(r.game.players.find((p) => p.name === 'ALEX')!.seat).toBeNull();
  });

  it('removes spectators who leave, and dedupes names', () => {
    const { r } = room();
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'Alex', TOKEN_B);
    expect(b.view.you.name).toBe('ALEX 2');
    r.leave(b);
    expect(r.game.players.map((p) => p.name)).toEqual(['ALEX']);
  });

  it('announces undo to everyone', () => {
    const { r } = room();
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'maya', TOKEN_B);
    r.sit(a, 0);
    r.sit(b, 1);
    r.intent(a, { type: 'deal', count: 2 });
    r.intent(b, { type: 'undo' });
    const last = a.inbox.findLast((m) => m.t === 'view')!;
    expect(last.t === 'view' && last.events).toEqual([
      { type: 'log', by: 1, text: "UNDID ALEX'S DEAL 2", sfx: 'flip' },
    ]);
  });

  it('cleans names down to what the pixel font can draw', () => {
    expect(cleanName('  zoë <script>  ')).toBe('ZO SCRIPT');
    expect(cleanName('🙂')).toBe('PLAYER');
  });

  it('reports analytics: one game start, and totals when the room ends', () => {
    const events: { name: string; props?: Record<string, unknown> }[] = [];
    let now = 0;
    const r = new Room('ABCDE', mulberry32(1), () => now, {
      track: (name, fields) => events.push({ name, props: fields?.props }),
      pseudonym: (t) => `x${t.length}`,
    });
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'maya', TOKEN_B);
    r.sit(b, 1);
    r.intent(a, { type: 'deal', count: 2 });
    r.intent(a, { type: 'deal', count: 2 });
    now = 30 * 60_000;
    r.intent(b, { type: 'shuffleZone' });
    r.end('idle');
    r.end('idle'); // only reported once
    expect(events.map((e) => e.name)).toEqual([
      'player_joined',
      'player_joined',
      'game_started',
      'room_ended',
    ]);
    expect(events[2]!.props).toEqual({ seated: 2 });
    expect(events[3]!.props).toEqual({
      minutes: 30,
      peakSeated: 2,
      players: 2,
      actions: 3,
      started: true,
      reason: 'idle',
    });
  });

  it('keeps a feed of moves and chat that everyone gets, and replays it to a reconnecting player', () => {
    const { r } = room();
    const a = new FakePeer();
    const b = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(b, 'maya', TOKEN_B);
    r.sit(b, 1);
    r.intent(a, { type: 'deal', count: 2 });
    expect(r.chat(b, '  nice   deal \u0007 ')).toBeNull();
    const lines = (p: FakePeer) => p.feed.map((e) => [e.kind, e.by, e.text]);
    for (const p of [a, b])
      expect(lines(p).slice(-3)).toEqual([
        ['notice', null, 'MAYA SAT DOWN'],
        ['move', 'ALEX', 'DEALT 2 EACH'],
        ['chat', 'MAYA', 'nice deal'],
      ]);
    // A refreshed tab gets the whole recent feed back.
    r.leave(b);
    const b2 = new FakePeer();
    r.join(b2, 'maya', TOKEN_B);
    expect(lines(b2).slice(-4, -1)).toEqual(lines(a).slice(-4, -1));
  });

  it('lets spectators chat, and rate-limits floods', () => {
    const { r, tick } = room();
    const a = new FakePeer();
    const s = new FakePeer();
    r.join(a, 'alex', TOKEN_A);
    r.join(s, 'sam', TOKEN_B);
    expect(s.view.you.seat).toBeNull();
    const sent = Array.from({ length: 7 }, (_, i) => r.chat(s, `hi ${i}`));
    expect(sent.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(sent[5]).toBe('SLOW DOWN A LITTLE');
    tick(2000);
    expect(r.chat(s, 'ok now')).toBeNull();
    expect(a.feed.filter((e) => e.kind === 'chat').map((e) => e.text)).toEqual([
      'hi 0',
      'hi 1',
      'hi 2',
      'hi 3',
      'hi 4',
      'ok now',
    ]);
  });
});
