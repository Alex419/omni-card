# Design decisions

Every architectural choice in Omni Card, why it was made, what it costs, and what we'd do instead
if things change. Newest decisions go at the bottom. Each entry follows the same shape:
**Decision**, **Why**, **Trade-off**, **Alternatives**.

If you're reading this to learn: the most important entries are
[3 (server-authoritative intents)](#3-server-authoritative-state-clients-send-intents),
[6 (redaction)](#6-hidden-information-redaction-with-opaque-view-ids) and
[11 (view rotation)](#11-per-seat-view-rotation).

---

## 1. Monorepo with npm workspaces

**Decision.** One repository, three packages: `packages/shared` (game logic), `apps/server`, `apps/client`.
npm workspaces link them so `import ... from '@omni/shared'` works in both apps.

**Why.** The client and server must agree exactly on the shape of the game state and the messages they
exchange. Putting those types and the game logic in one shared package means a change on one side is a
compile error on the other, not a runtime bug in production.

**Trade-off.** Monorepos need a little tooling (workspaces, per-package tsconfig). npm workspaces are
the simplest option because npm is already installed and Render uses it by default.

**Alternatives.** *pnpm workspaces* are faster and stricter about undeclared dependencies; a good upgrade
later (`corepack enable pnpm`). *Turborepo/Nx* add build caching, which matters with dozens of packages, not three.
*Separate repos* would force publishing `shared` as a versioned package: lots of ceremony for one developer.

## 2. TypeScript, strict, with the shared package exporting source

**Decision.** TypeScript everywhere with `strict` and `noUncheckedIndexedAccess`. `@omni/shared` exports its
`.ts` source directly (no build step); Vite, Vitest, tsx and tsup all compile it on the fly.

**Why.** `noUncheckedIndexedAccess` makes `hands[seat]` have type `string[] | undefined`, which forces you to
handle "that seat doesn't exist", exactly the bug class a card game is full of. Exporting source means
there's no "forgot to rebuild shared" step.

**Trade-off.** Every consumer must be able to compile TypeScript. All of ours can. If we ever published
`shared` to npm we'd add a build.

## 3. Server-authoritative state; clients send intents

**Decision.** Only the server holds the real `GameState`. A client never changes state directly. It sends
an *intent* ("move these cards to that zone"). The server validates it, applies it with a pure function,
and sends each player their own fresh view.

```
client ──intent──▶ server: validate (zod) ─▶ applyIntent(state, intent) ─▶ new state
                                                         │
          ◀── view for player A ── viewFor(state, A) ◀───┤
          ◀── view for player B ── viewFor(state, B) ◀───┘
```

**Why.** Two reasons. (1) *Hidden information*: if clients held the full state, anyone could open dev tools
and read everyone's hand. Only a server can keep secrets. (2) *Conflicts*: if two players grab the same card
at the same moment, the server processes one intent first; the second finds the card gone and is rejected
("THOSE CARDS MOVED"). There is one order of events, so no two clients can disagree.

**Trade-off.** Every action waits for a round trip (about 30–150 ms on a typical connection). We hide that by
keeping a dragged card faded until the server confirms (see [14](#14-no-optimistic-updates-fade-until-confirmed)).

**Alternatives.** *Peer-to-peer (WebRTC)* has no server cost, but one peer would have to hold the secrets,
and that peer can cheat. *CRDTs (Yjs, Automerge)* are great for collaborative documents where every
edit can merge, but they can't hide information and "two people took the same card" doesn't merge.

## 4. Plain `ws` instead of Colyseus

**Decision.** The real-time layer is the `ws` library plus about 150 lines of our own room code (`apps/server/src/room.ts`, `app.ts`).

| | plain `ws` | Colyseus |
|---|---|---|
| What you get | A WebSocket. Everything else is yours. | Rooms, matchmaking, reconnection, state sync with binary delta patches, client SDK |
| Hidden info | You write `viewFor` per player (we must anyway) | Its schema syncs state to everyone; per-player hiding needs `@filter` decorators or a separate state per client |
| Learning value | You see every moving part | Much of it is behind the framework |
| Lock-in | None | Its state model and client SDK |
| Size of our code | Small: rooms are a Map, reconnection is a token lookup | Smaller, once you learn the framework |

**Why.** Our hardest requirement, per-player redaction, is exactly where Colyseus's automatic state sync
helps least: we'd be fighting its "sync the state to everyone" model. And for a learning project, writing
rooms, reconnection and heartbeats yourself teaches what frameworks like Colyseus do for you.

**Trade-off.** We maintain reconnection, heartbeats and rate limiting ourselves. If we later need
matchmaking or to scale across many server processes, Colyseus (or a Redis pub/sub layer) becomes attractive.

## 5. A pure reducer: `applyIntent(game, intent, ctx)`

**Decision.** All game rules live in one pure function in `packages/shared/src/reducer.ts`. It never mutates
its input: it `structuredClone`s the table, changes the copy and returns it. Randomness (`ctx.rng`) and time
(`ctx.now`) are passed in, not read from globals.

**Why.**
- *Testable*: same input gives the same output, so tests are plain function calls with a seeded RNG. No
  server, no sockets, no mocks.
- *Undo for free*: since the old state is never mutated, the old table object *is* the undo snapshot.
- *Portable*: the same function could run in the browser for prediction, or on a different server.

**Trade-off.** Cloning the whole table on every intent is wasteful in theory. In practice a table is at most a few
hundred cards and the clone takes microseconds.

**Alternatives.** *Immer* lets you write "mutating" code that produces immutable updates with structural
sharing. It's what Redux Toolkit uses, and worth trying if cloning ever shows up in a profile.

## 6. Hidden information: redaction with opaque view ids

**Decision.** `viewFor(game, playerId)` (in `packages/shared/src/view.ts`) builds what one player may see.

| Thing | What the player receives |
|---|---|
| Your hand | Real card ids and faces |
| Other hands | `handCount` and `handBacks` (the deck colors) only. No ids of any kind |
| Face-up table cards | Real id and face |
| Face-down cards, buried pile cards | `face: null` and an opaque `vid` such as `h3k9x0q...` |
| Piles (stack zones) | Only the top 4 cards (14 for messy piles) are sent at all, plus a total count |
| Deck order | Never sent. Below the top few cards, nothing about the pile leaves the server |

Clients refer to cards by these `vid`s in their intents. The server resolves a vid by recomputing the vids
*this player was shown*, so guessing a real id ("AS.0") for a hidden card finds nothing.

**How the opaque ids work.** Each card has a random `tag` (about 62 bits). A hidden card's vid is `h + tag`. The
tag is re-rolled at the moments a person at a real table would lose track of a card:
- **shuffle**: every card in the pile gets a new tag;
- **leaving a hand**: a card played from a hand gets a new tag, so you can't tell which of the 5 cards
  dealt to someone they just played face down.

Between those moments a face-down card keeps its tag, so it can be dragged around. That matches the
real world: you *can* follow a face-down card with your eyes while someone slides it across the table.

**Deviation from the brief, flagged.** CLAUDE.md asked for "opaque per-view IDs". The tags here are
per *card*, not per *viewer*: two players see the same vid for the same face-down card. That is safe because a
tag is only ever sent while the card is hidden from *everyone*, so comparing notes between players reveals
nothing. Per-viewer ids would matter if we add a "peek" feature (one player sees a face-down card's face).
In that case, derive the vid as `HMAC(serverSecret, viewerId + tag)` on the server.

**Testing (`packages/shared/test/view.test.ts`).** Targeted tests for each rule, plus a *fuzz test*: five
random 150-step games with 4 players and a spectator, checking after *every* step and for *every* viewer that:
no hidden card's id appears anywhere in the JSON payload; every face shown is one that viewer may see;
every vid is either a visible id or a current hidden tag; other hands expose only count and colors; and
no server-only field (`tag`, `history`, ...) leaks.

**Lesson learned while building this.** The first version of the test passed even when the redaction was
deliberately broken. It reused the implementation's own `zoneCardVisible` helper to decide what *should* be
visible, so a bug in that helper made the test agree with the bug. It also only searched for quoted ids
(`"AS.0"`), missing an id embedded inside another string. Both were fixed: the test now has its own
independent copy of the visibility rule. We checked the fix with *mutation testing*: breaking the code on
purpose four different ways and confirming the tests catch each one. Do this whenever a test protects
something important.

## 7. Full views, not diffs

**Decision.** After every intent the server sends each client its complete `TableView` (a few KB of JSON).

**Why.** Simple and self-healing: a client that missed a message is fixed by the next one; reconnection
needs no special "catch up" logic.

**Trade-off.** Bandwidth: around 10 KB × players × actions. Fine for card games (a few actions per second).
If it ever matters: send JSON Patch diffs against the last view each client received, or switch to a binary format.

## 8. Validate every message with zod; keep zod out of the browser

**Decision.** `packages/shared/src/protocol.ts` defines zod schemas for every client message. The server
`safeParse`s every incoming message and drops anything malformed. The types (`Intent`, etc.) are *inferred*
from the schemas with `z.infer`, so the validator and the TypeScript type can't drift apart.

The schemas are exported from a separate entry point (`@omni/shared/schemas`), imported only by the server.
The browser imports types only, which TypeScript erases at build time.

**Why.** Never trust the client: anyone can open a WebSocket and send `{"count": 99999}`. Moving the
schemas behind their own entry point cut the client bundle from 366 KB to 277 KB, because zod no longer ships to the browser.

## 9. Cryptographic randomness for shuffles

**Decision.** The server shuffles with `crypto.getRandomValues` (`apps/server/src/rng.ts`), not `Math.random`.

**Why.** `Math.random` in V8 (Chrome, Node) is xorshift128+: after seeing a few outputs, its internal state can
be reconstructed and every future output predicted. Our card tags are random strings that players *do* see,
so with `Math.random` a determined player could predict the next shuffle. Crypto randomness can't be predicted.

## 10. Shared, announced undo

**Decision.** The server keeps a history stack of `(label, who, previous table)` (up to 60 entries). Anyone seated can
press UNDO; it restores the previous table for everyone and announces "MAYA UNDID ALEX'S DEAL 5".

Details:
- *Coalescing*: typing a zone name sends an intent per keystroke; consecutive edits by the same person within
  4 seconds merge into one undo step. Same for dragging the table-resize grip.
- *Private things aren't undoable*: reordering your own hand isn't recorded, and undoing restores everyone's
  current hand *order* even when it restores which cards are in the hand.
- *Changing the number of seats clears history*: old snapshots assume a seat layout that no longer exists.

**Trade-off.** Snapshots cost memory (about 20 KB × 60 per room); fine in memory, and a reason to cap history.
Anyone can undo anyone. That matches the project's "police the rules yourselves" spirit, and announcing it keeps it honest.

**Revisited after playtesting (kept as is).** We weighed two alternatives:
- *Undo only your own moves, any time.* This needs inverse operations instead of snapshots, and it conflicts with
  later moves: you discard a card, Maya picks it up, then you undo.
- *Undo your own move freely, others' moves by request (ACCEPT/DENY).*

We kept anyone-can-undo-the-last-move for flexibility. If griefing becomes a problem, the cheapest change is "only
your own last move, while nobody has acted since". That's a single check against the top history entry, because
undo restores whole-table snapshots.

## 11. Per-seat view rotation

**Decision.** Positions are stored in *table coordinates* (as seen from seat 0). Seats sit on the table's edges
(`packages/shared/src/geometry.ts`). Each client turns the table by a multiple of 90° so its own edge is at the
bottom, then draws everyone else on the left, far and right edges like the prototype.

Choices inside this:
- **Only 90° steps.** The table is a rectangle; turning it 45° for a corner seat would look broken.
- **Cards and notes stay upright for every viewer**; only their *positions* rotate. A real table would show
  you cards upside down; on a screen, readability wins. Spread zones run along the viewer's axis.
- **Side seats see a portrait table.** At a 4-player table the players on the short ends look down the long
  axis, so their table is narrower. That's realistic, but it is the main cost of this design.
- **Neighbours on your own edge** (5+ players share edges) would be hidden behind your hand, so they're drawn
  just round the corner on the side edge nearest them.
- **Clockwise order is preserved for every chair**, so "pass to your left" means the same seat for
  everyone. A test checks this for every table size and every seat.

**Alternatives.** A round or oval table rotates to any angle seamlessly. That's a visual redesign of the prototype, so it's not done here.

## 12. Client: React around plain DOM + CSS 3D

**Decision.** React renders the table as plain `div`s; the seated tilt is a CSS `perspective` + `rotateX`
transform, with `proj()`/`unproj()` (`apps/client/src/table/projection.ts`) doing the matching math, exactly as
in the prototype. Sprites are generated on a canvas once at startup and installed as CSS classes.

Patterns worth knowing:
- **`RoomClient` lives outside React** (`net/RoomClient.ts`) and React subscribes with
  `useSyncExternalStore`. The socket's lifetime isn't tied to rendering, and it's the officially
  supported way to read external state without tearing.
- **Pointer handling is a state machine in refs** (`table/Game.tsx`). A drag fires dozens of
  `pointermove`s per second; keeping the drag in a `ref` and re-rendering on demand avoids the "stale closure"
  bugs you get from reading React state inside long-lived window listeners.
- **No router library.** Two screens (`/` and `/r/CODE`), handled by 15 lines with the History API.
- **Plain CSS files**, one per area. The look is a fixed 8-bit theme, so a utility framework like Tailwind wouldn't help.

**Alternatives.** Canvas/WebGL (PixiJS) would scale to thousands of sprites. We have a few hundred, and the DOM
gives us hit testing, accessibility and CSS animations for free.

## 13. Identity without accounts

**Decision.** You type a name. The browser generates a random 128-bit token, stored in `localStorage`, and sends it on
every connection. The server maps token → player, so a refresh or dropped connection puts you back in your
seat with your hand. The token is never sent to other players.

Seat rules: the first person into an empty table (its creator) is seated automatically; others join as
spectators and click SIT. If a seated player disconnects, the seat is held for 60 seconds, then anyone can take it.

**Trade-off.** Clearing site data or switching browsers loses your seat (you rejoin as someone new). Accounts
(Supabase Auth, OAuth) would fix that but add sign-up friction to a "send a link to friends" game.

## 14. No optimistic updates: fade until confirmed

**Decision.** When you drop a card, the client sends the intent and keeps the card faded (`lifted`) until the
server acknowledges it. The server's response then puts it where it belongs.

**Why.** True optimistic updates mean running the reducer on the client and rolling back on rejection, and
the client only has a redacted view, so it often *can't* compute the result (what's under the top card?).
Fading avoids a jarring snap-back at almost no cost.

## 15. Reconnection and heartbeats

**Decision.** The client reconnects with exponential backoff and jitter (0.5s, 1s, 2s ... 8s, ±25%). The
server pings every socket every 30 s and drops ones that don't answer, so a closed laptop shows as "AWAY".

**Why jitter?** If the server restarts, every client reconnects at once. Random spread avoids a "thundering herd".

**Bug found while testing.** React's StrictMode mounts, unmounts and remounts components in development. The
first socket's late `onclose` then scheduled a *second* reconnect, which would have left duplicate connections. Fix: each socket handler checks
it's still the current socket (`if (this.ws !== ws) return`). The same pattern applies to any async callback that can outlive the component that started it.

## 16. Feedback: server → Supabase REST

**Decision.** The FEEDBACK form posts to our server (`POST /api/feedback`), which validates, rate-limits (5 per
10 minutes per IP) and inserts into a Supabase Postgres table with a plain `fetch` to Supabase's REST API.
The table has Row Level Security on with *no* policies, so only our server's secret key can write to it, and
you read it in the Supabase dashboard.

**Why go through our server instead of calling Supabase from the browser?** The browser approach is
the usual Supabase pattern and needs no server code, but anyone could then script inserts with the public
key; we couldn't rate-limit or validate. Going through the server keeps the secret key secret.

**Design pattern: an interface with two implementations.** `FeedbackStore` has `SupabaseFeedbackStore` (when
`SUPABASE_URL` is set) and `FileFeedbackStore` (writes `.data/feedback.jsonl` in local development). The HTTP
handler only knows the interface. This is *dependency inversion*, and it's why the tests need no database.

**Note on Supabase keys.** New `sb_secret_...` keys go in the `apikey` header only. They aren't JWTs and are
rejected as `Authorization: Bearer`. Legacy `service_role` JWT keys go in both. The store handles either.

## 17. Hosting: one free Render web service

**Decision.** A single Render web service runs the Node server, which also serves the built client.
`render.yaml` is the blueprint.

**Why one service.** Same origin for page, API and WebSocket: no CORS and one URL. It's also the simplest free option that
supports long-lived WebSockets (serverless platforms like Vercel functions don't).

**Trade-offs you will notice:**
- **Cold starts.** Free services sleep after ~15 minutes without traffic; the first visitor waits 30–60 s.
  The client shows "WAKING UP THE SERVER..." while it retries.
- **Rooms live in memory.** A sleep, deploy or crash forgets every table. Fine for casual play.

**Next step when it matters:** persist each room's state (it's one JSON object) to Postgres or Redis
after every intent, and load it on demand. The pure reducer makes this easy: state in, state out.
Alternatives to Render with WebSocket support and free tiers change often; Fly.io and Koyeb are worth checking.

## 18. Defensive limits

Small things that keep one bad client from hurting everyone:
- zod validation on every message, with max lengths and numeric ranges;
- 64 KB max WebSocket message; 10 KB max feedback body;
- token-bucket rate limits per socket (30 msgs/s) and per IP for room creation and feedback;
- player names reduced to the characters the pixel font can draw; React escapes all text, so no HTML injection;
- caps on players per room (8 seated + 16 watching), zones, notes, rooms and history length.

## 19. Testing strategy

- **Unit (Vitest)**: reducer, redaction (including the fuzz test), seat geometry, projection math, `Room`
  with fake peers. Run with `npm test`; they finish in about a second.
- **Integration**: `apps/server/test/app.test.ts` starts the real server on a random port and plays over
  real WebSockets: create, join, deal, check redaction on the wire, refresh and reclaim the seat.
- **Manual end-to-end**: multi-player sessions driven with Playwright across separate browser contexts
  (separate contexts mean separate localStorage and therefore separate players).

**Suggested next:** turn the Playwright session into an automated `e2e/` suite that runs in CI.

## 20. Zone settings cog (requested UI change)

**Decision.** The big hovering zone tab is gone. Each zone has a small **cog** (bottom-right) that opens the
settings popover, a **grip** (top-left) to drag it (dragging the empty outline also works), and a green **TIDY**
button (bottom-left) on messy piles. TIDY is also in the popover. The name shows on hover, while selected, or while
its popover is open. The card count badge moved to the top-right to make room for the cog.

The corners are relative to *your* view, so the cog is always bottom-right for you, whichever way the table is rotated.

## 21. Table resize is previewed locally, sent once

**Decision.** While you drag the resize grip, your browser resizes the table on its own, using the same clamping
functions as the server (now shared in `packages/shared/src/layout.ts`). One `resizeTable` intent is sent when
you let go.

**Why.** The first version sent an update every 120 ms and waited for the server's reply before the table grew.
Locally that was instant, but on Render each update is a cross-country round trip to a slow free CPU, so the
table trailed behind the pointer. A benchmark (CPU throttled 4×) confirmed drawing was a steady 60 fps; the lag
was purely network. General rule: during a continuous gesture, keep feedback local and send the *result*, not every step.

**Trade-off.** Other players see the new size when you let go, not while you drag. Sharing the clamp code means the
preview lands exactly where the server will put things, so nothing jumps when the reply arrives.

## 22. Several cards played at once fan out

**Decision.** Dropping more than one card onto a messy pile lands them as one fanned group: each card is offset
along the viewer's horizontal so its corner index stays visible. The fan is stored as `fan: [index, groupSize]`
on each card. The server stores where each card sits in the group; each client draws the fan left to right in its own
frame, so a run like 2-3-4-5-6 reads correctly whichever way your table is rotated. Others also get a toast
("ALEX PLAYED 5 CARDS ON DISCARD"). TIDY, NEAT and SHUFFLE square the pile again.

**Why a messy pile only?** A neat pile models a squared stack, where only the top card is visible, and the
redaction rules follow that (see 6). Messy piles already show every card's face in the top 14, so fanning just makes
the cards physically readable. The default DISCARD pile is messy.

**Also fixed.** Taking a card off a pile made the pile itself pop. Revealing the next card gives it a new id, which the
"just arrived" animation mistook for a new card. Cards in a pile now only animate when the pile's count grew.

## 23. Deploys: Virginia, and only after CI passes

**Decision.** `render.yaml` pins `region: virginia` (players are on the East Coast; the Supabase database is in
us-east-1 too) and uses `autoDeployTrigger: checksPass`, so a push to `main` deploys only after the GitHub Actions
checks pass. Docs-only commits don't trigger a deploy.

**Why it matters.** Every card move is a round trip to the server, so the server should be near the players. Gating
on CI means a commit that breaks the build or tests never reaches players, and skipping docs-only deploys
avoids needlessly ending open games (rooms live in memory, see 17).

**Gotcha.** Render can't move an existing service to another region. Changing `region` means deleting the service and creating it again from the Blueprint.

## 24. Game analytics on the server, privacy first

**Decision.** The server records five events (`room_created`, `player_joined`, `game_started`, `room_ended`
with duration, peak seated players and number of actions, and `feedback_sent`) into a Supabase table, and a
`analytics_daily` view summarises them per day (US Eastern).

**Why server-side, not a tracking script?** Page-view tools (Google Analytics, Plausible, Cloudflare) say who
*visited*. For a game, the question is who *played*, and only the server knows that. A server-side event
also can't be blocked by ad-blockers, which hide a sizeable share of visitors from client-side scripts. A page-view tool
is still worth adding later for traffic sources; Cloudflare Web Analytics is free and cookieless.

**Privacy by design.** No names, IP addresses, cookies or typed text. To count *returning* players without
identifying anyone, each player is stored as `HMAC-SHA256(ANALYTICS_SECRET, browserToken)`, truncated:
- the same browser always gives the same pseudonym, so returns are countable;
- it can't be reversed into the token, and without the server's secret nobody can compute it for a known token.

This kind of first-party, cookieless measurement doesn't need a consent banner. Adding accounts, ads or
third-party scripts would change that.

**Engineering choices.**
- **Batching:** events are buffered and written every 15 s (or every 50 events), one HTTP request per batch
  instead of one per event.
- **Fire and forget:** `track()` never waits and never throws, so a slow or broken database can't slow
  down a game. Failed writes are retried with the next batch, capped at 2,000 buffered rows.
- **Shutdown:** on SIGTERM (every deploy), all rooms are reported as ended and the buffer is flushed before
  the process exits. Otherwise every deploy would silently lose the last 15 seconds of events.
- **Same lock-down as feedback:** RLS on, no policies, insert granted only to the server's role. The view uses
  `security_invoker` so it can't be used to read around that.
- **Testable:** `Room` only knows a tiny `RoomAnalytics` interface (`track`, `pseudonym`); tests pass a fake
  and assert on the events. The SQL was checked against PGlite (Postgres compiled to WebAssembly) before it
  touched the real database.

## 25. Each deck's card back is a table setting

**Decision.** `TableConfig.backs[deck]` picks one of the 4 back designs per deck, and repeats are allowed. In TABLE
setup you click a deck's back to cycle its design (`setBacks` intent, undoable). It defaults to one design per
deck, as before.

**Why.** With mixed backs you can see which deck a face-down card came from. Some games want that (sorting decks
back out); others want decks indistinguishable. Before, the back was derived from the deck number baked into the
card id (`AS.1` → back 1). Now `backFor(cfg, id)` looks it up, so it's a display setting and the cards' secret
identities never change.

**Redaction check.** Hidden cards expose only `back` (the chosen design), never the deck number. A test sets two
decks to the same back and confirms every hidden card and every opponent's hand shows the same value. The fuzz test
now also mixes in deck and back changes, and its face check counts faces instead of assuming each face is unique
(with two decks there are legitimately two "AS").

*Known and harmless:* a **face-up** card's vid is its real id (`AS.1`), which includes the deck number. Its face is
already public, and when it's hidden again it gets an opaque tag that's re-rolled on shuffle and when it leaves a
hand, so the deck number can't be followed into hiding.

## 26. Toolbar: priority+ overflow into a MORE menu

**Decision.** Toolbar buttons that don't fit move into a MORE menu, least important first: HELP, SCORE, COLLECT,
+ ZONE, SHUFFLE, sound, ROOM, UNDO, TABLE, then DEAL. FEEDBACK and MORE always stay visible.

**Why.** The old bar scrolled sideways with its scrollbar hidden, so on a narrower window buttons simply vanished
with no hint they existed. Wrapping onto a second row was the simplest fix, but it shrinks the table on exactly the
screens that have the least room. Priority+ is the standard pattern for this (GitHub's and Gmail's toolbars do it).

**How.**
- An invisible copy of every button is rendered once, so each width can be measured even while that button is
  inside MORE. Measuring the real bar instead loops: hide, re-measure, show, re-measure...
- A `ResizeObserver` on the bar re-runs a pure function, `fitToolbar()` (`apps/client/src/ui/toolbarFit.ts`, unit-tested).
- It keeps items strictly in priority order, so a less important button is never shown while a more important one is hidden.

**Also.** SND ON/OFF became a pixel speaker icon (sound waves, or a red X), with an `aria-label` so screen readers
still announce it. FEEDBACK is pink in the bar and the lobby, and the HELP panel asks for feedback.

## 27. Drawing several cards: press and hold, counted by the server

**Decision.** Holding the pointer still on a pile's top card counts up one card every 0.75 s (a gold badge shows the
count). Dragging then carries that many cards, sent as one new intent, `drawCards { id, count, to }`. Letting go
without moving cancels instead of flipping the card.

**Why a new intent instead of `moveCards`.** `moveCards` names cards by vid, but a pile only sends its top 4 cards
(#4: deck order is never sent). The client literally can't name card #5, so it asks for "the top N" and the server
counts them off. The redaction model stays untouched: the client learns nothing it couldn't learn by drawing one at a time.

**Trade-offs.**
- *Timing:* a fixed 0.75 s step is slow for "draw 13", but easy to stop on the number you want. A speed-up (or the mouse
  wheel adjusting the count) can be added later if players ask.
- *Races:* if someone else draws first, you get whatever is on top when the server applies your intent. That's the
  real-table behaviour and avoids rejecting the whole grab.
- Drawing more than one card into your hand is announced ("ALEX DREW 5 CARDS FROM DECK"), like seeing it across a table.
  The whole grab is one undo step.

**Also: the hand is the whole bottom strip.** Drops used to be hit-tested only with `elementFromPoint`. A fast flick
that ended past the window's bottom edge, or over your sticky notes, found nothing and the card snapped back. Now
any drop at or below the top of the hand strip (including outside the window) counts as your hand, unless it's over
an open popover.

**Also: a typed deal count.** The number between DEAL and + is a boxed input, so big jumps don't take a dozen
clicks. It keeps a local draft while you type and only clamps (1–26) and saves on Enter or when you click away. Clamping
on every keystroke would turn "1" into a dead end while you're on your way to typing "12". The box is a sibling of the
DEAL button, not inside it: an input inside a `<button>` is invalid HTML, and clicking it would also deal.

## 28. Search engines and link previews (SEO)

**Decision.** Keep the single-page app, and give the home page what search engines and chat apps read:
- **Real words on the page.** An "About" section under the lobby (what it is and how it works; no list of games, since any game works).
  The logo is now the page's `<h1>`. Before this, the home page had about ten words, so there was little for a search engine
  to match.
- **`<head>` tags** in `apps/client/index.html`:
  - a keyword-bearing `<title>` and meta description (what shows in search results);
  - a canonical URL;
  - Open Graph and Twitter tags with a 1200×630 screenshot (`public/og.png`). This is the preview card when an invite
    link is pasted into Discord, iMessage or Slack, which matters a lot for a game that spreads by links;
  - JSON-LD `WebApplication` data (lets Google know it's a free web game).
- **`robots.txt`** blocks `/r/` (rooms are short-lived and private) and `/api/`. **`sitemap.xml`** lists the home page.
- A room's browser tab gets a short title ("Omni Card: room 5D3Y9") instead of the long search title.

**Why not server-side rendering or prerendering?** Google runs JavaScript, so it sees the React-rendered lobby. The
only page worth ranking is the home page. SSR (Next.js, or Vite SSR) would add a whole rendering layer for no gain. If
more content pages are added later (rules guides such as "how to play Spades online"), prerendering them to static
HTML is the step up. Those pages are also the biggest SEO lever: they match the exact phrases people search for.

**Trade-offs and limits.**
- The site URL is hardcoded in three places (`index.html`, `robots.txt`, `sitemap.xml`). Moving to a custom domain
  means changing all three. A custom domain also helps ranking and trust more than anything on this list: an
  `onrender.com` subdomain shares its reputation with every other app on Render.
- Free-tier sleep: if Googlebot visits while the server sleeps, the page loads slowly, which counts a little against it.
- None of this makes Google *find* the site; links and Search Console do (see the README).

## 29. The move feed and chat

**Decision.** A FEED panel beside the table lists every move ("ALEX PLAYED 7♥ 8♥", "MAYA DREW 3 CARDS FROM DECK")
and chat, in one list. The server builds it; clients only display it.

**Where the lines come from.** The reducer already emits public `log` events for toasts and sounds. Each one now
also carries a feed line (`feed`, plus `cards` for faces that may be named). Toasts stay quiet (single-card plays
don't toast), while the feed records everything that changes who holds what. `feedFromEvents()`
(`packages/shared/src/feed.ts`) turns events into lines, and the Room keeps the last 200.

**The naming rule is a redaction rule.** A card is named only if everyone could see it just before it moved, or
can see it where it lands. Otherwise it's counted ("PLAYED A CARD FACE DOWN"). Events go to every player, so a
mistake here would leak hidden cards to everyone. The redaction fuzz test checks every event of every random game
against an independent oracle, and a planted bug ("name every card") fails it.

**Why the feed lives in the Room, not in `GameState`.** UNDO restores table snapshots. If the feed were part of the
state, an undo would erase the history of what happened. Instead, the undo itself is a new line.

**Why it's sent incrementally.** Every move re-sends each player's whole view. Putting 100 feed lines inside each view
would multiply traffic for no reason. So joining (or refreshing) sends the recent feed once (`{t:'feed', reset}`), and
after that only new lines go out.

**Chat** is handled by the Room, not the reducer, because it isn't a game action (nothing to undo).
- Spectators can chat.
- A per-player token bucket allows a burst of 5 messages, then 1 per second.
- Control characters are stripped and messages are capped at 200 characters.
- It's rendered as React text, so markup typed into chat shows as text instead of running.

## 30. Asking to see a hand, showing yours

**Decision.** Click a friend's name or sprite: ASK TO SEE THEIR HAND (they get SHOW / NO), or SHOW THEM MY HAND.
- The owner can HIDE at any time, from the bar above their hand or from the hand menu.
- The viewer can STOP LOOKING.
- Every step is announced in the feed: at a real table, everyone would see you lean over.

**State.** `GameState.peeks` (viewer, owner) and `GameState.asks` live beside the table, not in it. UNDO restores
table snapshots, and an undo must never re-open a hand its owner has hidden. Peeks aren't undoable either: they're
consent, not moves.

**Redaction.** `viewFor` adds `peeking` (the faces of hands you were granted), plus `shownTo`, `asksForMe` and
`asksFromMe`. Nothing else changes, so third players still get only counts and backs. The test oracle learned the
rule independently ("a hand card is visible to its owner and to granted viewers"). A planted bug (show granted hands
to everyone) fails 6 tests. A browser check also inspected a third player's raw WebSocket frames for the cards.

**Seats, not people.** Hands belong to seats. If a player stands up and someone else sits down, the newcomer must not
inherit a peek nobody granted them. `prunePeeks()` drops peeks and asks whose seats are empty, and runs whenever players
change (Room) or the seat count changes (reducer).

## 31. Hand menu and sorting

**Decision.** A small hand button at the bottom right of your hand opens a menu: SORT BY RANK / BY SUIT, and who can
see your hand (HIDE MY HAND). It's a menu so future hand options don't crowd the hand.

**Sorting is server-side** (`sortHand` intent): hand order already lives on the server, so a refresh keeps it. It's
private like dragging to reorder: no event, not undoable, and UNDO keeps your current order. Aces are high; suits go
♠ ♥ ♣ ♦ so the colors alternate; jokers go last; equal cards from different decks keep a fixed order.

**Also.** The HELP panel moved to the middle of the table. Every edge of the screen except the bottom has a seat on
it, so the old top-left panel hid the left seat's name plate (and its SIT button) for new visitors.
