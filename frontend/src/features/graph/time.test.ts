import { expect, test } from 'vitest';
import { dateMs, formatTime } from './time';

test('formatTime shows — for a timestamp no Date can hold, and a date otherwise', () => {
  for (const t of [Number('99999999999999999999'), -1e20, 8.64e12 + 1, NaN, Infinity, -Infinity]) expect(formatTime(t), String(t)).toBe('—');
  expect(formatTime(1_700_000_000)).toMatch(/2023/);
  expect(formatTime(8.64e12)).not.toBe('—');
  expect(formatTime(0)).toMatch(/19(69|70)/);
});

// Invariant: dateMs is the one validity rule for a git timestamp: milliseconds when a Date can hold it, null otherwise.
test('dateMs is null for an unrepresentable or non-numeric timestamp and milliseconds otherwise', () => {
  for (const t of [Number('99999999999999999999'), -1e20, 8.64e12 + 1, NaN, Infinity, -Infinity, undefined as unknown as number, '5' as unknown as number]) expect(dateMs(t), String(t)).toBeNull();
  expect(dateMs(1_700_000_000)).toBe(1_700_000_000_000);
  expect(dateMs(8.64e12)).toBe(8.64e15);
  expect(dateMs(0)).toBe(0);
});
