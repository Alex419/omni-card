import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { resizedConfig } from '@omni/shared';
import type { CardView, Intent, NoteColor, NoteSpot, Source, Target, TableView } from '@omni/shared';
import { cardClass } from '../art/sheet';
import { ensureAudio, setSound, SFX, soundOn, tick } from '../audio/sfx';
import { savedPref, savePref } from '../lib/identity';
import type { RoomClient } from '../net/RoomClient';
import { ComposeMenu, FeedbackMenu, NoteMenu, TableMenu, ZoneMenu } from '../ui/menus';
import { NotePad } from '../ui/NotePad';
import { anchorOf, Popover, type Anchor } from '../ui/Popover';
import { ScorePad } from '../ui/ScorePad';
import { SelBar } from '../ui/SelBar';
import { Toast, useToast } from '../ui/Toast';
import { Toolbar } from '../ui/Toolbar';
import { HandDock } from './HandDock';
import { buildModel, previewResize } from './model';
import { Plane } from './Plane';
import { fit, proj, unproj, type Layout } from './projection';
import { SeatsLayer, type Reaction } from './SeatsLayer';

/**
 * The table screen. The server's TableView is the single source of truth for what's on the table;
 * this component only adds local, short-lived UI state on top: what you've selected, what you're
 * dragging, which popover is open, and positions that are mid-drag or waiting for the server.
 *
 * Pointer handling is a small state machine (the `Drag` union below) driven by window listeners,
 * ported from the prototype. Every finished gesture becomes exactly one intent sent to the server.
 */

type XY = { x: number; y: number };

type Drag =
  | {
      kind: 'card';
      from: string;
      vid: string;
      x0: number;
      y0: number;
      started: boolean;
      vids: string[];
      cards: CardView[];
      up: boolean;
      hot: string | null;
      x: number;
      y: number;
      /** Holding still on a pile's top card counts up how many cards the drag takes. */
      count: number;
      /** How many cards that pile has, so the count can't run past it. Null when holding doesn't count. */
      pile: number | null;
    }
  | {
      kind: 'note';
      nid: string;
      x0: number;
      y0: number;
      started: boolean;
      text: string;
      color: NoteColor;
      hot: string | null;
      x: number;
      y: number;
    }
  | { kind: 'zone'; id: string; x0: number; y0: number; moved: boolean; dx: number; dy: number }
  | {
      kind: 'group';
      x0: number;
      y0: number;
      moved: boolean;
      p0: XY;
      orig: Map<string, XY>;
      hot: string | null;
    }
  | {
      kind: 'marquee';
      x0: number;
      y0: number;
      moved: boolean;
      base: Set<string>;
      rect: { x: number; y: number; w: number; h: number } | null;
    }
  | { kind: 'resize'; x0: number; y0: number; moved: boolean };

type PopState =
  | { mode: 'zone'; id: string; anchor: Anchor }
  | { mode: 'table'; anchor: Anchor }
  | { mode: 'compose'; anchor: Anchor }
  | { mode: 'note'; id: string; anchor: Anchor }
  | { mode: 'feedback'; anchor: Anchor };

const nameOf = (v: TableView, seat: number) => v.seats[seat]?.player?.name ?? `SEAT ${seat + 1}`;
const sourceOf = (from: string): Source =>
  from === 'hand'
    ? { kind: 'hand' }
    : from === 'loose'
      ? { kind: 'loose' }
      : { kind: 'zone', id: from.slice(5) };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Holding the pointer still on a pile adds one more card to the grab this often. */
const HOLD_STEP_MS = 750;

