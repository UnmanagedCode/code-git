import { expect, test } from 'vitest';
import { getItem } from '@/lib/storage';
import { fitPanes, PANE, paneMax, paneWidthsStore, parsePaneWidths, setPaneWidth } from './paneWidths';

const DEFAULTS = { left: PANE.left.default, right: PANE.right.default };
const SPACE = PANE.centerMin + 2 * PANE.handle;

test('parsePaneWidths: each side on its own, a corrupt value never yields an out-of-bounds pane', () => {
  expect(parsePaneWidths(null)).toEqual(DEFAULTS);
  expect(parsePaneWidths('{nope')).toEqual(DEFAULTS);
  expect(parsePaneWidths('[1,2]')).toEqual(DEFAULTS);
  expect(parsePaneWidths(JSON.stringify({ left: 'wide', right: 400 }))).toEqual({ left: PANE.left.default, right: 400 });
  expect(parsePaneWidths(JSON.stringify({ left: 1, right: 99999 }))).toEqual({ left: PANE.left.min, right: PANE.right.max });
  expect(parsePaneWidths(JSON.stringify({ left: 200.6, right: null }))).toEqual({ left: 201, right: PANE.right.default });
});

test('setPaneWidth stores a rounded, clamped width under the prefixed storage key', () => {
  setPaneWidth('left', 300.4);
  setPaneWidth('right', 5);
  expect(paneWidthsStore.get()).toEqual({ left: 300, right: PANE.right.min });
  expect(parsePaneWidths(getItem('shell:paneWidths'))).toEqual({ left: 300, right: PANE.right.min });
});

test('fitPanes: choices that fit are unchanged; an overflow comes from the left first, then the right; an unmeasured window changes nothing', () => {
  const big = { left: PANE.left.max, right: PANE.right.max };
  expect(fitPanes(big, 3000)).toEqual(big);
  expect(fitPanes(big, 0)).toEqual(big);
  // 100 px short of the choices: all of it from the left.
  const room = big.left + big.right + SPACE;
  expect(fitPanes(big, room - 100)).toEqual({ left: big.left - 100, right: big.right });
  // More than the left can give: it sits at its floor and the right gives the rest.
  const over = big.left - PANE.left.min + 50;
  expect(fitPanes(big, room - over)).toEqual({ left: PANE.left.min, right: big.right - 50 });
  // Nothing fits: both at their floors.
  expect(fitPanes(big, 100)).toEqual({ left: PANE.left.min, right: PANE.right.min });
});

test('where the panes show (≥ 1024), any choice renders with the centre at its minimum and each pane at or above its floor', () => {
  for (let available = 1024; available <= 2560; available += 8) {
    for (let l = PANE.left.min; l <= PANE.left.max; l += 24) {
      for (let r = PANE.right.min; r <= PANE.right.max; r += 32) {
        const f = fitPanes({ left: l, right: r }, available);
        expect(f.left + f.right + SPACE).toBeLessThanOrEqual(available);
        expect(f.left).toBeGreaterThanOrEqual(PANE.left.min);
        expect(f.right).toBeGreaterThanOrEqual(PANE.right.min);
      }
    }
  }
});

test('paneMax: bounded by the pane\'s own ceiling and the room the other pane leaves, never below its floor', () => {
  expect(paneMax('left', 0, 999)).toBe(PANE.left.max);
  expect(paneMax('left', 3000, PANE.right.default)).toBe(PANE.left.max);
  expect(paneMax('left', 1100, 492)).toBe(1100 - SPACE - 492);
  expect(paneMax('right', 1100, PANE.left.min)).toBe(1100 - SPACE - PANE.left.min);
  expect(paneMax('left', 1024, 640)).toBe(PANE.left.min);
});

test('the right pane\'s floor is the Changes pane\'s design width (its commit box and section header assume it)', () => {
  expect(PANE.right.min).toBeGreaterThanOrEqual(320);
});
