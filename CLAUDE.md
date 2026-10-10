# Omni Card

A browser card table for playing almost any card game with friends. There are **no rules engines**: it works like sitting at a real table. Players move cards, keep score and police the rules themselves. The site provides the tools (zones, decks, dealing, notes) and a fun, seated, 8-bit look.

The owner (Alex) is a CS master's student who wants to learn full-stack and system design through this project. When you make an architectural decision, explain the trade-off briefly and record it in `docs/decisions.md`.

## Source of truth for look and feel

`prototype/omni-card.html` is a working single-file, single-player prototype. Open it in a browser before starting. It defines the visual design and interactions to keep. Port its behavior; do not redesign it unless asked.

What the prototype already does:
- **Seated first-person view.** A felt table tilted with CSS 3D (`perspective` + `rotateX(40deg)` + `scale3d`). `proj()` / `unproj()` convert between table coordinates and screen pixels and must match the CSS transform exactly. A fit loop scales the table to the viewport.
- **8-bit art generated at runtime on canvas**: 25x35 card faces, 4 card-back colors (one per deck), jokers, felt and wood tiles, and 16x22 player sprites with 3 frames (normal, blink, shocked). Rendered with `image-rendering: pixelated`. Fonts: Press Start 2P and VT323. PICO-8-style palette.
- **Seats.** 2–8 players. You are always at the bottom; others sit clockwise from your left in fixed `LAYOUTS` per player count (left edge, far edge, right edge). Friends' sprites sit in a layer *under* the table so it hides their laps. Each friend's hand shows as a fan of card backs on the table.
- **Your hand.** Docked flat at the bottom. Click cards to multi-select, drag to reorder, press F mid-drag to flip a card before placing it.
- **Zones.** Placeable outlines with settings: face up/down on landing, stack/spread layout, messy/neat pile, mark as the deck, shuffle, flip all, delete. Messy piles keep a per-card jitter based on where the card was tossed; TIDY animates them square.
- **Table tools.** Deal N to every seat, shuffle, collect all, undo (snapshot stack), score pad, chiptune sound effects (WebAudio).
- **Box-select.** Drag on empty felt to select loose cards, zones and table notes; shift+click toggles; the group drags together; PILE UP turns selected cards into a new zone.
- **Table setup.** Player count, 1–4 decks, jokers, card size (S/M/L), table size (drag the far-right corner grip, or Smaller/Bigger/Fit).
- **Sticky notes.** Write on a pad, drag the note onto a friend's sprite or the table, edit or rip notes off. In the prototype, bot friends react and sometimes stick a note back on you.

## What to build now

Turn the prototype into a real multiplayer app with a proper code structure.

### Requirements
1. **Rooms.** Create a table, get a short room code or link, friends join with a name and pick a seat. Up to 8 players. Spectators are a nice-to-have.
2. **Server-authoritative state.** Clients send *intents* (`moveCards`, `flip`, `deal`, `shuffle`, `createZone`, `updateZone`, `stickNote`, ...). The server validates them, applies them to the single game state and broadcasts the result.
3. **Hidden information is enforced on the server.** Each client receives only what that player is allowed to see:
   - other players' hands: count and deck colors only, never card identities;
   - face-down cards on the table and in piles: no identities, using opaque per-view IDs so a card can't be tracked after shuffles;
   - deck order: never sent.
   Write unit tests for this redaction. It is the most important correctness property in the app.
4. **Every client sees itself at the bottom.** Store seat positions in table coordinates and rotate the view per player.
5. **Reconnection.** Refreshing or dropping the connection puts you back in your seat with your hand.
6. **Real people replace the bots.** Sticky notes go player to player. Keep the reactions (shocked frame, speech bubble), triggered when someone sticks a note on you.
7. **Undo** becomes per-action and visible to everyone ("ALEX undid a move") rather than a local snapshot stack.

### Suggested architecture (confirm or challenge before building)
- TypeScript monorepo: `apps/client` (Vite + React), `apps/server` (Node), `packages/shared` (state types, intent types, a pure `applyIntent(state, intent)` reducer, a `viewFor(state, playerId)` redaction function).
- Real-time transport: WebSockets, either plain `ws` or a room framework such as Colyseus. Compare the two in `docs/decisions.md` before choosing.
- Keep the table rendering as plain DOM/CSS 3D like the prototype, wrapped in React components. Don't switch to canvas/WebGL.
- Start with in-memory room state; add persistence (Redis or Postgres) later.

### UI change requested
Replace the big hovering zone tab (name, UP/DN, TIDY, SET) with a small square settings cog in the zone's bottom-right corner. Clicking the cog opens the existing settings popover. Zones still need a way to be dragged: use a small grip in the opposite corner, or drag from the zone's empty outline. Show the zone name only on hover or in the popover. Keep TIDY reachable, either as a second small corner button on messy piles or inside the popover.

## Suggested milestones
1. Scaffold the monorepo and port the prototype's single-player table into React components with no behavior changes.
2. Shared state model, intents and reducer, with unit tests. The client runs the reducer locally.
3. Server, rooms and join flow; the client sends intents over WebSockets.
4. Per-player redaction plus tests; per-seat view rotation.
5. Reconnection, notes between players, reactions, shared undo.
6. Zone cog UI change, polish, deploy.

## Working conventions
- Plan before large changes and wait for approval on the architecture.
- Keep `applyIntent` and `viewFor` pure and fully tested.
- Keep the prototype file unchanged as a reference.

## Current state (as of 2026-10-09)

All six milestones are implemented in a first pass. Read `README.md` for layout and commands and
`docs/decisions.md` for every design choice (append new decisions there).
- Stack: npm workspaces; `packages/shared` (pure reducer + redaction, zod schemas at `@omni/shared/schemas`),
  `apps/server` (node http + `ws`, rooms in memory), `apps/client` (React 19 + Vite, plain CSS).
- Hosting plan: one free Render web service (`render.yaml`); feedback goes to Supabase via the server.
- Run `npm run check` (typecheck + lint + tests) before finishing any change.
- Known gaps: rooms are lost on restart (persistence is the next step); no automated browser e2e suite yet.
