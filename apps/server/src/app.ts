import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Rng, ServerMessage } from '@omni/shared';
import { ClientMessageSchema, FeedbackSchema } from '@omni/shared/schemas';
import sirv from 'sirv';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BufferedAnalytics,
  fileSink,
  noAnalytics,
  pseudonym,
  supabaseSink,
  type Analytics,
} from './analytics/analytics';
import type { Config } from './config';
import { FileFeedbackStore, SupabaseFeedbackStore, type FeedbackStore } from './feedback/store';
import { log } from './log';
import { RateLimiter } from './rateLimit';
import type { Peer, Room } from './room';
import { randomId } from './rng';
import { RoomRegistry } from './rooms';

/**
 * Builds the whole server: a plain Node HTTP server for the small JSON API and the built client,
 * with a WebSocket server attached at /ws for live play. Returned rather than started so tests can
 * run it on a random port.
 */
export function createApp(config: Config, rng: Rng) {
  const supabase = config.supabaseUrl && config.supabaseKey;
  const analytics: Analytics = !config.analyticsEnabled
    ? noAnalytics
    : supabase
      ? new BufferedAnalytics('supabase', supabaseSink(config.supabaseUrl, config.supabaseKey))
      : new BufferedAnalytics('file', fileSink(config.analyticsFile));
  if (!config.analyticsSecret && config.production && config.analyticsEnabled)
    log.warn('ANALYTICS_SECRET is not set: returning players will look new after each restart');
  const secret = config.analyticsSecret || randomId(24);
  const rooms = new RoomRegistry(rng, Date.now, {
    track: (...args) => analytics.track(...args),
    pseudonym: (token) => pseudonym(secret, token),
  });
  const feedback: FeedbackStore = supabase
    ? new SupabaseFeedbackStore(config.supabaseUrl, config.supabaseKey)
    : new FileFeedbackStore(config.feedbackFile);
  const roomLimiter = new RateLimiter(10, 10 / 60);
  const feedbackLimiter = new RateLimiter(5, 5 / 600);
  const serveClient = config.clientDist
    ? sirv(config.clientDist, { single: true, gzip: true, etag: true })
    : null;

  const server = createServer((req, res) => {
    handleHttp(req, res).catch((err: unknown) => {
      log.error('http handler crashed', { err: String(err) });
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const ip = clientIp(req);

    if (url.pathname === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size });

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (!roomLimiter.allow(ip)) return json(res, 429, { error: 'Too many tables. Try again in a minute.' });
      const room = rooms.create();
      if (!room) return json(res, 503, { error: 'The server is full right now.' });
      log.info('room created', { code: room.code });
      return json(res, 201, { code: room.code });
    }

    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      if (!feedbackLimiter.allow(ip))
        return json(res, 429, { error: 'Thanks! That is plenty of feedback for now.' });
      const body = await readJson(req, 10_000);
      const parsed = FeedbackSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: 'Please write at least a few words.' });
      try {
        await feedback.save({ ...parsed.data, userAgent: req.headers['user-agent'] });
        analytics.track('feedback_sent', {
          room: parsed.data.room,
          props: { category: parsed.data.category },
        });
      } catch (err) {
        log.error('feedback save failed', { store: feedback.name, err: String(err) });
        return json(res, 502, { error: 'Could not save feedback. Try again later.' });
      }
      return json(res, 201, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (serveClient) return serveClient(req, res);
    json(res, 404, { error: 'Client not built. In development, open the Vite dev server instead.' });
  }

  /* ---------- WebSockets ---------- */

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (ws: WebSocket & { alive?: boolean }) => {
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    const peer: Peer = {
      send: (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    const limiter = new RateLimiter(60, 30);
    let room: Room | undefined;

    ws.on('message', (data) => {
      if (!limiter.allow('msg')) return;
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return peer.send({ t: 'error', code: 'bad-message', message: 'Bad message' });
      }
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) return peer.send({ t: 'error', code: 'bad-message', message: 'Bad message' });
      const msg = parsed.data;

      if (msg.t === 'ping') return peer.send({ t: 'pong' });
      if (msg.t === 'hello') {
        if (room) room.leave(peer);
        room = rooms.get(msg.room);
        if (!room)
          return peer.send({ t: 'error', code: 'room-not-found', message: 'NO TABLE WITH THAT CODE' });
        if (!room.join(peer, msg.name, msg.token)) {
          room = undefined;
          return peer.send({ t: 'error', code: 'room-full', message: 'THAT TABLE IS FULL' });
        }
        return;
      }
      if (!room) return peer.send({ t: 'error', code: 'bad-message', message: 'Say hello first' });
      if (msg.t === 'sit') {
        const err = room.sit(peer, msg.seat);
        if (err) peer.send({ t: 'error', code: 'seat-taken', message: err });
      } else if (msg.t === 'stand') room.stand(peer);
      else if (msg.t === 'chat') {
        const err = room.chat(peer, msg.text);
        if (err) peer.send({ t: 'error', code: 'bad-message', message: err });
      } else {
        const err = room.intent(peer, msg.intent);
        peer.send(err ? { t: 'ack', id: msg.id, ok: false, error: err } : { t: 'ack', id: msg.id, ok: true });
      }
    });

    ws.on('close', () => room?.leave(peer));
    ws.on('error', (err) => log.warn('socket error', { err: String(err) }));
  });

  // Heartbeat: drop connections that stopped answering pings (closed laptop, lost Wi-Fi), so
  // their seat shows as away and they can rejoin cleanly.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
      if (ws.alive === false) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
    rooms.sweep();
  }, 30_000);
  heartbeat.unref();

  return {
    server,
    rooms,
    feedback,
    analytics,
    async close() {
      clearInterval(heartbeat);
      // Rooms live in memory, so stopping ends them all: record that before the data is gone.
      rooms.endAll();
      await analytics.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** Behind a hosting proxy (Render, Fly...) the real client address is in X-Forwarded-For. */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}
