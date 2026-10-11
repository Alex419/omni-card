# Omni Card

A browser card table for playing almost any card game with friends. There's no rules engine: it works like
sitting at a real table. You move cards, keep score and police the rules yourselves. Omni Card provides
the tools (zones, decks, dealing, sticky notes) in a seated, 8-bit look.

Create a table, send the link, and everyone sees the table from their own chair. Your hand is private;
the server makes sure nobody's browser ever receives cards they shouldn't see.

**Play it:** https://omni-card.onrender.com (free hosting: the first visit after a quiet spell can take up to a minute to wake up).

## What you can do

**Getting a game going**
- Create a table, then share the invite link (click **ROOM** to copy it) or the 5-letter room code. 2–8 players pick seats; extra people can watch.
- Everyone sees themselves at the bottom of the table, with friends around it in seat order.
- Refresh or lose your connection and you're put back in your seat with your hand.

**Cards**
- **Drag** cards anywhere: onto the felt, into a zone, onto a friend (gives them the card), or anywhere along the bottom of the screen (into your hand).
- **Click** a table card to flip it; press **F** while dragging to flip it before it lands.
- **Click** cards in your hand to select several, then drag them together; drag within your hand to reorder.
- **Press and hold** on a pile: the count goes up one card every 0.75 s, then drag to take that many at once.
- **DEAL** a number of cards to every player. Use − / + or type the number in the box.
- **SHUFFLE**, **COLLECT** (everything back to the deck) and **UNDO**. Undo works for everyone and is announced ("ALEX UNDID ...").

**Zones** (piles and spreads)
- **+ ZONE** places a new one. Drag a zone by its grip (top-left) or its empty outline. The **cog** (bottom-right) opens its settings: name, face up/down, stack or spread, neat or messy, mark as the deck, shuffle, flip all, delete.
- Messy piles keep cards where they were tossed; **TIDY** squares them up. Several cards played at once fan out so everyone can read the run.
- **Drag on empty felt** to box-select cards, zones and notes (shift+click adds); move them together, or **PILE UP** selected cards into a new zone.

**The table**
- **TABLE** settings: number of seats, 1–4 decks, jokers, card size, each deck's card back (matching backs hide which deck a card came from), and table size (or drag the striped corner).
- **Sticky notes:** write on the pad, then slap the note on a friend (they react) or on the table. Click a note on you to rip it off.
- **SCORE** pad, chiptune sound (speaker icon), **HELP** tips, and **FEEDBACK** to send a bug report or idea.
- On a narrow window, toolbar buttons that don't fit move into **MORE**.

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

## Getting found on Google

The page already has search tags, a sitemap and link previews (`docs/decisions.md` #28). To get it indexed:

1. Go to [Google Search Console](https://search.google.com/search-console), add a **URL prefix** property for
   `https://omni-card.onrender.com/`, and verify it with the **HTML tag** method (add the `<meta>` tag it gives you to
   `apps/client/index.html` and deploy).
2. Under **Sitemaps**, submit `sitemap.xml`. Under **URL inspection**, request indexing for the home page.
3. Do the same at [Bing Webmaster Tools](https://www.bing.com/webmasters) (it can import from Search Console). Bing also feeds DuckDuckGo.
4. Get a few links: post it where card players are (Reddit communities, Discord servers, itch.io, Product Hunt).

Moving to your own domain later? Update the URL in `index.html`, `public/robots.txt` and `public/sitemap.xml`.

For local feedback to Supabase, copy `.env.example` to `.env` and fill it in. Without it, feedback goes to `.data/feedback.jsonl`.
