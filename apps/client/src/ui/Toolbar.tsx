import { LIMITS, type TableView } from '@omni/shared';

interface Props {
  view: TableView;
  code: string;
  canPlay: boolean;
  dealN: number;
  setDealN: (n: number) => void;
  placing: boolean;
  open: { table: boolean; score: boolean; help: boolean; feedback: boolean };
  sound: boolean;
  onTable: (el: HTMLElement) => void;
  onZone: () => void;
  onDeal: () => void;
  onShuffle: () => void;
  onCollect: () => void;
  onUndo: () => void;
  onScore: () => void;
  onHelp: () => void;
  onSound: () => void;
  onInvite: () => void;
  onFeedback: (el: HTMLElement) => void;
}

export function Toolbar(p: Props) {
  const undoTitle = p.view.undo
    ? `Undo ${p.view.undo.by}'s ${p.view.undo.label} (Ctrl+Z)`
    : 'Nothing to undo';
  return (
    <header className="bar">
      <a className="brand" href="/" style={{ textDecoration: 'none' }} aria-label="Omni Card home">
        OMNI<span>CARD</span>
      </a>
      <div className="tools" role="toolbar" aria-label="Table tools">
        {p.canPlay && (
          <>
            <button
              className={`btn hilite${p.open.table ? ' on' : ''}`}
              data-keeps-pop
              onClick={(e) => p.onTable(e.currentTarget)}
              title="Seats, decks, card size and table size"
            >
              TABLE
            </button>
            <button
              className={`btn${p.placing ? ' on' : ''}`}
              onClick={p.onZone}
              title="Place a new card zone on the table"
            >
              + ZONE
            </button>
            <div className="deal">
              <button
                className="btn sq"
                aria-label="Deal fewer"
                onClick={() => p.setDealN(Math.max(1, p.dealN - 1))}
              >
                -
              </button>
              <button className="btn" onClick={p.onDeal} title="Deal from the deck to every player">
                DEAL {p.dealN}
              </button>
              <button
                className="btn sq"
                aria-label="Deal more"
                onClick={() => p.setDealN(Math.min(LIMITS.dealMax, p.dealN + 1))}
              >
                +
              </button>
            </div>
            <button className="btn" onClick={p.onShuffle}>
              SHUFFLE
            </button>
            <button className="btn" onClick={p.onCollect} title="Gather every card back into the deck">
              COLLECT
            </button>
            <span className="sep" aria-hidden="true" />
            <button className="btn" onClick={p.onUndo} disabled={!p.view.undo} title={undoTitle}>
              UNDO
            </button>
          </>
        )}
        <button className={`btn${p.open.score ? ' on' : ''}`} onClick={p.onScore}>
          SCORE
        </button>
        <button className={`btn${p.open.help ? ' on' : ''}`} onClick={p.onHelp}>
          HELP
        </button>
        <button className="btn" aria-pressed={p.sound} onClick={p.onSound}>
          {p.sound ? 'SND ON' : 'SND OFF'}
        </button>
        <span className="sep" aria-hidden="true" />
        <button className="btn" onClick={p.onInvite} title="Copy the invite link">
          <span className="code">
            ROOM <b>{p.code}</b>
          </span>
        </button>
        <button
          className={`btn${p.open.feedback ? ' on' : ''}`}
          data-keeps-pop
          onClick={(e) => p.onFeedback(e.currentTarget)}
        >
          FEEDBACK
        </button>
      </div>
    </header>
  );
}
