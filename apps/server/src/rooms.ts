import type { Rng } from '@omni/shared';
import { Room, type RoomAnalytics } from './room';
import { roomCode } from './rng';

const EMPTY_ROOM_TTL_MS = 30 * 60_000;
const MAX_ROOMS = 500;

/**
 * All live rooms, in memory. A restart forgets every table: fine for a hobby deployment,
 * and the reason a persistence layer (Redis or Postgres) is the natural next step.
 */
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  constructor(
    private rng: Rng,
    private now: () => number = Date.now,
    private analytics?: RoomAnalytics,
  ) {}

  get size() {
    return this.rooms.size;
  }

  create(): Room | null {
    if (this.rooms.size >= MAX_ROOMS) this.sweep();
    if (this.rooms.size >= MAX_ROOMS) return null;
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    const room = new Room(code, this.rng, this.now, this.analytics);
    this.rooms.set(code, room);
    this.analytics?.track('room_created', { room: code });
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Forget rooms nobody has been connected to for a while. */
  sweep() {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      if (room.peerCount === 0 && now - room.lastActive > EMPTY_ROOM_TTL_MS) {
        room.end('idle');
        this.rooms.delete(code);
      }
    }
  }

  /** The server is stopping: every room ends now (rooms live in memory). */
  endAll() {
    for (const room of this.rooms.values()) room.end('shutdown');
  }
}
