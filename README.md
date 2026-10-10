# Omni Card

A browser card table for playing almost any card game with friends. There's no rules engine: it works like
sitting at a real table. You move cards, keep score and police the rules yourselves. Omni Card provides
the tools (zones, decks, dealing, sticky notes) in a seated, 8-bit look.

Create a table, send the link, and everyone sees the table from their own chair. Your hand is private;
the server makes sure nobody's browser ever receives cards they shouldn't see.

## Run it locally

Requires Node 22.12+.

```bash
npm install
npm run dev          # server on :8787, client on http://localhost:5173
```

Open http://localhost:5173, create a table, then open the invite link in a **private window** (or another
browser) to join as a second player. Two tabs in the same window share storage and count as the same player.

| Command | What it does |
|---|---|
| `npm run dev` | Game server (auto-restarts on change) + Vite client (hot reload) |
| `npm test` | All unit and integration tests (about 1 s) |
| `npm run check` | Typecheck + lint + tests: run before committing |
| `npm run build` | Production build of client and server |
| `npm start` | Run the production build (serves the client too) on :8787 |

Note: the dev server keeps tables in memory, so editing server code restarts it and forgets open tables.

## How it's organised

```
packages/shared/        Game logic shared by client and server (no I/O, fully unit-tested)
  src/state.ts            The authoritative GameState types
  src/protocol.ts         Intents and messages, as zod schemas (validation + types)
  src/reducer.ts          applyIntent(state, intent) -> new state + events   (pure)
  src/view.ts             viewFor(state, player) -> what that player may see (pure)
  src/geometry.ts         Seat positions and per-player view rotation
apps/server/            Node: HTTP API + WebSockets + serves the built client
  src/room.ts             One table: players, reconnect tokens, broadcast
  src/app.ts              HTTP routes and WebSocket wiring
  src/feedback/store.ts   Feedback storage (Supabase, or a local file)
  src/analytics/          Anonymous game analytics, batched into Supabase
apps/client/            React + Vite
  src/net/RoomClient.ts   WebSocket client with reconnection
  src/table/              The tilted table: projection math, Game (interactions), Plane, seats, hand
  src/ui/                 Toolbar, popovers, lobby, score pad, toast
  src/art/                8-bit sprites drawn on canvas at startup
  src/styles/             CSS, one file per area
prototype/omni-card.html  The original single-file prototype (reference for look and feel; don't edit)
docs/decisions.md         Every design decision and its trade-offs. Start here to learn the codebase.
supabase/migrations/      SQL for the feedback and analytics tables (run in order)
supabase/queries/         Saved analytics questions to paste into the SQL Editor
render.yaml               One-click deploy blueprint for Render
```

The core loop, in one picture:

```
browser ──intent {type:'moveCards', ...}──▶ server ── zod validate ──▶ applyIntent ──▶ new state
   ▲                                                                           │
   └──────────── your own redacted view ◀── viewFor(state, you) ◀──────────────┘  (one per player)
```

## Deploy it (free)

You need free accounts on [GitHub](https://github.com), [Supabase](https://supabase.com) and
[Render](https://render.com).

1. **Push this repo to GitHub.**
2. **Create the tables.** In Supabase, create a project, open **SQL Editor**, and run each file in
   `supabase/migrations/` in order (`0001_feedback.sql`, then `0002_analytics.sql`).
3. **Get two values** from Supabase **Project Settings → API**: the project URL, and a **secret** key
   (`sb_secret_...`; the legacy `service_role` key also works). Keep the secret key private: it bypasses Row Level Security.
4. **Deploy on Render.** **New → Blueprint**, pick your repo; Render reads `render.yaml`. When asked, set
   `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. The first build takes a few minutes.
5. **Play.** Open the `onrender.com` URL. Read feedback in Supabase under **Table Editor → feedback**.

## Usage numbers

The server records a few anonymous game events (tables created, players joining, games started, how long
tables last) in Supabase. No names, IP addresses, cookies or anything typed are stored, and players
appear only as a one-way pseudonym. In the SQL Editor:

```sql
select * from analytics_daily limit 30;
```

More ready-made questions (returning players, the create → join → play funnel, busiest hours) are in
`supabase/queries/analytics.sql`. Set `ANALYTICS=off` to record nothing.

Free-tier caveats: the server sleeps after ~15 idle minutes (first visit then takes up to a minute), and
tables are kept in memory, so a sleep or redeploy ends open games. See `docs/decisions.md` #17 for the upgrade path.

For local feedback to Supabase, copy `.env.example` to `.env` and fill it in. Without it, feedback goes to `.data/feedback.jsonl`.
