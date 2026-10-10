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
