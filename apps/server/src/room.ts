import {
  applyIntent,
  LIMITS,
  MAX_SEATS,
  newGame,
  seatIsOpen,
  viewFor,
  type GameEvent,
  type GameState,
  type Intent,
  type Player,
  type Rng,
  type ServerMessage,
} from '@omni/shared';
import { randomId } from './rng';

/** Anything we can send messages to. A WebSocket in production, a fake in tests. */
export interface Peer {
  send(msg: ServerMessage): void;
}

const MAX_PLAYERS = MAX_SEATS + 16; // seated players plus spectators

/** Upper-case printable ASCII only: the pixel font has nothing else. */
export function cleanName(raw: string): string {
  return (
    raw
      .toUpperCase()
      .replace(/[^A-Z0-9 !?.'&+-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, LIMITS.playerName) || 'PLAYER'
  );
}

/**
 * One table. Owns the authoritative GameState, the connected peers, and the mapping from secret
 * reconnect tokens to players. Every change goes through applyIntent, then every peer gets a
 * fresh view redacted for its own player.
 */
export class Room {
  game: GameState;
  /** Last time anything happened, for cleaning up abandoned rooms. */
  lastActive: number;
  private tokens = new Map<string, string>(); // secret token -> player id
  private peers = new Map<Peer, string>(); // peer -> player id

  constructor(
    readonly code: string,
    private rng: Rng,
    private now: () => number = Date.now,
  ) {
    this.game = newGame(rng);
    this.lastActive = now();
  }

  get peerCount() {
    return this.peers.size;
  }

  /** Join or rejoin. The same token always maps back to the same player, seat and hand. */
  join(peer: Peer, rawName: string, token: string): Player | null {
    const existingId = this.tokens.get(token);
    let player = existingId ? this.game.players.find((p) => p.id === existingId) : undefined;
    if (!player) {
      if (this.game.players.length >= MAX_PLAYERS) return null;
      // Whoever opens an empty table (normally its creator) sits down straight away; others pick a seat.
      const firstIn = !this.game.players.some((p) => p.seat !== null);
      player = {
        id: randomId(),
        name: this.uniqueName(cleanName(rawName)),
        seat: firstIn ? 0 : null,
        connected: true,
        awaySince: null,
      };
      this.tokens.set(token, player.id);
      this.setPlayers([...this.game.players, player]);
      this.notice(`${player.name} JOINED`, 'join');
    } else {
      this.updatePlayer(player.id, { connected: true, awaySince: null });
      if (!this.connected(player.id)) this.notice(`${player.name} IS BACK`, 'join');
    }
    this.peers.set(peer, player.id);
    peer.send({ t: 'welcome', room: this.code, playerId: player.id });
    this.broadcast([]);
    return this.player(player.id)!;
  }

  leave(peer: Peer) {
    const id = this.peers.get(peer);
    if (!id) return;
    this.peers.delete(peer);
    if (this.connected(id)) return; // another tab of the same player is still open
    const p = this.player(id)!;
    if (p.seat === null) {
      // Spectators have nothing to come back to; if they return they rejoin fresh.
      this.setPlayers(this.game.players.filter((q) => q.id !== id));
      for (const [tok, pid] of this.tokens) if (pid === id) this.tokens.delete(tok);
    } else {
      this.updatePlayer(id, { connected: false, awaySince: this.now() });
      this.notice(`${p.name} LEFT THE TABLE`, 'drop');
    }
    this.broadcast([]);
  }

  sit(peer: Peer, seat: number): string | null {
    const id = this.peers.get(peer);
    if (!id) return 'JOIN FIRST';
    const me = this.player(id)!;
    if (me.seat === seat) return null;
    if (seat >= this.game.table.cfg.seats) return 'NO SUCH SEAT';
    if (!seatIsOpen(this.game.players, seat, this.now())) return 'THAT SEAT IS TAKEN';
    // A seat whose player has been gone a while can be taken over; they become a spectator.
    const away = this.game.players.find((p) => p.seat === seat);
    if (away) this.updatePlayer(away.id, { seat: null });
    this.updatePlayer(id, { seat });
    this.notice(`${me.name} SAT DOWN`, 'join');
    this.broadcast([]);
    return null;
  }

  stand(peer: Peer) {
    const id = this.peers.get(peer);
    if (!id) return;
    this.updatePlayer(id, { seat: null });
    this.broadcast([]);
  }

  /** Apply a player's intent. Returns an error message for the sender, or null on success. */
  intent(peer: Peer, intent: Intent): string | null {
    const id = this.peers.get(peer);
    const me = id ? this.player(id) : undefined;
    if (!me) return 'JOIN FIRST';
    if (me.seat === null) return 'TAKE A SEAT TO PLAY';
    const r = applyIntent(this.game, intent, {
      seat: me.seat,
      name: me.name,
      rng: this.rng,
      now: this.now(),
    });
    if (!r.ok) return r.error;
    this.game = r.game;
    this.broadcast(r.events);
    return null;
  }

  /** Send every peer its own redacted view. Redaction happens per player, never per room. */
  broadcast(events: GameEvent[]) {
    const all = [...this.pending, ...events];
    this.pending = [];
    const now = this.now();
    this.lastActive = now;
    for (const [peer, id] of this.peers)
      peer.send({ t: 'view', view: viewFor(this.game, id, now), events: all });
  }

  /** Room news (joins, leaves) queued to go out with the next broadcast. */
  private pending: GameEvent[] = [];
  private notice(text: string, sfx: 'join' | 'drop') {
    this.pending.push({ type: 'notice', text, sfx });
  }

  private connected(id: string) {
    for (const pid of this.peers.values()) if (pid === id) return true;
    return false;
  }
  private player(id: string) {
    return this.game.players.find((p) => p.id === id);
  }
  private setPlayers(players: Player[]) {
    this.game = { ...this.game, players };
  }
  private updatePlayer(id: string, patch: Partial<Player>) {
    this.setPlayers(this.game.players.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  private uniqueName(name: string) {
    const taken = new Set(this.game.players.map((p) => p.name));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name.slice(0, LIMITS.playerName - 2)} ${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
