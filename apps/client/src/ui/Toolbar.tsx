import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LIMITS, type TableView } from '@omni/shared';
import { anchorOf, Popover, type Anchor } from './Popover';
import { fitToolbar } from './toolbarFit';

interface Props {
  view: TableView;
  code: string;
  canPlay: boolean;
  dealN: number;
  setDealN: (n: number) => void;
  placing: boolean;
  open: { table: boolean; score: boolean; help: boolean; feedback: boolean; feed: boolean };
  /** Feed lines from others since you last had the feed open. */
  unread: number;
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
  onFeed: () => void;
}

/** One toolbar entry: how it looks in the bar and how it appears in the MORE menu. */
interface Item {
  id: string;
  /** Higher stays in the bar longer when space runs out. */
  priority: number;
  /** Left: game actions. Right: room, sound. */
  side: 'left' | 'right';
  bar: ReactNode;
  /** The MORE-menu version. `anchor` is the MORE button, for items that open a popover. */
  menu: (anchor: HTMLElement) => ReactNode;
}

const GAP = 8;

/**
 * The toolbar uses the "priority+" pattern: buttons that don't fit move into a MORE menu,
 * least important first, instead of silently scrolling out of view. FEEDBACK always stays visible.
 */
export function Toolbar(p: Props) {
  const undoTitle = p.view.undo
    ? `Undo ${p.view.undo.by}'s ${p.view.undo.label} (Ctrl+Z)`
    : 'Nothing to undo';
  const soundLabel = p.sound ? 'Sound on' : 'Sound off';
  const feedLabel = (
    <>
      FEED
      {p.unread > 0 && (
        <span className="unread" aria-label={`${p.unread} new`}>
          {p.unread > 99 ? '99+' : p.unread}
        </span>
      )}
    </>
  );
  const dealGroup = (
    <div className="deal">
      <button className="btn sq" aria-label="Deal fewer" onClick={() => p.setDealN(Math.max(1, p.dealN - 1))}>
        -
      </button>
      <button className="btn" onClick={p.onDeal} title="Deal from the deck to every player">
        DEAL
      </button>
      <DealCount n={p.dealN} set={p.setDealN} />
      <button
        className="btn sq"
        aria-label="Deal more"
        onClick={() => p.setDealN(Math.min(LIMITS.dealMax, p.dealN + 1))}
      >
        +
      </button>
    </div>
  );
  const btn = (
    label: ReactNode,
    onClick: (el: HTMLElement) => void,
    extra: { on?: boolean; cls?: string; title?: string; disabled?: boolean; keepsPop?: boolean } = {},
  ) => (
    <button
      className={`btn${extra.cls ? ` ${extra.cls}` : ''}${extra.on ? ' on' : ''}`}
      onClick={(e) => onClick(e.currentTarget)}
      title={extra.title}
      disabled={extra.disabled}
      data-keeps-pop={extra.keepsPop || undefined}
    >
      {label}
    </button>
  );

  const items: Item[] = [
    ...(p.canPlay
      ? ([
          {
            id: 'table',
            priority: 90,
            side: 'left',
            bar: btn('TABLE', p.onTable, {
              cls: 'hilite',
              on: p.open.table,
              keepsPop: true,
              title: 'Seats, decks, card backs, card size and table size',
            }),
            menu: (a) => btn('TABLE', () => p.onTable(a), { on: p.open.table, keepsPop: true }),
          },
          {
            id: 'zone',
            priority: 40,
            side: 'left',
            bar: btn('+ ZONE', p.onZone, { on: p.placing, title: 'Place a new card zone on the table' }),
            menu: () => btn('+ ZONE', p.onZone, { on: p.placing }),
          },
          { id: 'deal', priority: 100, side: 'left', bar: dealGroup, menu: () => dealGroup },
          {
            id: 'shuffle',
            priority: 50,
            side: 'left',
            bar: btn('SHUFFLE', p.onShuffle),
            menu: () => btn('SHUFFLE', p.onShuffle),
          },
          {
            id: 'collect',
            priority: 30,
            side: 'left',
            bar: btn('COLLECT', p.onCollect, { title: 'Gather every card back into the deck' }),
            menu: () => btn('COLLECT', p.onCollect),
          },
          {
            id: 'undo',
            priority: 80,
            side: 'left',
            bar: btn('UNDO', p.onUndo, { disabled: !p.view.undo, title: undoTitle }),
            menu: () => btn('UNDO', p.onUndo, { disabled: !p.view.undo, title: undoTitle }),
          },
        ] satisfies Item[])
      : []),
    {
      id: 'feed',
      priority: 75,
      side: 'left',
      bar: btn(feedLabel, p.onFeed, { on: p.open.feed, title: 'Moves and chat' }),
      menu: () => btn(feedLabel, p.onFeed, { on: p.open.feed }),
    },
    {
      id: 'score',
      priority: 20,
      side: 'left',
      bar: btn('SCORE', p.onScore, { on: p.open.score }),
      menu: () => btn('SCORE', p.onScore, { on: p.open.score }),
    },
    {
      id: 'help',
      priority: 10,
      side: 'left',
      bar: btn('HELP', p.onHelp, { on: p.open.help }),
      menu: () => btn('HELP', p.onHelp, { on: p.open.help }),
    },
    {
      id: 'room',
      priority: 70,
      side: 'right',
      bar: btn(
        <span className="code">
          ROOM <b>{p.code}</b>
        </span>,
        p.onInvite,
        { title: 'Copy the invite link' },
      ),
      menu: () =>
        btn(
          <span className="code">
            COPY INVITE <b>{p.code}</b>
          </span>,
          p.onInvite,
        ),
    },
    {
      id: 'sound',
      priority: 60,
      side: 'right',
      bar: (
        <button
          className="btn icon"
          aria-label={soundLabel}
          title={soundLabel}
          aria-pressed={p.sound}
          onClick={p.onSound}
        >
          <i className={p.sound ? 'i-snd-on' : 'i-snd-off'} />
        </button>
      ),
      menu: () => (
        <button className="btn" aria-pressed={p.sound} onClick={p.onSound}>
          <i className={`menu-icon ${p.sound ? 'i-snd-on' : 'i-snd-off'}`} />{' '}
          {p.sound ? 'SOUND ON' : 'SOUND OFF'}
        </button>
      ),
    },
  ];

  const feedback = btn('FEEDBACK', p.onFeedback, {
    cls: 'fb',
    on: p.open.feedback,
    keepsPop: true,
    title: 'Report a bug or share an idea',
  });

  /* ---------- measuring what fits ---------- */

  const barRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<string> | null>(null);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // A string that changes whenever an item's width could change, so we re-measure.
  const shapeKey = `${p.canPlay}|${p.dealN}|${p.code}|${p.sound}|${Math.min(p.unread, 100).toString().length * Math.sign(p.unread)}`;

  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;
    const fit = () => {
      const width = (sel: string) => measure.querySelector<HTMLElement>(sel)?.offsetWidth ?? 0;
      const style = getComputedStyle(bar);
      const inner = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // Always shown: the brand, the bar's 16px gap after it, FEEDBACK and the gap before it,
      // plus the toolbar's own side padding and a few pixels of slack.
      const fixed = width('[data-m="brand"]') + 16 + width('[data-m="feedback"]') + GAP + 8 + 4;
      const widths = [...measure.querySelectorAll<HTMLElement>('[data-m^="item:"]')].map((el) => ({
        id: el.dataset.m!.slice(5),
        width: el.offsetWidth,
        priority: Number(el.dataset.p),
      }));
      const next = fitToolbar(widths, inner - fixed, width('[data-m="more"]'), GAP);
      setVisible((prev) => (prev && [...prev].sort().join() === [...next].sort().join() ? prev : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [shapeKey]);

  const shown = (it: Item) => !visible || visible.has(it.id);
  const hidden = items.filter((it) => !shown(it));
  const group = (side: Item['side']) => items.filter((it) => it.side === side && shown(it));

  return (
    <header className="bar" ref={barRef}>
      <a className="brand" href="/" style={{ textDecoration: 'none' }} aria-label="Omni Card home">
        OMNI<span>CARD</span>
      </a>
      <div className="tools" role="toolbar" aria-label="Table tools">
        {group('left').map((it) => (
          <div className="titem" key={it.id}>
            {it.bar}
          </div>
        ))}
        {hidden.length > 0 && (
          <button
            ref={moreRef}
            className={`btn more${menu ? ' on' : ''}`}
            data-keeps-pop
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={(e) => setMenu(menu ? null : anchorOf(e.currentTarget))}
          >
            MORE
          </button>
        )}
        <div className="tools-right">
          {group('right').map((it) => (
            <div className="titem" key={it.id}>
              {it.bar}
            </div>
          ))}
          {feedback}
        </div>
      </div>

      {/* Invisible copy of every item, so each one's width can be measured even while it's in MORE. */}
      <div className="bar-measure" ref={measureRef} aria-hidden="true" inert>
        <span data-m="brand" className="brand">
          OMNI<span>CARD</span>
        </span>
        {items.map((it) => (
          <div key={it.id} data-m={`item:${it.id}`} data-p={it.priority} className="titem">
            {it.bar}
          </div>
        ))}
        <div data-m="more" className="titem">
          <span className="btn more">MORE</span>
        </div>
        <div data-m="feedback" className="titem">
          {feedback}
        </div>
      </div>

      {menu && hidden.length > 0 && (
        <Popover anchor={menu} onClose={() => setMenu(null)} label="More tools">
          <div
            className="more-menu"
            role="menu"
            onClick={(e) => (e.target as HTMLElement).closest('.btn:not(.sq)') && setMenu(null)}
          >
            {hidden.map((it) => (
              <div className="titem" key={it.id}>
                {it.menu(moreRef.current!)}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </header>
  );
}

/**
 * The number of cards DEAL hands out, as a box you can type into for big jumps (- and + still nudge it).
 * While you type it keeps your draft; the value is clamped and saved when you press Enter or click away.
 */
function DealCount({ n, set }: { n: number; set: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = parseInt(draft ?? '', 10);
    if (Number.isFinite(v)) set(Math.min(LIMITS.dealMax, Math.max(1, v)));
    setDraft(null);
  };
  return (
    <input
      className="field dealn"
      inputMode="numeric"
      maxLength={2}
      aria-label="Cards to deal to each player"
      title={`Cards to deal to each player (1-${LIMITS.dealMax})`}
      value={draft ?? String(n)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}