export function Game({ client, view, code }: { client: RoomClient; view: TableView; code: string }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = sceneRef.current!;
    const measure = () => {
      if (drag.current?.kind === 'resize') return;
      const r = el.getBoundingClientRect();
      setScene({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // While you drag the resize grip the table is resized locally; the server hears about it once, on release.
  const [preview, setPreview] = useState<{ tw: number; th: number } | null>(null);
  const shown = useMemo(
    () => (preview ? previewResize(view, preview.tw, preview.th) : view),
    [view, preview],
  );
  const m = useMemo(() => buildModel(shown), [shown]);
  const fitted = useMemo(
    () => fit(scene.w, scene.h, m.VW, m.VH, m.sizeMul),
    [scene.w, scene.h, m.VW, m.VH, m.sizeMul],
  );
  // While you drag the resize grip, keep the camera still so the corner stays under your pointer.
  const frozen = useRef<Layout | null>(null);
  const L: Layout = frozen.current ? { ...frozen.current, W: m.VW, H: m.VH } : fitted;
  useEffect(() => document.documentElement.style.setProperty('--handH', `${L.handH}px`), [L.handH]);

  const seat = view.you.seat;
  const canPlay = seat !== null;

  /* ---------- local UI state ---------- */
  const [sel, setSel] = useState<Set<string>>(new Set()); // selected cards in your hand
  const [tsel, setTsel] = useState<Set<string>>(new Set()); // selected table items
  const [pop, setPop] = useState<PopState | null>(null);
  const [pad, setPad] = useState<{ text: string; color: NoteColor } | null>(null);
  const [compColor, setCompColor] = useState<NoteColor>('yel');
  const [dealN, setDealN] = useState(5);
  const [placing, setPlacing] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [showHint, setShowHint] = useState(() => savedPref('hint') !== 'off');
  const [sound, setSoundState] = useState(soundOn());
  const [reactions, setReactions] = useState<Record<number, Reaction>>({});
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [shuffling, setShuffling] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set()); // vids waiting for the server
  const { toast, show } = useToast();

  const drag = useRef<Drag | null>(null);
  const overrides = useRef(new Map<string, XY>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const handCenters = useRef<number[]>([]);

  // Handlers registered once on window read the latest values through this ref.
  const live = useRef({ view: shown, m, L, sel, tsel, pad, canPlay, placing, preview });
  live.current = { view: shown, m, L, sel, tsel, pad, canPlay, placing, preview };

  /* ---------- talking to the server ---------- */

  /** Send an intent. `hide` keeps cards faded and `keep` keeps dragged positions until the server answers. */
  const send = useCallback(
    async (intent: Intent, opts: { hide?: string[]; keep?: string[] } = {}) => {
      if (opts.hide?.length) setPending((s) => new Set([...s, ...opts.hide!]));
      const err = await client.send(intent);
      if (opts.hide?.length)
        setPending((s) => {
          const n = new Set(s);
          opts.hide!.forEach((v) => n.delete(v));
          return n;
        });
      if (opts.keep?.length) {
        opts.keep.forEach((k) => overrides.current.delete(k));
        rerender();
      }
      if (err) {
        show(err, true);
        SFX.err();
      }
      return err;
    },
    [client, show],
  );
  const fire = useCallback((intent: Intent) => void send(intent), [send]);

  const react = useCallback((s: number, quip: string) => {
    setReactions((r) => ({ ...r, [s]: { say: quip, shock: true } }));
    setTimeout(() => setReactions((r) => (r[s]?.say === quip ? { ...r, [s]: { say: quip } } : r)), 900);
    setTimeout(
      () =>
        setReactions((r) => {
          if (r[s]?.say !== quip) return r;
          const n = { ...r };
          delete n[s];
          return n;
        }),
      2100,
    );
  }, []);

  const [zonePopFor, setZonePopFor] = useState<string | null>(null);

  // Sounds, toasts and reactions for things that just happened (yours and everyone else's).
  useEffect(
    () =>
      client.onEvents((events, v) => {
        const me = v.you.seat;
        const stuckOnMe = events.some((e) => e.type === 'noteStuck' && e.on === me);
        for (const e of events) {
          if (e.type === 'log') {
            SFX[e.sfx]();
            if (e.text && !(stuckOnMe && e.sfx === 'stick'))
              show(e.by === me ? e.text : `${nameOf(v, e.by)} ${e.text}`);
            if (e.zone) {
              setShuffling(e.zone);
              setTimeout(() => setShuffling(null), 420);
            }
          } else if (e.type === 'notice') {
            SFX[e.sfx]();
            show(e.text, e.sfx === 'err');
          } else if (e.type === 'noteStuck') {
            react(e.on, e.quip);
            SFX.huh();
            if (e.on === me) show(`${nameOf(v, e.by)} STUCK A NOTE ON YOU`);
          } else if (e.type === 'zoneCreated' && e.by === me) {
            setZonePopFor(e.id);
          }
        }
      }),
    [client, show, react],
  );

  // Open the settings of a zone you just placed, once it's on screen.
  useEffect(() => {
    if (!zonePopFor) return;
    const el = document.querySelector(`[data-zone="${zonePopFor}"] .zcog`);
    if (el) setPop({ mode: 'zone', id: zonePopFor, anchor: anchorOf(el) });
    setZonePopFor(null);
  }, [zonePopFor, view]);

  // Cards that just arrived somewhere get a little pop animation.
  const prevLoc = useRef<{ loc: Map<string, string>; counts: Map<string, number> } | null>(null);
  useEffect(() => {
    const loc = new Map<string, string>();
    const counts = new Map(view.zones.map((z) => [z.id, z.count]));
    view.hand?.forEach((c) => loc.set(c.vid, 'hand'));
    view.loose.forEach((c) => loc.set(c.vid, 'loose'));
    view.notes.forEach((n) => loc.set(n.id, n.at.kind === 'seat' ? `s${n.at.seat}` : 'table'));
    const prev = prevLoc.current;
    // In a pile, only the cards that were just added count as arrivals. Taking the top card
    // reveals the one below (it gets a new id, and a buried card scrolls into the few we're
    // sent), and that must not make the pile pop.
    view.zones.forEach((z) => {
      const added = prev ? Math.max(0, z.count - (prev.counts.get(z.id) ?? 0)) : 0;
      const firstNew = z.layout === 'stack' ? z.cards.length - added : 0;
      z.cards.forEach((c, i) => loc.set(c.vid, i >= firstNew ? z.id : `${z.id}:old`));
    });
    prevLoc.current = { loc, counts };
    if (!prev) return;
    const changed = new Set(
      [...loc].filter(([k, v]) => !v.endsWith(':old') && prev.loc.get(k) !== v).map(([k]) => k),
    );
    if (!changed.size || changed.size > 60) return;
    setFresh(changed);
    const t = setTimeout(() => setFresh(new Set()), 320);
    return () => clearTimeout(t);
  }, [view]);

  // Forget selections of things that are gone.
  useEffect(() => {
    const ok = (k: string) => {
      const id = k.slice(2);
      if (k[0] === 'c') return view.loose.some((c) => c.vid === id);
      if (k[0] === 'z') return view.zones.some((z) => z.id === id);
      return view.notes.some((n) => n.id === id && n.at.kind === 'table');
    };
    setTsel((s) => ([...s].every(ok) ? s : new Set([...s].filter(ok))));
    setSel((s) => {
      const hand = new Set(view.hand?.map((c) => c.vid));
      return [...s].every((v) => hand.has(v)) ? s : new Set([...s].filter((v) => hand.has(v)));
    });
    if (pop?.mode === 'zone' && !view.zones.some((z) => z.id === pop.id)) setPop(null);
    if (pop?.mode === 'note' && !view.notes.some((n) => n.id === pop.id)) setPop(null);
  }, [view, pop]);

  /* ---------- coordinates ---------- */

  const viewPoint = (cx: number, cy: number) => {
    const r = sceneRef.current!.getBoundingClientRect();
    return unproj(live.current.L, cx - r.left, cy - r.top);
  };
  const tablePoint = (cx: number, cy: number) => {
    const v = viewPoint(cx, cy);
    const t = live.current.m.toTable(v.x, v.y);
    return { x: Math.round(t.x), y: Math.round(t.y) };
  };

  /** What's under the pointer that you could drop onto: 'hand', 'seat:N', 'zone:ID', 'table' or null. */
  const dropTargetAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    if (el?.closest('.pop,.score')) return null;
    // Anywhere along the bottom strip counts as your hand, even over your notes, at the very edge,
    // or past the bottom of the window: a quick flick downwards shouldn't miss.
    const scene = sceneRef.current!.getBoundingClientRect();
    if (live.current.view.hand && y >= scene.bottom - live.current.L.handH) return 'hand';
    if (!el || el.closest('.bar,.pad,.menotes,.selbar,.hint')) return null;
    const d = el.closest<HTMLElement>('[data-drop]');
    if (d) return d.dataset.drop ?? null;
    return el.closest('.plane') ? 'table' : null;
  };

  /* ---------- gestures ---------- */

  const closePop = useCallback(() => setPop(null), []);
  const toggleSel = (k: string) => {
    setTsel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
    tick();
  };

  const itemPos = (k: string): XY | undefined => {
    const v = live.current.view;
    const id = k.slice(2);
    if (k[0] === 'c') return v.loose.find((c) => c.vid === id);
    if (k[0] === 'z') return v.zones.find((z) => z.id === id);
    const n = v.notes.find((q) => q.id === id);
    return n?.at.kind === 'table' ? n.at : undefined;
  };

  const startGroup = (e: { clientX: number; clientY: number }) => {
    const orig = new Map<string, XY>();
    live.current.tsel.forEach((k) => {
      const o = itemPos(k);
      if (o) orig.set(k, { x: o.x, y: o.y });
    });
    drag.current = {
      kind: 'group',
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      p0: tablePoint(e.clientX, e.clientY),
      orig,
      hot: null,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    ensureAudio();
    if (e.button > 0) return;
    const t = e.target as HTMLElement;
    const { view: v, canPlay: play, tsel: ts } = live.current;
    if (live.current.placing) {
      if (t.closest('.plane')) {
        e.preventDefault();
        fire({ type: 'createZone', ...tablePoint(e.clientX, e.clientY) });
        setPlacing(false);
      }
      return;
    }
    if (!play || t.closest('.zcog,.ztidy,.score,.selbar,.hint,button.plate')) return;
    const at = { x0: e.clientX, y0: e.clientY };
    if (t.closest('[data-grip]')) {
      e.preventDefault();
      frozen.current = live.current.L;
      drag.current = { kind: 'resize', ...at, moved: false };
      closePop();
      return;
    }
    const nt = t.closest<HTMLElement>('[data-note]');
    if (nt) {
      e.preventDefault();
      const n = v.notes.find((o) => o.id === nt.dataset.note);
      if (!n) return;
      const k = `n:${n.id}`;
      if (n.at.kind === 'table') {
        if (e.shiftKey) return toggleSel(k);
        if (ts.has(k) && ts.size > 1) return startGroup(e);
        if (!ts.has(k) && ts.size) setTsel(new Set());
      }
      drag.current = {
        kind: 'note',
        nid: n.id,
        ...at,
        started: false,
        text: n.text,
        color: n.color,
        hot: null,
        x: e.clientX,
        y: e.clientY,
      };
      return;
    }
    if (t.closest('.pad')) {
      e.preventDefault();
      const p = live.current.pad;
      drag.current = {
        kind: 'note',
        nid: 'pad',
        ...at,
        started: false,
        text: p?.text ?? '',
        color: p?.color ?? 'yel',
        hot: null,
        x: e.clientX,
        y: e.clientY,
      };
      return;
    }
    // Zones move by their grip or by their empty outline.
    const zoneEl = t.closest<HTMLElement>('[data-zgrip]') ?? (t.matches('.zone') ? t : null);
    if (zoneEl) {
      e.preventDefault();
      const id = zoneEl.dataset.zgrip ?? zoneEl.dataset.zone!;
      const k = `z:${id}`;
      if (e.shiftKey) return toggleSel(k);
      if (ts.has(k) && ts.size > 1) return startGroup(e);
      if (!ts.has(k) && ts.size) setTsel(new Set());
      const z = v.zones.find((q) => q.id === id)!;
      const p = tablePoint(e.clientX, e.clientY);
      drag.current = { kind: 'zone', id, ...at, moved: false, dx: z.x - p.x, dy: z.y - p.y };
      return;
    }
    const c = t.closest<HTMLElement>('[data-card]');
    if (c) {
      e.preventDefault();
      const from = c.dataset.from!;
      const vid = c.dataset.card!;
      if (from === 'loose') {
        const k = `c:${vid}`;
        if (e.shiftKey) return toggleSel(k);
        if (ts.has(k) && ts.size > 1) return startGroup(e);
      }
      if (ts.size) setTsel(new Set());
      const z = from.startsWith('zone:') ? v.zones.find((q) => q.id === from.slice(5)) : undefined;
      const onTop = z?.layout === 'stack' && z.cards.at(-1)?.vid === vid && z.count > 1;
      const cd: Drag = {
        kind: 'card',
        from,
        vid,
        ...at,
        started: false,
        vids: [],
        cards: [],
        up: true,
        hot: null,
        x: e.clientX,
        y: e.clientY,
        count: 1,
        pile: onTop ? z.count : null,
      };
      drag.current = cd;
      if (onTop) startHold(cd);
      return;
    }
    if (t.closest('.plane')) {
      e.preventDefault();
      drag.current = {
        kind: 'marquee',
        ...at,
        moved: false,
        base: e.shiftKey ? new Set(ts) : new Set(),
        rect: null,
      };
    }
  };

  /** While the pointer rests on a pile's top card, count up one card every HOLD_STEP_MS. */
  const holdTimer = useRef<number | undefined>(undefined);
  const stopHold = () => {
    window.clearInterval(holdTimer.current);
    holdTimer.current = undefined;
  };
  const startHold = (cd: Extract<Drag, { kind: 'card' }>) => {
    stopHold();
    holdTimer.current = window.setInterval(() => {
      if (drag.current !== cd || cd.started || cd.count >= (cd.pile ?? 1)) return stopHold();
      cd.count++;
      SFX.flip();
      rerender();
    }, HOLD_STEP_MS);
  };

  /** Cards a drag picks up: the whole selection if you grab a selected hand card, else just that card. */
  const beginCardDrag = (d: Extract<Drag, { kind: 'card' }>) => {
    const v = live.current.view;
    let cards: CardView[];
    if (d.from === 'hand') {
      const hand = v.hand ?? [];
      cards = live.current.sel.has(d.vid)
        ? hand.filter((c) => live.current.sel.has(c.vid))
        : hand.filter((c) => c.vid === d.vid);
    } else if (d.from === 'loose') cards = v.loose.filter((c) => c.vid === d.vid);
    else {
      const z = v.zones.find((q) => q.id === d.from.slice(5));
      // A counted grab carries the top `count` cards. Only the top few are known here; the
      // server picks the rest. The ghost shows the known ones plus the count.
      cards =
        d.count > 1
          ? (z?.cards.slice(-d.count).reverse() ?? [])
          : (z?.cards.filter((c) => c.vid === d.vid) ?? []);
    }
    if (!cards.length) return false;
    d.cards = cards;
    d.vids = cards.map((c) => c.vid);
    d.up = d.from === 'hand' || cards[0]!.face !== null;
    d.started = true;
    SFX.pick();
    return true;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const { m: mm, L: LL, view: v } = live.current;
      const far = (n: number) => Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= n;

      if (d.kind === 'resize') {
        d.moved = true;
        const p = viewPoint(e.clientX, e.clientY);
        const nVW = 2 * (p.x - mm.VW / 2);
        const nVH = 2 * (mm.VH / 2 - p.y);
        const [tw, th] = mm.edge === 'L' || mm.edge === 'R' ? [nVH, nVW] : [nVW, nVH];
        const { cfg } = resizedConfig(live.current.view.cfg, tw, th);
        setPreview((p) => (p && p.tw === cfg.tw && p.th === cfg.th ? p : { tw: cfg.tw, th: cfg.th }));
        return;
      }
      if (d.kind === 'group') {
        if (!d.moved) {
          if (!far(5)) return;
          d.moved = true;
          closePop();
          SFX.pick();
        }
        const p = tablePoint(e.clientX, e.clientY);
        const dx = p.x - d.p0.x;
        const dy = p.y - d.p0.y;
        for (const [k, o] of d.orig) {
          const pad = k[0] === 'z' ? 80 : 50;
          overrides.current.set(k, {
            x: clamp(o.x + dx, pad, mm.W - pad),
            y: clamp(o.y + dy, pad, mm.H - pad),
          });
        }
        const key = dropTargetAt(e.clientX, e.clientY);
        d.hot = key && key !== 'table' ? key : null;
        rerender();
        return;
      }
      if (d.kind === 'marquee') {
        if (!d.moved && !far(6)) return;
        d.moved = true;
        const r = sceneRef.current!.getBoundingClientRect();
        const x1 = Math.min(d.x0, e.clientX) - r.left;
        const x2 = Math.max(d.x0, e.clientX) - r.left;
        const y1 = Math.min(d.y0, e.clientY) - r.top;
        const y2 = Math.max(d.y0, e.clientY) - r.top;
        d.rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        const inBox = (tx: number, ty: number) => {
          const vp = mm.toView(tx, ty);
          const s = proj(LL, vp.x, vp.y);
          return s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2;
        };
        const next = new Set(d.base);
        v.loose.forEach((c) => inBox(c.x, c.y) && next.add(`c:${c.vid}`));
        v.zones.forEach((z) => inBox(z.x, z.y) && next.add(`z:${z.id}`));
        v.notes.forEach((n) => n.at.kind === 'table' && inBox(n.at.x, n.at.y) && next.add(`n:${n.id}`));
        setTsel(next);
        return;
      }
      if (d.kind === 'zone') {
        if (!d.moved) {
          if (!far(5)) return;
          d.moved = true;
          closePop();
        }
        const p = tablePoint(e.clientX, e.clientY);
        overrides.current.set(`z:${d.id}`, { x: p.x + d.dx, y: p.y + d.dy });
        rerender();
        return;
      }
      if (!d.started) {
        if (!far(6)) return;
        if (d.kind === 'note') {
          if (d.nid === 'pad' && !live.current.pad) return;
          d.started = true;
          SFX.pick();
        } else {
          stopHold();
          if (!beginCardDrag(d)) {
            drag.current = null;
            return;
          }
        }
      }
      d.x = e.clientX;
      d.y = e.clientY;
      d.hot = dropTargetAt(e.clientX, e.clientY);
      rerender();
    };

    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      const { view: v, tsel: ts } = live.current;

      if (d.kind === 'resize') {
        frozen.current = null;
        const final = live.current.preview;
        if (d.moved && final) {
          // One intent for the whole gesture. Keep showing the preview until the server confirms.
          void send({ type: 'resizeTable', tw: final.tw, th: final.th }).then(() => setPreview(null));
          const r = sceneRef.current!.getBoundingClientRect();
          setScene({ w: r.width, h: r.height });
        } else setPreview(null);
        rerender();
        return;
      }

      if (d.kind === 'group') {
        if (!d.moved) {
          // A click (no drag) on a selected loose card flips it.
          const c = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
          if (c?.dataset.from === 'loose')
            fire({ type: 'flipCards', from: { kind: 'loose' }, vids: [c.dataset.card!] });
          return;
        }
        const keys = [...d.orig.keys()];
        const cardVids = keys.filter((k) => k[0] === 'c').map((k) => k.slice(2));
        if (d.hot && cardVids.length) {
          // Dropped on a zone, hand or player: the cards go there; zones and notes snap back.
          keys.forEach((k) => overrides.current.delete(k));
          const target = targetFor(d.hot, e.clientX, e.clientY);
          if (target)
            void send(
              { type: 'moveCards', from: { kind: 'loose' }, vids: cardVids, to: target },
              { hide: cardVids },
            );
          setTsel(new Set());
        } else {
          const items = keys.map((k) => ({
            kind: k[0] === 'z' ? ('zone' as const) : k[0] === 'c' ? ('loose' as const) : ('note' as const),
            id: k.slice(2),
            ...overrides.current.get(k)!,
          }));
          void send({ type: 'moveItems', items }, { keep: keys });
        }
        rerender();
        return;
      }

      if (d.kind === 'marquee') {
        if (!d.moved && ts.size) setTsel(new Set());
        else if (d.moved && ts.size) tick();
        rerender();
        return;
      }

      if (d.kind === 'zone') {
        if (!d.moved) return;
        const k = `z:${d.id}`;
        const o = overrides.current.get(k);
        if (o)
          void send(
            {
              type: 'moveItems',
              items: [{ kind: 'zone', id: d.id, x: Math.round(o.x), y: Math.round(o.y) }],
            },
            { keep: [k] },
          );
        return;
      }

      if (d.kind === 'note') {
        rerender();
        if (!d.started) return clickNote(d.nid, e.target as HTMLElement);
        const key = dropTargetAt(e.clientX, e.clientY);
        if (!key) return;
        const [kind, arg] = key.split(':');
        let at: NoteSpot;
        if (kind === 'seat') {
          const s = Number(arg);
          const sp = document.querySelector(`.seat[data-drop="seat:${s}"] .sprite`);
          let fx = 0.3 + Math.random() * 0.4;
          let fy = 0.5 + Math.random() * 0.12;
          const r = sp?.getBoundingClientRect();
          if (
            r &&
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          ) {
            fx = (e.clientX - r.left) / r.width;
            fy = (e.clientY - r.top) / r.height;
          }
          at = { kind: 'seat', seat: s, x: fx, y: fy };
        } else if (kind === 'table' || kind === 'zone') {
          at = { kind: 'table', ...tablePoint(e.clientX, e.clientY) };
        } else {
          if (kind === 'hand') show('STICK IT ON A FRIEND OR THE TABLE');
          return;
        }
        if (d.nid === 'pad') {
          const p = live.current.pad;
          if (!p) return;
          setPad(null);
          void send({ type: 'stickNote', text: p.text, color: p.color, at }).then((err) => err && setPad(p));
        } else fire({ type: 'moveNote', id: d.nid, at });
        return;
      }

      // card
      stopHold();
      if (!d.started) {
        rerender();
        // Let go of a counted grab without moving: nothing happens (a click would flip the card).
        if (d.count > 1) return;
        if (d.from === 'hand') {
          setSel((s) => {
            const n = new Set(s);
            if (n.has(d.vid)) n.delete(d.vid);
            else n.add(d.vid);
            return n;
          });
          tick();
        } else fire({ type: 'flipCards', from: sourceOf(d.from), vids: [d.vid] });
        return;
      }
      const key = dropTargetAt(e.clientX, e.clientY);
      rerender();
      if (!key || (key === d.from && key !== 'hand' && !key.startsWith('zone:'))) return;
      const [kind, arg] = key.split(':');
      if (kind === 'zone' && d.from === key && v.zones.find((z) => z.id === arg)?.layout !== 'stack') return;
      if (d.count > 1 && key === d.from) return;
      if (kind === 'hand' && d.from === 'hand') {
        // Reorder: count the cards (not being moved) whose centre is left of the drop point.
        const hand = v.hand ?? [];
        const index = handCenters.current.filter(
          (c, i) => !d.vids.includes(hand[i]!.vid) && c < e.clientX,
        ).length;
        setSel(new Set());
        void send(
          { type: 'moveCards', from: { kind: 'hand' }, vids: d.vids, to: { kind: 'hand', index } },
          { hide: d.vids },
        );
        return;
      }
      const target = targetFor(key, e.clientX, e.clientY);
      if (!target) return;
      if (d.count > 1) {
        void send(
          { type: 'drawCards', id: d.from.slice(5), count: d.count, to: target, up: d.up },
          { hide: d.vids },
        );
        return;
      }
      setSel((s) => new Set([...s].filter((x) => !d.vids.includes(x))));
      void send(
        { type: 'moveCards', from: sourceOf(d.from), vids: d.vids, to: target, up: d.up },
        { hide: d.vids },
      );
    };

    const targetFor = (key: string, cx: number, cy: number): Target | null => {
      const [kind, arg] = key.split(':');
      if (kind === 'hand') return { kind: 'hand' };
      if (kind === 'seat') return { kind: 'seat', seat: Number(arg) };
      if (kind === 'zone') return { kind: 'zone', id: arg!, ...tablePoint(cx, cy) };
      if (kind === 'table') return { kind: 'table', ...tablePoint(cx, cy) };
      return null;
    };

    const cancel = () => {
      stopHold();
      if (drag.current?.kind === 'resize') {
        frozen.current = null;
        setPreview(null);
      }
      drag.current = null;
      overrides.current.clear();
      rerender();
    };

    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea')) return;
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (live.current.canPlay) fire({ type: 'undo' });
        return;
      }
      const d = drag.current;
      if (d?.kind === 'card' && d.started && (e.key === 'f' || e.key === 'F')) {
        d.up = !d.up;
        SFX.flip();
        rerender();
        return;
      }
      if (e.key === 'Escape') {
        setPlacing(false);
        setSel(new Set());
        setTsel(new Set());
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
    // The handlers read everything through refs, so they are registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clickNote(nid: string, el: HTMLElement) {
    if (nid === 'pad') return openCompose();
    const n = live.current.view.notes.find((o) => o.id === nid);
    if (!n) return;
    if (n.at.kind === 'seat' && n.at.seat === live.current.view.you.seat) {
      fire({ type: 'ripNote', id: nid });
      return;
    }
    setPop({ mode: 'note', id: nid, anchor: anchorOf(el.closest('[data-note]') ?? el) });
  }

  function openCompose() {
    ensureAudio();
    const el = document.querySelector('.pad');
    if (el) setPop({ mode: 'compose', anchor: anchorOf(el) });
  }

  /* ---------- toolbar actions ---------- */

  const selAction = (a: 'pile' | 'flip' | 'clear') => {
    const vids = [...tsel].filter((k) => k[0] === 'c').map((k) => k.slice(2));
    if (a === 'clear') return setTsel(new Set());
    if (a === 'flip') fire({ type: 'flipCards', from: { kind: 'loose' }, vids });
    if (a === 'pile') {
      fire({ type: 'pileUp', vids });
      setTsel(new Set());
    }
  };

  const invite = async () => {
    const url = `${location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      show('INVITE LINK COPIED');
    } catch {
      show(`INVITE: ${url}`);
    }
    SFX.join();
  };

  /* ---------- render ---------- */

  const d = drag.current;
  const lifted = new Set(pending);
  if (d?.kind === 'card' && d.started) d.vids.forEach((v) => lifted.add(v));
  const hot =
    d && (d.kind === 'card' || d.kind === 'note') && d.started ? d.hot : d?.kind === 'group' ? d.hot : null;
  const myNotes = seat === null ? [] : view.notes.filter((n) => n.at.kind === 'seat' && n.at.seat === seat);
  const selCards = [...tsel].filter((k) => k[0] === 'c').length;
  const popZone = pop?.mode === 'zone' ? view.zones.find((z) => z.id === pop.id) : undefined;
  const popNote = pop?.mode === 'note' ? view.notes.find((n) => n.id === pop.id) : undefined;

  return (
    <div className="app">
      <Toolbar
        view={view}
        code={code}
        canPlay={canPlay}
        dealN={dealN}
        setDealN={setDealN}
        placing={placing}
        open={{
          table: pop?.mode === 'table',
          score: showScore,
          help: showHint,
          feedback: pop?.mode === 'feedback',
        }}
        sound={sound}
        onTable={(el) => setPop(pop?.mode === 'table' ? null : { mode: 'table', anchor: anchorOf(el) })}
        onZone={() => {
          setPlacing(!placing);
          if (!placing) {
            closePop();
            show('CLICK THE TABLE TO PLACE A ZONE');
          }
        }}
        onDeal={() => fire({ type: 'deal', count: dealN })}
        onShuffle={() => fire({ type: 'shuffleZone' })}
        onCollect={() => fire({ type: 'collect' })}
        onUndo={() => fire({ type: 'undo' })}
        onScore={() => setShowScore(!showScore)}
        onHelp={() => {
          setShowHint(!showHint);
          savePref('hint', showHint ? 'off' : 'on');
        }}
        onSound={() => {
          setSound(!sound);
          setSoundState(!sound);
          ensureAudio();
          tick();
        }}
        onInvite={invite}
        onFeedback={(el) =>
          setPop(pop?.mode === 'feedback' ? null : { mode: 'feedback', anchor: anchorOf(el) })
        }
      />
      <main ref={sceneRef} className={`scene${placing ? ' placing' : ''}`} onPointerDown={onPointerDown}>
        {scene.w > 0 && (
          <>
            <SeatsLayer
              L={L}
              m={m}
              notes={shown.notes}
              reactions={reactions}
              hot={hot}
              canSit={!canPlay}
              onSit={(s) => client.sit(s)}
              fresh={fresh}
            />
            <Plane
              L={L}
              m={m}
              zones={shown.zones}
              loose={shown.loose}
              notes={shown.notes}
              tsel={tsel}
              overrides={overrides.current}
              lifted={lifted}
              moving={d?.kind === 'group' && d.moved}
              fresh={fresh}
              hot={hot}
              shuffling={shuffling}
              openZone={pop?.mode === 'zone' ? pop.id : null}
              canPlay={canPlay}
              onCog={(id, el) =>
                setPop(
                  pop?.mode === 'zone' && pop.id === id ? null : { mode: 'zone', id, anchor: anchorOf(el) },
                )
              }
              onTidy={(id) => fire({ type: 'tidyZone', id })}
            />
            <HandDock
              L={L}
              hand={view.hand}
              sel={sel}
              lifted={lifted}
              fresh={fresh}
              hot={hot === 'hand'}
              centersRef={handCenters}
            />
          </>
        )}
        {showHint && (
          <div className="hint">
            <button
              aria-label="Hide tips"
              onClick={() => {
                setShowHint(false);
                savePref('hint', 'off');
              }}
            >
              X
            </button>
            <em>DRAG</em> cards anywhere. <em>CLICK</em> a table card to flip it. Press <em>F</em> while
            dragging to flip. <em>DRAG ON EMPTY FELT</em> to box-select; <em>SHIFT+CLICK</em> adds. The{' '}
            <em>COG</em> on a zone opens its settings. Drop cards on a friend to give them. Write a
            <em> STICKY NOTE</em> and slap it on someone. <em>ROOM</em> copies the invite link.
            <span className="hint-fb">
              Found a bug or have an idea? Tap <em>FEEDBACK</em>. I'd appreciate hearing what to improve and
              what you enjoy!
            </span>
          </div>
        )}
        {canPlay && (
          <NotePad pad={pad} compColor={compColor} mine={myNotes} fresh={fresh} onOpen={openCompose} />
        )}
        <div className="me">
          {view.you.name} {view.hand ? <b>{view.hand.length}</b> : <b>WATCHING</b>}
        </div>
        {tsel.size > 0 && <SelBar count={tsel.size} cards={selCards} onAction={selAction} />}
        {d?.kind === 'marquee' && d.rect && (
          <div className="mq" style={{ left: d.rect.x, top: d.rect.y, width: d.rect.w, height: d.rect.h }} />
        )}
        <Toast toast={toast} />
        {showScore && (
          <ScorePad
            seats={view.seats}
            canPlay={canPlay}
            onScore={(s, delta) => fire({ type: 'score', seat: s, delta })}
            onClose={() => setShowScore(false)}
          />
        )}
      </main>

      {pop && (
        <Popover anchor={pop.anchor} onClose={closePop} label={pop.mode}>
          {pop.mode === 'zone' && popZone && (
            <ZoneMenu key={popZone.id} z={popZone} send={fire} onClose={closePop} />
          )}
          {pop.mode === 'table' && (
            <TableMenu
              view={view}
              send={fire}
              onClose={closePop}
              onStand={() => {
                client.stand();
                closePop();
              }}
            />
          )}
          {pop.mode === 'compose' && (
            <ComposeMenu
              initial={pad?.text ?? ''}
              color={compColor}
              onColor={(c) => {
                setCompColor(c);
                tick();
              }}
              onReady={(text) => {
                const tx = text.trim();
                if (!tx) {
                  show('WRITE SOMETHING FIRST', true);
                  return SFX.err();
                }
                setPad({ text: tx, color: compColor });
                closePop();
                tick();
                show('NOW DRAG IT FROM THE PAD ONTO SOMEONE');
              }}
              onClose={closePop}
            />
          )}
          {pop.mode === 'note' && popNote && (
            <NoteMenu key={popNote.id} note={popNote} send={fire} onClose={closePop} />
          )}
          {pop.mode === 'feedback' && (
            <FeedbackMenu
              room={code}
              onDone={(msg, err) => {
                show(msg, err);
                if (!err) closePop();
              }}
            />
          )}
        </Popover>
      )}

      <Ghost d={d} hs={L.hs} />
    </div>
  );
}

/** What you're carrying, drawn at the pointer. */
function Ghost({ d, hs }: { d: Drag | null; hs: number }) {
  // Holding still on a pile: show the count growing under your pointer before you drag.
  if (d?.kind === 'card' && !d.started && d.count > 1) {
    return (
      <div className="ghost" style={{ transform: `translate(${d.x0}px,${d.y0}px)` }}>
        <span className="gcount">{d.count}</span>
      </div>
    );
  }
  if (!d || !(d.kind === 'card' || d.kind === 'note') || !d.started) return null;
  const style = { transform: `translate(${d.x}px,${d.y}px)` };
  if (d.kind === 'note') {
    return (
      <div className="ghost" style={style}>
        <div className={`note gn n-${d.color}`}>
          <span>{d.text}</span>
        </div>
      </div>
    );
  }
  const cw = 25 * hs;
  const ch = 35 * hs;
  return (
    <div className="ghost" style={style}>
      {d.count > 1 && <span className="gcount">{d.count}</span>}
      {d.cards.map((c, i) => {
        // Flipped face up with F but you don't know what it is yet: a question mark until it lands.
        const cls = d.up ? (c.face ? cardClass(c.face, c.back) : 'c-q') : `c-b${c.back}`;
        return (
          <div
            key={c.vid}
            className={`gc ${cls}`}
            style={{
              width: cw,
              height: ch,
              left: i * cw * 0.3 - cw / 2,
              top: -ch / 2 + i * 3,
              transform: `rotate(${-5 + i * 3}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}
