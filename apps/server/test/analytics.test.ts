import { describe, expect, it } from 'vitest';
import { BufferedAnalytics, pseudonym, type AnalyticsRow } from '../src/analytics/analytics';

describe('pseudonym', () => {
  it('is stable for a token, different across tokens and secrets, and hides the token', () => {
    const token = 'f'.repeat(32);
    expect(pseudonym('s1', token)).toBe(pseudonym('s1', token));
    expect(pseudonym('s1', token)).not.toBe(pseudonym('s1', 'e'.repeat(32)));
    expect(pseudonym('s1', token)).not.toBe(pseudonym('s2', token));
    expect(pseudonym('s1', token)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('BufferedAnalytics', () => {
  it('writes in batches instead of once per event', async () => {
    const batches: AnalyticsRow[][] = [];
    const a = new BufferedAnalytics('test', async (rows) => void batches.push(rows), {
      batchSize: 3,
      intervalMs: 60_000,
    });
    a.track('room_created', { room: 'AAAAA' });
    a.track('player_joined', { room: 'AAAAA', player: 'p' });
    expect(batches).toHaveLength(0);
    a.track('game_started', { room: 'AAAAA', props: { seated: 2 } });
    await a.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((r) => r.name)).toEqual(['room_created', 'player_joined', 'game_started']);
    await a.close();
  });

  it('keeps events when a write fails and sends them on the next try', async () => {
    let fail = true;
    const sent: AnalyticsRow[] = [];
    const a = new BufferedAnalytics(
      'test',
      async (rows) => {
        if (fail) throw new Error('database down');
        sent.push(...rows);
      },
      { intervalMs: 60_000 },
    );
    a.track('room_created', { room: 'AAAAA' });
    await a.flush(); // fails; must not throw
    a.track('room_created', { room: 'BBBBB' });
    fail = false;
    await a.flush();
    expect(sent.map((r) => r.room)).toEqual(['AAAAA', 'BBBBB']);
    await a.close();
  });
});
