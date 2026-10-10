import { useState } from 'react';
import {
  allCardIds,
  BACK_COUNT,
  LIMITS,
  MAX_DECKS,
  MAX_SEATS,
  MIN_SEATS,
  NOTE_COLORS,
  tableSizeFor,
  type CardSize,
  type Intent,
  type Note,
  type NoteColor,
  type TableView,
  type ZoneView,
} from '@omni/shared';
import { sendFeedback } from '../lib/api';

type Send = (intent: Intent) => void;

function Seg<T extends string | number | boolean>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} aria-pressed={v === value} onClick={() => v !== value && onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Swatches({ value, onPick }: { value: NoteColor; onPick: (c: NoteColor) => void }) {
  return (
    <div className="seg">
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          className={`sw n-${c}`}
          aria-pressed={c === value}
          aria-label={`${c} note`}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

/* ---------- zone settings (opened from the cog) ---------- */

export function ZoneMenu({ z, send, onClose }: { z: ZoneView; send: Send; onClose: () => void }) {
  // The name is edited locally and sent on every keystroke; the server merges the burst into one undo step.
  const [name, setName] = useState(z.name);
  const upd = (patch: Omit<Extract<Intent, { type: 'updateZone' }>, 'type' | 'id'>) =>
    send({ type: 'updateZone', id: z.id, ...patch });
  return (
    <>
      <div className="prow">
        <label htmlFor="zname">ZONE NAME</label>
        <input
          id="zname"
          className="field"
          maxLength={LIMITS.zoneName}
          value={name}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value.toUpperCase());
            upd({ name: e.target.value });
          }}
          onKeyDown={(e) => e.key === 'Enter' && onClose()}
        />
      </div>
      <div className="prow">
        <span>CARDS LAND</span>
        <Seg
          value={z.face}
          options={[
            ['up', 'FACE UP'],
            ['down', 'FACE DOWN'],
          ]}
          onPick={(face) => upd({ face })}
        />
      </div>
      <div className="prow">
        <span>LAYOUT</span>
        <Seg
          value={z.layout}
          options={[
            ['stack', 'STACK'],
            ['spread', 'SPREAD'],
          ]}
          onPick={(layout) => upd({ layout })}
        />
      </div>
      {z.layout === 'stack' && (
        <div className="prow">
          <span>PILE STYLE</span>
          <Seg
            value={z.mess}
            options={[
              [true, 'MESSY'],
              [false, 'NEAT'],
            ]}
            onPick={(mess) => upd({ mess })}
          />
        </div>
      )}
      <div className="prow">
        <span>DEAL + SHUFFLE FROM HERE</span>
        <Seg
          value={z.deck}
          options={[
            [true, 'DECK'],
            [false, 'NORMAL'],
          ]}
          onPick={(deck) => upd({ deck })}
        />
      </div>
      <div className="pacts">
        <button className="btn" onClick={() => send({ type: 'shuffleZone', id: z.id })}>
          SHUFFLE
        </button>
        <button className="btn" onClick={() => send({ type: 'flipZone', id: z.id })}>
          FLIP ALL
        </button>
        {z.messy && (
          <button className="btn" onClick={() => send({ type: 'tidyZone', id: z.id })}>
            TIDY
          </button>
        )}
        <button
          className="btn danger"
          onClick={() => {
            send({ type: 'deleteZone', id: z.id });
            onClose();
          }}
        >
          DELETE
        </button>
        <button className="btn on" onClick={onClose}>
          DONE
        </button>
      </div>
    </>
  );
}

/* ---------- table setup ---------- */

