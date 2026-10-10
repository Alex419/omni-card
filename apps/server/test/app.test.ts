import { mkdtemp, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mulberry32, type ServerMessage, type TableView } from '@omni/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app';
import type { Config } from '../src/config';

/** End to end over real sockets: HTTP to create a table, WebSockets to play it. */

let app: ReturnType<typeof createApp>;
let base: string;
let feedbackFile: string;

beforeAll(async () => {
  feedbackFile = join(await mkdtemp(join(tmpdir(), 'omni-')), 'feedback.jsonl');
  const config: Config = {
    port: 0,
    host: '127.0.0.1',
    production: false,
    clientDist: null,
    supabaseUrl: '',
    supabaseKey: '',
    feedbackFile,
  };
  app = createApp(config, mulberry32(9));
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

/** A test client that remembers the latest view and can wait for the next message. */
async function connect(room: string, name: string, token: string) {
  const ws = new WebSocket(`ws://${base}/ws`);
  const inbox: ServerMessage[] = [];
  let waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    inbox.push(JSON.parse(String(d)));
    const ready = waiters;
    waiters = []; // swap first: a waiter that is still unmet re-registers itself
    ready.forEach((w) => w());
  });
  await new Promise((r) => ws.once('open', r));
  const client = {
    ws,
    inbox,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    view: (): TableView => {
      const v = [...inbox].reverse().find((m) => m.t === 'view');
      return (v as { view: TableView }).view;
    },
    /** Resolve once a message matching `pred` has arrived. */
    until: (pred: (m: ServerMessage) => boolean) =>
      new Promise<ServerMessage>((resolve) => {
        const check = () => {
          const hit = inbox.find(pred);
          if (hit) resolve(hit);
          else waiters.push(check);
        };
        check();
      }),
  };
  client.send({ t: 'hello', room, name, token });
  await client.until((m) => m.t === 'view');
  return client;
}

describe('server', () => {
  it('creates a table, seats two players and redacts per player', async () => {
    const res = await fetch(`http://${base}/api/rooms`, { method: 'POST' });
    const { code } = (await res.json()) as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{5}$/);

    const alex = await connect(code, 'alex', 'a'.repeat(32));
    const maya = await connect(code, 'maya', 'm'.repeat(32));
    alex.send({ t: 'sit', seat: 0 });
    maya.send({ t: 'sit', seat: 1 });
    await maya.until((m) => m.t === 'view' && m.view.you.seat === 1);
    alex.send({ t: 'intent', id: 1, intent: { type: 'deal', count: 4 } });
    expect(await alex.until((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 1, ok: true });
    await maya.until((m) => m.t === 'view' && m.view.hand?.length === 4);

    const mayaHand = maya.view().hand!.map((c) => c.vid);
    const alexRaw = alex.inbox.map((m) => JSON.stringify(m)).join('');
    for (const id of mayaHand) expect(alexRaw).not.toContain(id);

    // Refresh: same token, new socket, same seat and hand.
    maya.ws.close();
    const back = await connect(code, 'maya', 'm'.repeat(32));
    expect(back.view().you.seat).toBe(1);
    expect(back.view().hand!.map((c) => c.vid)).toEqual(mayaHand);
    alex.ws.close();
    back.ws.close();
  });

  it('rejects unknown rooms and malformed messages', async () => {
    const ws = new WebSocket(`ws://${base}/ws`);
    await new Promise((r) => ws.once('open', r));
    const next = () => new Promise<ServerMessage>((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
    let reply = next();
    ws.send(JSON.stringify({ t: 'hello', room: 'ZZZZZ', name: 'x', token: 'x'.repeat(32) }));
    expect(await reply).toMatchObject({ t: 'error', code: 'room-not-found' });
    reply = next();
    ws.send('{"t":"intent","id":1,"intent":{"type":"deal","count":9999}}');
    expect(await reply).toMatchObject({ t: 'error', code: 'bad-message' });
    ws.close();
  });

  it('stores valid feedback and rejects junk', async () => {
    const post = (body: unknown) =>
      fetch(`http://${base}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({ category: 'idea', message: 'Add a timer please' })).status).toBe(201);
    expect((await post({ category: 'idea', message: '' })).status).toBe(400);
    expect((await post({ category: 'nope', message: 'hello there' })).status).toBe(400);
    const saved = (await readFile(feedbackFile, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ category: 'idea', message: 'Add a timer please' });
  });
});
