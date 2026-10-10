import type { CSSProperties } from 'react';
import type { Note, NoteColor } from '@omni/shared';

interface Props {
  pad: { text: string; color: NoteColor } | null;
  compColor: NoteColor;
  mine: Note[];
  fresh: ReadonlySet<string>;
  onOpen: () => void;
}

/** The sticky-note pad (bottom left) and the notes people have stuck on you. */
export function NotePad({ pad, compColor, mine, fresh, onOpen }: Props) {
  return (
    <>
      <button
        className={`pad${pad ? ' ready' : ''}`}
        aria-label={
          pad ? `Sticky note ready: ${pad.text}. Drag it onto someone.` : 'Sticky note pad: write a note'
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="padstack" />
        <span className={`padtop n-${pad ? pad.color : compColor}`}>
          {pad ? (
            pad.text
          ) : (
            <>
              NOTE
              <br />
              PAD
            </>
          )}
        </span>
      </button>
      <div className="menotes">
        {mine.length > 0 && <span className="label">STUCK ON YOU (CLICK TO PEEL)</span>}
        {mine.map((n) => (
          <div
            key={n.id}
            className={`note mn n-${n.color}${fresh.has(n.id) ? ' pop-anim' : ''}`}
            data-note={n.id}
            style={{ '--nr': `${n.r}deg` } as CSSProperties}
          >
            <span>{n.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
