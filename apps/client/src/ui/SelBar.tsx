interface Props {
  count: number;
  cards: number;
  onAction: (a: 'pile' | 'flip' | 'clear') => void;
}

/** Shown while table items are box-selected. */
export function SelBar({ count, cards, onAction }: Props) {
  return (
    <div className="selbar">
      {count} PICKED
      {cards > 1 && (
        <button className="btn" onClick={() => onAction('pile')}>
          PILE UP
        </button>
      )}
      {cards > 0 && (
        <button className="btn" onClick={() => onAction('flip')}>
          FLIP
        </button>
      )}
      <button className="btn" onClick={() => onAction('clear')}>
        CLEAR
      </button>
    </div>
  );
}
