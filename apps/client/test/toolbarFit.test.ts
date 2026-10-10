import { describe, expect, it } from 'vitest';
import { fitToolbar } from '../src/ui/toolbarFit';

const items = [
  { id: 'table', width: 60, priority: 90 },
  { id: 'deal', width: 100, priority: 100 },
  { id: 'shuffle', width: 70, priority: 50 },
  { id: 'help', width: 50, priority: 10 },
];
// All four in a row: 280 + 3 gaps of 8 = 304.

describe('fitToolbar', () => {
  it('shows everything when it fits, with no MORE button needed', () => {
    expect(fitToolbar(items, 304, 60, 8)).toEqual(new Set(['table', 'deal', 'shuffle', 'help']));
  });

  it('drops the least important first and reserves room for MORE', () => {
    // 303 is one pixel short. Reserve MORE (60 + 8): 235 left for deal 100 + table 68 = 168, + shuffle 78 = 246 > 235.
    expect(fitToolbar(items, 303, 60, 8)).toEqual(new Set(['deal', 'table']));
  });

  it('never shows a lower-priority item while a higher one is hidden', () => {
    // After deal + table, shuffle (78) doesn't fit but help (58) would; it must still overflow.
    expect(fitToolbar(items, 240, 0, 8).has('help')).toBe(false);
  });

  it('can hide everything when there is no room', () => {
    expect(fitToolbar(items, 50, 60, 8).size).toBe(0);
  });
});
