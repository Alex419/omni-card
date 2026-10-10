/**
 * Which toolbar items fit, the "priority+" pattern: keep the most important items visible and
 * move the rest into a MORE menu. Pure, so it's easy to test.
 *
 * Items are kept strictly by priority (highest first) until one doesn't fit; everything after it
 * overflows too. That keeps the order predictable: a less important button never shows while a
 * more important one is hidden.
 */
export interface FitItem {
  id: string;
  width: number;
  /** Higher stays visible longer. */
  priority: number;
}

export function fitToolbar(items: FitItem[], available: number, moreWidth: number, gap: number): Set<string> {
  const total = items.reduce((s, it) => s + it.width, 0) + gap * Math.max(0, items.length - 1);
  if (total <= available) return new Set(items.map((it) => it.id));
  // Something overflows, so the MORE button needs room too.
  let room = available - moreWidth - gap;
  const visible = new Set<string>();
  for (const it of [...items].sort((a, b) => b.priority - a.priority)) {
    const need = it.width + (visible.size ? gap : 0);
    if (need > room) break;
    room -= need;
    visible.add(it.id);
  }
  return visible;
}
