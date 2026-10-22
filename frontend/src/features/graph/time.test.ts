import { expect, test } from 'vitest';
import { formatTime } from './time';

test('formatTime shows — for a timestamp no Date can hold, and a date otherwise', () => {
  for (const t of [Number('99999999999999999999'), -1e20, 8.64e12 + 1, NaN, Infinity, -Infinity]) expect(formatTime(t), String(t)).toBe('—');
  expect(formatTime(1_700_000_000)).toMatch(/2023/);
  expect(formatTime(8.64e12)).not.toBe('—');
  expect(formatTime(0)).toMatch(/19(69|70)/);
});
