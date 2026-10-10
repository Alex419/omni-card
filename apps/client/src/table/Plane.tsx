import type { CSSProperties } from 'react';
import type { LooseCardView, Note, ZoneView } from '@omni/shared';
import { cardClass } from '../art/sheet';
import { zoneBox, zoneCardSpots, type Model, type SeatGeom } from './model';
import { planeStyle, type Layout } from './projection';

/** Positions that differ from the server's while you drag (or until the server confirms the drop). */
export type Overrides = ReadonlyMap<string, { x: number; y: number }>;

export interface PlaneProps {
  L: Layout;
  m: Model;
  zones: ZoneView[];
  loose: LooseCardView[];
  notes: Note[];
  /** Selected table items: 'c:<vid>', 'z:<zoneId>', 'n:<noteId>'. */
  tsel: ReadonlySet<string>;
  overrides: Overrides;
  /** Cards being dragged or waiting for the server: drawn faded. */
  lifted: ReadonlySet<string>;
  /** Items following the pointer in a group drag: let pointer events pass through them. */
  moving: boolean;
  fresh: ReadonlySet<string>;
  hot: string | null;
  shuffling: string | null;
  openZone: string | null;
  canPlay: boolean;
  onCog: (id: string, el: HTMLElement) => void;
  onTidy: (id: string) => void;
}

const px = (n: number) => `${n}px`;

export function Plane(p: PlaneProps) {
  const { L, m } = p;
  const st = planeStyle(L);
  const style = {
    width: px(st.width),
    height: px(st.height),
    left: px(st.left),
    top: px(st.top),
    transform: st.transform,
    '--cw': px(m.CW),
    '--ch': px(m.CH),
  } as CSSProperties;
  const at = (key: string, x: number, y: number) => {
    const o = p.overrides.get(key);
    return m.toView(o?.x ?? x, o?.y ?? y);
  };

  return (
    <div className="plane wood" style={style}>
      <div className="felt" data-drop="table" />
      <div className="felt-mark" style={{ top: Math.round(m.VH * 0.3) }}>
        OMNI CARD
      </div>
      <div className="layer">
        {m.others.map((g) => (
          <Fan key={g.seat} g={g} m={m} hot={p.hot === `seat:${g.seat}`} />
        ))}
        {p.zones.map((z) => {
          const v = at(`z:${z.id}`, z.x, z.y);
          return <Zone key={z.id} z={z} x={v.x} y={v.y} {...p} />;
        })}
        {p.loose.map((c) => {
          const v = at(`c:${c.vid}`, c.x, c.y);
          const k = `c:${c.vid}`;
          const cls = [
            'card tc',
            cardClass(c.face, c.back),
            p.tsel.has(k) && 'tsel',
            p.tsel.has(k) && p.moving && 'moving',
            p.lifted.has(c.vid) && 'lifted',
            p.fresh.has(c.vid) && 'pop-anim',
          ];
          return (
            <div
              key={c.vid}
              className={cls.filter(Boolean).join(' ')}
              data-card={c.vid}
              data-from="loose"
              style={{ left: v.x, top: v.y, '--r': `${c.r}deg` } as CSSProperties}
            />
          );
        })}
        {p.notes.map((n) => {
          if (n.at.kind !== 'table') return null;
          const k = `n:${n.id}`;
          const v = at(k, n.at.x, n.at.y);
          const cls = [
            'note tn',
            `n-${n.color}`,
            p.tsel.has(k) && 'tsel',
            p.tsel.has(k) && p.moving && 'moving',
            p.fresh.has(n.id) && 'pop-anim',
          ];
          return (
            <div
              key={n.id}
              className={cls.filter(Boolean).join(' ')}
              data-note={n.id}
              style={{ left: v.x, top: v.y, '--nr': `${n.r}deg` } as CSSProperties}
            >
              <span>{n.text}</span>
            </div>
          );
        })}
        {p.canPlay && (
          <div
            className="grip"
            data-grip
            title="Drag to resize the table"
            style={{ left: m.VW - 34, top: 4 }}
          />
        )}
      </div>
    </div>
  );
}

