import type { CSSProperties } from 'react';
import type { CardView } from '@omni/shared';
import { cardClass } from '../art/sheet';
import type { Layout } from './projection';

interface Props {
  L: Layout;
  hand: CardView[] | null;
  sel: ReadonlySet<string>;
  lifted: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
  hot: boolean;
  /** Receives the x centre of each card, for working out where a reordered card goes. */
  centersRef: { current: number[] };
}

/** Your hand, docked flat along the bottom of the screen and fanned like the prototype. */
export function HandDock({ L, hand, sel, lifted, fresh, hot, centersRef }: Props) {
  if (!hand) {
    return (
      <div className="hand">
        <div className="hand-empty watching">YOU ARE WATCHING. PICK AN OPEN SEAT TO PLAY</div>
      </div>
    );
  }
  const n = hand.length;
  const cw = 25 * L.hs;
  const ch = 35 * L.hs;
  const mid = (n - 1) / 2;
  const step = n > 1 ? Math.min(cw * 0.62, (L.SW - 32 - cw) / (n - 1)) : 0;
  const start = L.SW / 2 - ((n - 1) * step) / 2 - cw / 2;
  centersRef.current = hand.map((_, i) => start + i * step + cw / 2);
  return (
    <div className={`hand${hot ? ' hot' : ''}`} data-drop="hand">
      {!n && <div className="hand-empty">YOUR HAND: DRAG CARDS HERE</div>}
      {hand.map((c, i) => {
        const d = i - mid;
        const cls = [
          'card hc',
          cardClass(c.face, c.back),
          sel.has(c.vid) && 'sel',
          lifted.has(c.vid) && 'lifted',
          fresh.has(c.vid) && 'pop-anim',
        ];
        const style = {
          left: start + i * step,
          bottom: -ch * 0.26 - d * d * Math.min(1.4, 30 / (n * n || 1)),
          width: cw,
          height: ch,
          '--r': `${d * Math.min(4, 26 / Math.max(n, 1))}deg`,
          zIndex: i + 1,
        } as CSSProperties;
        return (
          <div
            key={c.vid}
            className={cls.filter(Boolean).join(' ')}
            data-card={c.vid}
            data-from="hand"
            style={style}
          />
        );
      })}
    </div>
  );
}
