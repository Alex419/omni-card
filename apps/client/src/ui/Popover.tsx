import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface Anchor {
  left: number;
  top: number;
  bottom: number;
}

/**
 * A floating panel placed under its anchor (or above it when there's no room below),
 * clamped to the window. Clicking anywhere outside it closes it.
 */
export function Popover({
  anchor,
  onClose,
  children,
  label,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let top = anchor.bottom + 12;
    if (top + ph > innerHeight - 12) top = Math.max(12, anchor.top - ph - 12);
    el.style.left = `${Math.max(16, Math.min(anchor.left, innerWidth - pw - 16))}px`;
    el.style.top = `${top}px`;
  });
  useLayoutEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[data-keeps-pop]')) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="pop panel" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

export const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom };
};
