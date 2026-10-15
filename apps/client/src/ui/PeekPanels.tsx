import type { Intent, TableView } from '@omni/shared';
import { cardClass } from '../art/sheet';

type Send = (intent: Intent) => void;

/**
 * Everything about looking at hands, just above your own hand:
 * requests waiting for your answer, who can see your hand, and the hands you've been shown.
 */
export function PeekPanels({
  view,
  send,
  nameOf,
}: {
  view: TableView;
  send: Send;
  nameOf: (seat: number) => string;
}) {
  const { asksForMe, shownTo, peeking } = view;
  if (!asksForMe.length && !shownTo.length && !peeking.length) return null;
  return (
    <div className="peeks">
      {asksForMe.map((s) => (
        <div key={`ask${s}`} className="peekbar ask" role="alert">
          <span>
            <b>{nameOf(s)}</b> WANTS TO SEE YOUR HAND
          </span>
          <button className="btn on" onClick={() => send({ type: 'answerAsk', seat: s, yes: true })}>
            SHOW
          </button>
          <button className="btn" onClick={() => send({ type: 'answerAsk', seat: s, yes: false })}>
            NO
          </button>
        </div>
      ))}
      {shownTo.length > 0 && (
        <div className="peekbar">
          <span>
            <b>{shownTo.map(nameOf).join(', ')}</b> CAN SEE YOUR HAND
          </span>
          <button className="btn" onClick={() => send({ type: 'endPeek', role: 'owner' })}>
            HIDE
          </button>
        </div>
      )}
      {peeking.map((p) => (
        <section key={`peek${p.seat}`} className="peekhand" aria-label={`${nameOf(p.seat)}'s hand`}>
          <div className="peekhead">
            <span>
              <b>{nameOf(p.seat)}</b>'S HAND
            </span>
            <button className="btn" onClick={() => send({ type: 'endPeek', seat: p.seat, role: 'viewer' })}>
              STOP LOOKING
            </button>
          </div>
          <div className="peekcards">
            {p.cards.length ? (
              p.cards.map((c) => <i key={c.vid} className={`pc ${cardClass(c.face, c.back)}`} />)
            ) : (
              <span className="pnote">NO CARDS</span>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
