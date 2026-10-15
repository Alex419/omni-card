import type { Intent, TableView } from '@omni/shared';

type Send = (intent: Intent) => void;

/** What you can do with a friend at the table. Card and note drops work on them too. */
export function SeatMenu({
  view,
  seat,
  name,
  send,
  onClose,
}: {
  view: TableView;
  seat: number;
  name: string;
  send: Send;
  onClose: () => void;
}) {
  const looking = view.peeking.some((p) => p.seat === seat);
  const asked = view.asksFromMe.includes(seat);
  const showing = view.shownTo.includes(seat);
  const act = (intent: Intent) => {
    send(intent);
    onClose();
  };
  return (
    <>
      <div className="ptitle">{name}</div>
      <div className="pacts col">
        {looking ? (
          <button className="btn" onClick={() => act({ type: 'endPeek', seat, role: 'viewer' })}>
            STOP LOOKING AT THEIR HAND
          </button>
        ) : (
          <button className="btn" disabled={asked} onClick={() => act({ type: 'askHand', seat })}>
            {asked ? 'WAITING FOR AN ANSWER...' : 'ASK TO SEE THEIR HAND'}
          </button>
        )}
        {showing ? (
          <button className="btn" onClick={() => act({ type: 'endPeek', seat, role: 'owner' })}>
            HIDE MY HAND FROM THEM
          </button>
        ) : (
          <button className="btn" onClick={() => act({ type: 'showHand', seat })}>
            SHOW THEM MY HAND
          </button>
        )}
      </div>
      <div className="pnote">EVERYONE SEES IN THE FEED WHO IS LOOKING AT WHOSE HAND.</div>
      <div className="pnote">DROP CARDS ON {name} TO GIVE THEM CARDS, OR STICK A NOTE ON THEM.</div>
    </>
  );
}
