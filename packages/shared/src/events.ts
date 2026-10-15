import type { Face } from './cards';

/**
 * Things that happened, broadcast alongside each new view so clients can play a sound,
 * show a toast or animate a reaction. Events are public: they never name a card.
 */
export type Sfx =
  'pick' | 'drop' | 'flip' | 'deal' | 'err' | 'give' | 'shuffle' | 'tidy' | 'stick' | 'rip' | 'huh' | 'join';

export type GameEvent =
  /**
   * `text` follows the actor's name: "ALEX" + " DEALT 5 EACH". It's the toast; empty means no toast.
   * `feed` is the line for the move feed when it differs from the toast (the feed says more than the
   * toasts do). `%c` in it stands for `cards`: faces that everyone could see, never a hidden card.
   */
  | { type: 'log'; by: number; text: string; sfx: Sfx; zone?: string; feed?: string; cards?: Face[] }
  /** Someone stuck a note on a player: they flash the shocked sprite and say the quip. */
  | { type: 'noteStuck'; by: number; on: number; quip: string }
  /** Lets the creator open the settings popover of the zone they just placed. */
  | { type: 'zoneCreated'; by: number; id: string }
  /** Room-level news (joins, leaves, undo) that isn't tied to a seat. */
  | { type: 'notice'; text: string; sfx: Sfx };
