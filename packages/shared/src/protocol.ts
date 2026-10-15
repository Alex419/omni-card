import { z } from 'zod';
import { BACK_COUNT, CARD_SIZES, LIMITS, MAX_DECKS, MAX_SEATS, MIN_SEATS, NOTE_COLORS } from './constants';
import type { GameEvent } from './events';
import { FEED, type FeedEntry } from './feed';
import type { TableView } from './view';

/**
 * Wire protocol. Each schema is both a runtime validator (the server never trusts the client)
 * and, through z.infer, the TypeScript type both sides compile against.
 */

const coord = z.number().finite().min(-10_000).max(10_000);
const seat = z
  .number()
  .int()
  .min(0)
  .max(MAX_SEATS - 1);
/** View ids (vids) the client got from its TableView. Never real card ids for hidden cards. */
const vids = z
  .array(z.string().max(40))
  .min(1)
  .max(MAX_DECKS * 54);
const id = z.string().max(40);

export const SourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hand') }),
  z.object({ kind: z.literal('loose') }),
  z.object({ kind: z.literal('zone'), id }),
]);
export type Source = z.infer<typeof SourceSchema>;

export const TargetSchema = z.discriminatedUnion('kind', [
  /** Your own hand. `index` reorders when moving within the hand. */
  z.object({ kind: z.literal('hand'), index: z.number().int().min(0).max(1000).optional() }),
  /** Another player's hand: giving them cards. */
  z.object({ kind: z.literal('seat'), seat }),
  /** x, y is where the card was tossed, so messy piles land off-center the way you threw them. */
  z.object({ kind: z.literal('zone'), id, x: coord, y: coord }),
  z.object({ kind: z.literal('table'), x: coord, y: coord }),
]);
export type Target = z.infer<typeof TargetSchema>;

export const NoteSpotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table'), x: coord, y: coord }),
  z.object({ kind: z.literal('seat'), seat, x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
]);

const noteColor = z.enum(NOTE_COLORS);
const noteText = z.string().max(LIMITS.noteText * 2);

export const IntentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('moveCards'),
    from: SourceSchema,
    vids,
    to: TargetSchema,
    /** Face for cards dropped loose on the table (F flips mid-drag). Zones decide for themselves. */
    up: z.boolean().optional(),
  }),
  /** Take the top `count` cards of a zone (press and hold on a pile). The server picks the cards. */
  z.object({
    type: z.literal('drawCards'),
    id,
    count: z
      .number()
      .int()
      .min(1)
      .max(MAX_DECKS * 54),
    to: TargetSchema,
    up: z.boolean().optional(),
  }),
  /** Ask the player in `seat` to let you see their hand. */
  z.object({ type: z.literal('askHand'), seat }),
  /** Answer the ask from the player in `seat`. */
  z.object({ type: z.literal('answerAsk'), seat, yes: z.boolean() }),
  /** Let the player in `seat` see your hand. */
  z.object({ type: z.literal('showHand'), seat }),
  /** Stop looking at `seat`'s hand (viewer), or stop showing yours to `seat` or, without a seat, to everyone (owner). */
  z.object({ type: z.literal('endPeek'), seat: seat.optional(), role: z.enum(['viewer', 'owner']) }),
  /** Sort your own hand. Private: no event, not undoable. */
  z.object({ type: z.literal('sortHand'), by: z.enum(['rank', 'suit']) }),
  z.object({ type: z.literal('flipCards'), from: SourceSchema, vids }),
  z.object({
    type: z.literal('moveItems'),
    items: z
      .array(z.object({ kind: z.enum(['zone', 'loose', 'note']), id, x: coord, y: coord }))
      .min(1)
      .max(400),
  }),
  z.object({ type: z.literal('pileUp'), vids }),
  z.object({ type: z.literal('createZone'), x: coord, y: coord }),
  z.object({
    type: z.literal('updateZone'),
    id,
    name: z
      .string()
      .max(LIMITS.zoneName * 2)
      .optional(),
    face: z.enum(['up', 'down']).optional(),
    layout: z.enum(['stack', 'spread']).optional(),
    mess: z.boolean().optional(),
    deck: z.boolean().optional(),
  }),
  z.object({ type: z.literal('tidyZone'), id }),
  z.object({ type: z.literal('shuffleZone'), id: id.optional() }),
  z.object({ type: z.literal('flipZone'), id }),
  z.object({ type: z.literal('deleteZone'), id }),
  z.object({ type: z.literal('deal'), count: z.number().int().min(1).max(LIMITS.dealMax) }),
  z.object({ type: z.literal('collect') }),
  z.object({ type: z.literal('setSeats'), count: z.number().int().min(MIN_SEATS).max(MAX_SEATS) }),
  z.object({
    type: z.literal('setDecks'),
    decks: z.number().int().min(1).max(MAX_DECKS),
    jokers: z.boolean(),
  }),
  z.object({
    type: z.literal('setBacks'),
    backs: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(BACK_COUNT - 1),
      )
      .min(1)
      .max(MAX_DECKS),
  }),
  z.object({ type: z.literal('setCardSize'), size: z.enum(Object.keys(CARD_SIZES) as ['S', 'M', 'L']) }),
  z.object({ type: z.literal('resizeTable'), tw: z.number(), th: z.number() }),
  z.object({ type: z.literal('score'), seat, delta: z.number().int().min(-100).max(100) }),
  z.object({ type: z.literal('stickNote'), text: noteText, color: noteColor, at: NoteSpotSchema }),
  z.object({ type: z.literal('moveNote'), id, at: NoteSpotSchema }),
  z.object({ type: z.literal('editNote'), id, text: noteText.optional(), color: noteColor.optional() }),
  z.object({ type: z.literal('ripNote'), id }),
  z.object({ type: z.literal('undo') }),
]);
export type Intent = z.infer<typeof IntentSchema>;
export type IntentType = Intent['type'];

/* ---------- client to server ---------- */

const playerName = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.playerName * 2);

export const ClientMessageSchema = z.discriminatedUnion('t', [
  /** First message on every connection. The token lets a refreshed tab reclaim its seat. */
  z.object({
    t: z.literal('hello'),
    room: z.string().max(12),
    name: playerName,
    token: z.string().min(16).max(64),
  }),
  z.object({ t: z.literal('sit'), seat }),
  z.object({ t: z.literal('stand') }),
  z.object({ t: z.literal('intent'), id: z.number().int(), intent: IntentSchema }),
  z.object({ t: z.literal('ping') }),
  /** A chat line for the feed. Cleaned and length-capped again on the server (cleanChat). */
  z.object({
    t: z.literal('chat'),
    text: z
      .string()
      .min(1)
      .max(FEED.chatMax * 2),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/* ---------- server to client (not validated: we trust our own server) ---------- */

export type ServerMessage =
  | { t: 'welcome'; room: string; playerId: string }
  | { t: 'view'; view: TableView; events: GameEvent[] }
  | { t: 'ack'; id: number; ok: true }
  | { t: 'ack'; id: number; ok: false; error: string }
  | { t: 'error'; code: 'room-not-found' | 'room-full' | 'bad-message' | 'seat-taken'; message: string }
  | { t: 'pong' }
  /** New feed lines. `reset` (on joining) means "this is the whole recent feed, replace yours". */
  | { t: 'feed'; entries: FeedEntry[]; reset?: true };

/* ---------- HTTP API ---------- */

export const FeedbackSchema = z.object({
  category: z.enum(['bug', 'idea', 'other']),
  message: z.string().trim().min(3).max(2000),
  contact: z.string().trim().max(120).optional(),
  room: z.string().max(12).optional(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;
