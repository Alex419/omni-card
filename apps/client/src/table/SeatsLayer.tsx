import type { CSSProperties } from 'react';
import type { Note } from '@omni/shared';
import { seatScreenPos, type Model } from './model';
import type { Layout } from './projection';

export interface Reaction {
  say?: string;
  shock?: boolean;
}

interface Props {
  L: Layout;
  m: Model;
  notes: Note[];
  reactions: Record<number, Reaction>;
  hot: string | null;
  /** Spectators get a SIT HERE button on open seats. */
  canSit: boolean;
  onSit: (seat: number) => void;
  fresh: ReadonlySet<string>;
}

/** Everyone else at the table, drawn under the plane so the table hides their laps. */
export function SeatsLayer({ L, m, notes, reactions, hot, canSit, onSit, fresh }: Props) {
  const crowd = m.others.length > 5;
  const placed = m.others
    .map((g, i) => ({ g, i, pos: seatScreenPos(L, m, g, crowd) }))
    .sort((a, b) => a.pos.depth - b.pos.depth);
  return (
    <div className="seats">
      {placed.map(({ g, i, pos }) => {
        const { sv } = g;
        const r = reactions[g.seat] ?? {};
        const p = sv.player;
        const cls = [
          'seat',
          `side-${g.side}`,
          r.shock && 'shook',
          !p && 'empty',
          p && !p.connected && 'away',
          hot === `seat:${g.seat}` && 'hot',
        ];
        const style = {
          left: pos.x,
          top: pos.y,
          '--k': pos.k,
          '--bd': `${-i * 0.37}s`,
          '--ed': `${3.6 + (i % 4) * 0.5}s`,
        } as CSSProperties;
        return (
          <div
            key={g.seat}
            className={cls.filter(Boolean).join(' ')}
            data-drop={`seat:${g.seat}`}
            style={style}
          >
            {r.say && <div className="say">{r.say}</div>}
            {canSit && sv.open ? (
              <button
                className="plate"
                onClick={() => onSit(g.seat)}
                aria-label={`Sit in seat ${g.seat + 1}`}
              >
                SIT
              </button>
            ) : (
              <div className="plate">
                {p ? p.name : 'OPEN'} {(p || sv.handCount > 0) && <b>{sv.handCount}</b>}
                {p && !p.connected && <small> AWAY</small>}
              </div>
            )}
            <div className="body">
              <div className={`sprite av-${g.seat}${r.shock ? ' shock' : ''}`} />
              {notes
                .filter((n) => n.at.kind === 'seat' && n.at.seat === g.seat)
                .map((n) => {
                  if (n.at.kind !== 'seat') return null;
                  return (
                    <div
                      key={n.id}
                      className={`note n-${n.color}${fresh.has(n.id) ? ' pop-anim' : ''}`}
                      data-note={n.id}
                      style={
                        {
                          left: `${n.at.x * 100}%`,
                          top: `${n.at.y * 100}%`,
                          '--nr': `${n.r}deg`,
                        } as CSSProperties
                      }
                    >
                      <span>{n.text}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