export function TableMenu({
  view,
  send,
  onStand,
  onClose,
}: {
  view: TableView;
  send: Send;
  onStand: () => void;
  onClose: () => void;
}) {
  const c = view.cfg;
  const total = allCardIds(c.decks, c.jokers).length;
  const seated = view.seats.filter((s) => s.player).map((s) => s.seat);
  const minSeats = Math.max(MIN_SEATS, ...seated.map((s) => s + 1));
  const resize = (tw: number, th: number) => send({ type: 'resizeTable', tw, th });
  return (
    <>
      <div className="ptitle">TABLE SETUP</div>
      <div className="prow">
        <span>SEATS AT THE TABLE</span>
        <div className="step">
          <button
            disabled={c.seats <= minSeats}
            aria-label="Fewer seats"
            onClick={() => send({ type: 'setSeats', count: c.seats - 1 })}
          >
            -
          </button>
          <b>{c.seats}</b>
          <button
            disabled={c.seats >= MAX_SEATS}
            aria-label="More seats"
            onClick={() => send({ type: 'setSeats', count: c.seats + 1 })}
          >
            +
          </button>
        </div>
      </div>
      <div className="prow">
        <span>DECKS: {total} CARDS. CHANGING THIS GATHERS EVERY CARD INTO THE DECK</span>
        <div className="step">
          <button
            disabled={c.decks <= 1}
            aria-label="Fewer decks"
            onClick={() => send({ type: 'setDecks', decks: c.decks - 1, jokers: c.jokers })}
          >
            -
          </button>
          <b>{c.decks}</b>
          <button
            disabled={c.decks >= MAX_DECKS}
            aria-label="More decks"
            onClick={() => send({ type: 'setDecks', decks: c.decks + 1, jokers: c.jokers })}
          >
            +
          </button>
        </div>
      </div>
      <div className="prow">
        <span>CARD BACKS: CLICK ONE TO CHANGE IT. MATCHING BACKS HIDE WHICH DECK A CARD CAME FROM</span>
        <div className="backs">
          {Array.from({ length: c.decks }, (_, d) => {
            const back = c.backs[d] ?? d % BACK_COUNT;
            return (
              <button
                key={d}
                className={`c-b${back}`}
                aria-label={`Deck ${d + 1} back, design ${back + 1} of ${BACK_COUNT}. Click for the next design.`}
                onClick={() => {
                  const backs = Array.from({ length: c.decks }, (_, i) => c.backs[i] ?? i % BACK_COUNT);
                  backs[d] = (back + 1) % BACK_COUNT;
                  send({ type: 'setBacks', backs });
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="prow">
        <span>JOKERS</span>
        <Seg
          value={c.jokers}
          options={[
            [true, '2 PER DECK'],
            [false, 'NONE'],
          ]}
          onPick={(jokers) => send({ type: 'setDecks', decks: c.decks, jokers })}
        />
      </div>
      <div className="prow">
        <span>CARD SIZE</span>
        <Seg<CardSize>
          value={c.size}
          options={[
            ['S', 'SMALL'],
            ['M', 'MEDIUM'],
            ['L', 'LARGE'],
          ]}
          onPick={(size) => send({ type: 'setCardSize', size })}
        />
      </div>
      <div className="prow">
        <span>
          TABLE SIZE {c.tw} x {c.th}. OR DRAG THE STRIPED CORNER
        </span>
        <div className="seg">
          <button onClick={() => resize(c.tw - 100, c.th - 64)}>SMALLER</button>
          <button onClick={() => resize(c.tw + 100, c.th + 64)}>BIGGER</button>
          <button onClick={() => resize(...tableSizeFor(c.seats))}>FIT</button>
        </div>
      </div>
      <div className="pacts">
        <button className="btn danger" onClick={onStand}>
          STAND UP
        </button>
        <button className="btn on" onClick={onClose}>
          DONE
        </button>
      </div>
    </>
  );
}

/* ---------- sticky notes ---------- */

export function ComposeMenu({
  initial,
  color,
  onColor,
  onReady,
  onClose,
}: {
  initial: string;
  color: NoteColor;
  onColor: (c: NoteColor) => void;
  onReady: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <>
      <div className="prow">
        <label htmlFor="ntext">WRITE A STICKY NOTE</label>
        <input
          id="ntext"
          className="field"
          maxLength={LIMITS.noteText}
          value={text}
          placeholder="KICK ME"
          autoComplete="off"
          autoFocus
          onChange={(e) => setText(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && onReady(text)}
        />
      </div>
      <div className="prow">
        <span>COLOR</span>
        <Swatches value={color} onPick={onColor} />
      </div>
      <div className="pacts">
        <button className="btn on" onClick={() => onReady(text)}>
          PUT ON PAD
        </button>
        <button className="btn" onClick={onClose}>
          CANCEL
        </button>
      </div>
    </>
  );
}

export function NoteMenu({ note, send, onClose }: { note: Note; send: Send; onClose: () => void }) {
  const [text, setText] = useState(note.text);
  return (
    <>
      <div className="prow">
        <label htmlFor="ntext">EDIT NOTE</label>
        <input
          id="ntext"
          className="field"
          maxLength={LIMITS.noteText}
          value={text}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value.toUpperCase());
            send({ type: 'editNote', id: note.id, text: e.target.value });
          }}
          onKeyDown={(e) => e.key === 'Enter' && onClose()}
        />
      </div>
      <div className="prow">
        <span>COLOR</span>
        <Swatches value={note.color} onPick={(color) => send({ type: 'editNote', id: note.id, color })} />
      </div>
      <div className="pacts">
        <button
          className="btn danger"
          onClick={() => {
            send({ type: 'ripNote', id: note.id });
            onClose();
          }}
        >
          RIP IT OFF
        </button>
        <button className="btn on" onClick={onClose}>
          DONE
        </button>
      </div>
    </>
  );
}

/* ---------- feedback ---------- */

export function FeedbackMenu({
  room,
  onDone,
}: {
  room?: string;
  onDone: (msg: string, err?: boolean) => void;
}) {
  const [category, setCategory] = useState<'bug' | 'idea' | 'other'>('idea');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (message.trim().length < 3) return onDone('WRITE A FEW WORDS FIRST', true);
    setBusy(true);
    try {
      await sendFeedback({ category, message, contact: contact || undefined, room });
      onDone('THANKS! FEEDBACK SENT');
    } catch (e) {
      onDone(String((e as Error).message).toUpperCase(), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="ptitle">SEND FEEDBACK</div>
      <div className="prow">
        <span>WHAT KIND?</span>
        <Seg
          value={category}
          options={[
            ['bug', 'BUG'],
            ['idea', 'IDEA'],
            ['other', 'OTHER'],
          ]}
          onPick={setCategory}
        />
      </div>
      <div className="prow">
        <label htmlFor="fbmsg">TELL US</label>
        <textarea
          id="fbmsg"
          className="field"
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          autoFocus
        />
      </div>
      <div className="prow">
        <label htmlFor="fbcontact">EMAIL OR NAME (OPTIONAL)</label>
        <input
          id="fbcontact"
          className="field"
          style={{ textTransform: 'none' }}
          maxLength={120}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </div>
      <div className="pacts">
        <button className="btn on" disabled={busy} onClick={submit}>
          {busy ? 'SENDING...' : 'SEND'}
        </button>
      </div>
    </>
  );
}
