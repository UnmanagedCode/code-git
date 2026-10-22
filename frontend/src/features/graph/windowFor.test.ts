import { expect, test } from 'vitest';
import { OVERSCAN, ROW_H, windowFor } from './windowFor';

test('the window covers the viewport plus overscan, clamped to the rows that exist', () => {
  expect(windowFor(0, 800, 5000)).toEqual({ start: 0, end: Math.ceil(800 / ROW_H) + OVERSCAN });
  expect(windowFor(100 * ROW_H, 10 * ROW_H, 5000)).toEqual({ start: 100 - OVERSCAN, end: 110 + OVERSCAN });
  expect(windowFor(4990 * ROW_H, 800, 5000)).toEqual({ start: 4990 - OVERSCAN, end: 5000 });
  expect(windowFor(0, 800, 3)).toEqual({ start: 0, end: 3 });
  expect(windowFor(1e9, 800, 10)).toEqual({ start: 10, end: 10 });
  expect(windowFor(NaN, NaN, 10)).toEqual({ start: 0, end: 10 });
  expect(windowFor(-50, 0, 0)).toEqual({ start: 0, end: 0 });
  const { start, end } = windowFor(2500 * ROW_H, 1200, 5000);
  expect(end - start).toBeLessThanOrEqual(120);
});
