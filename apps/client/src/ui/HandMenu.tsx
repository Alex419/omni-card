import type { Intent } from '@omni/shared';

type Send = (intent: Intent) => void;

/**
 * Things you can do with your own hand. A menu rather than a row of buttons so new options
 * can be added without crowding the hand.
 */
export function HandMenu({
  send,
  onClose,
  cards,
  shownTo,
}: {
  send: Send;
  onClose: () => void;
  cards: number;
  /** Names of the players who can see your hand. */
  shownTo: string[];
}) {
  const sort = (by: 'rank' | 'suit') => {
    send({ type: 'sortHand', by });
    onClose();
  };
  return (
    <>
      <div className="ptitle">YOUR HAND</div>
      <div className="prow">
        <span>SORT</span>
        <div className="seg">
          <button disabled={cards < 2} onClick={() => sort('rank')}>
            BY RANK
          </button>
          <button disabled={cards < 2} onClick={() => sort('suit')}>
            BY SUIT
          </button>
        </div>
        <span>ACES HIGH, JOKERS LAST</span>
      </div>
      <div className="prow">
        <span>WHO CAN SEE IT</span>
        {shownTo.length ? (
          <div className="pacts">
            <span className="pnote">{shownTo.join(', ')}</span>
            <button
              className="btn"
              onClick={() => {
                send({ type: 'endPeek', role: 'owner' });
                onClose();
              }}
            >
              HIDE MY HAND
            </button>
          </div>
        ) : (
          <span className="pnote">ONLY YOU. CLICK A FRIEND TO SHOW THEM.</span>
        )}
      </div>
    </>
  );
}