function Fan({ g, m, hot }: { g: SeatGeom; m: Model; hot: boolean }) {
  const backs = g.sv.handBacks;
  const n = backs.length;
  const sc = Math.max(0.55, Math.min(0.78, g.room / 360));
  const cw = m.CW * sc;
  const ch = m.CH * sc;
  const mid = (n - 1) / 2;
  const step = n > 1 ? Math.min(cw * 0.26, Math.max(4, (g.room * 0.75 - cw) / (n - 1))) : 0;
  const w = Math.max((n - 1) * step + cw, cw);
  return (
    <div
      className={`fan${hot ? ' hot' : ''}`}
      data-drop={`seat:${g.seat}`}
      style={{
        left: g.fan.x,
        top: g.fan.y,
        width: w,
        height: ch + 20,
        transform: `translate(-50%,-50%) rotate(${g.fan.r}deg)`,
      }}
    >
      {backs.map((b, i) => {
        const d = i - mid;
        return (
          <i
            key={i}
            className={`card fc c-b${b}`}
            style={{
              left: i * step,
              top: d * d * 0.9,
              width: cw,
              height: ch,
              transform: `rotate(${d * Math.min(4, 30 / n)}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

function Zone({ z, x, y, ...p }: { z: ZoneView; x: number; y: number } & PlaneProps) {
  const box = zoneBox(z, p.m);
  const spots = zoneCardSpots(z, p.m);
  const k = `z:${z.id}`;
  const cls = [
    'zone',
    z.messy && 'pile',
    p.tsel.has(k) && 'tsel',
    p.tsel.has(k) && p.moving && 'moving',
    p.hot === `zone:${z.id}` && 'hot',
    p.shuffling === z.id && 'shuffling',
    p.openZone === z.id && 'named',
  ];
  return (
    <div
      className={cls.filter(Boolean).join(' ')}
      data-drop={`zone:${z.id}`}
      data-zone={z.id}
      style={{ left: x, top: y, width: box.w, height: box.h }}
    >
      <div className="zname">
        {z.deck && <span className="zdeck">&#9632;</span>}
        {z.name}
        <span className={`zface${z.face === 'up' ? '' : ' dn'}`}>{z.face === 'up' ? 'UP' : 'DN'}</span>
      </div>
      {z.count === 0 && (
        <span className="zempty">
          {z.face === 'up' ? (
            <>
              FACE
              <br />
              UP
            </>
          ) : (
            <>
              FACE
              <br />
              DOWN
            </>
          )}
        </span>
      )}
      {z.cards.map((c, i) => {
        const s = spots[i]!;
        // In a stack only the top card can be grabbed; the rest let clicks through to the zone.
        const grabbable = z.layout === 'spread' || s.depth === 0;
        const face = c.face ? `c-${c.face}` : c.up ? 'c-blank' : `c-b${c.back}`;
        const cl = ['card tc', face, p.lifted.has(c.vid) && 'lifted', p.fresh.has(c.vid) && 'pop-anim'];
        return (
          <div
            key={c.vid}
            className={cl.filter(Boolean).join(' ')}
            data-card={grabbable ? c.vid : undefined}
            data-from={grabbable ? `zone:${z.id}` : undefined}
            style={
              {
                left: s.x,
                top: s.y,
                '--r': `${s.r}deg`,
                pointerEvents: grabbable ? undefined : 'none',
              } as CSSProperties
            }
          />
        );
      })}
      {z.layout === 'stack' && z.count > 1 && <span className="count">{z.count}</span>}
      {p.canPlay && (
        <>
          <button className="zbtn zgrip" data-zgrip={z.id} aria-label={`Move ${z.name}`} title="Drag to move">
            <i className="i-grip" />
          </button>
          {z.messy && (
            <button
              className="zbtn ztidy"
              onClick={() => p.onTidy(z.id)}
              aria-label={`Straighten ${z.name}`}
              title="Straighten the pile"
            >
              TIDY
            </button>
          )}
          <button
            className={`zbtn zcog${p.openZone === z.id ? ' open' : ''}`}
            onClick={(e) => p.onCog(z.id, e.currentTarget)}
            aria-label={`Settings for ${z.name}`}
            title={`${z.name} settings`}
          >
            <i className="i-cog" />
          </button>
        </>
      )}
    </div>
  );
}
