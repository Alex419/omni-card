import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FEED, type Face, type FeedEntry } from '@omni/shared';

interface Props {
  feed: FeedEntry[];
  /** Your name, to mark your own lines. */
  me: string;
  onChat: (text: string) => boolean;
  onClose: () => void;
}

/**
 * The move feed and chat, docked beside the table. Every line comes from the server, which builds
 * it from the same public events as the toasts, so it never shows a card you couldn't have seen.
 */
export function FeedPanel({ feed, me, onChat, onClose }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  // Follow new lines, unless you've scrolled up to read something older.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [feed]);
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (onChat(text)) {
      setDraft('');
      pinned.current = true;
    }
  };

  return (
    <aside className="feed" aria-label="Moves and chat">
      <div className="feed-head">
        <span>FEED</span>
        <button className="btn sq" aria-label="Close the feed" onClick={onClose}>
          X
        </button>
      </div>
      <ol
        ref={listRef}
        className="feed-list"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {!feed.length && <li className="feed-empty">MOVES AND CHAT SHOW UP HERE</li>}
        {feed.map((e) => (
          <li key={e.id} className={`f-${e.kind}`}>
            {e.by && (
              <b className={`fname s${e.seat ?? 'x'}${e.by === me ? ' mine' : ''}`}>
                {e.by}
                {e.kind === 'chat' ? ':' : ''}
              </b>
            )}{' '}
            {e.kind === 'move' ? withCards(e.text, e.cards ?? []) : e.text}
          </li>
        ))}
      </ol>
      <form
        className="feed-say"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="field"
          placeholder="SAY SOMETHING..."
          aria-label="Chat message"
          maxLength={FEED.chatMax}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </aside>
  );
}

/** Replace `%c` in a feed line with little card chips. */
function withCards(text: string, cards: Face[]): ReactNode {
  const [before, after] = text.split('%c');
  if (after === undefined) return text;
  return (
    <>
      {before}
      {cards.map((f, i) => (
        <Fragment key={i}>
          <CardChip face={f} />{' '}
        </Fragment>
      ))}
      {after.trimStart()}
    </>
  );
}

const SUIT_NAMES: Record<string, string> = { S: 'SPADES', H: 'HEARTS', D: 'DIAMONDS', C: 'CLUBS' };

/** "7H" -> a tiny white card with "7" and a red heart pip. Jokers show as JOKER. */
function CardChip({ face }: { face: Face }) {
  const joker = face === 'JR' || face === 'JB';
  const suit = joker ? face : face.slice(-1);
  const red = suit === 'H' || suit === 'D' || face === 'JR';
  const name = joker ? `${red ? 'RED' : 'BLACK'} JOKER` : `${face.slice(0, -1)} OF ${SUIT_NAMES[suit]}`;
  return (
    <span className={`fcard${red ? ' red' : ''}`} title={name} aria-label={name} role="img">
      {joker ? 'JOKER' : face.slice(0, -1)}
      <i className={`pip-${suit}`} />
    </span>
  );
}
