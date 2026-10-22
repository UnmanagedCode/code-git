import { expect, test } from 'vitest';
import { clip, DISPLAY_MAX } from './clip';

test('clip keeps short text, cuts long text to DISPLAY_MAX with an ellipsis, and never splits a surrogate pair', () => {
  expect(clip('short')).toBe('short');
  expect(clip('x'.repeat(DISPLAY_MAX))).toBe('x'.repeat(DISPLAY_MAX));
  expect(clip('x'.repeat(1_000_000))).toBe(`${'x'.repeat(DISPLAY_MAX)}…`);
  expect(clip(`${'a'.repeat(4)}😀`, 5)).toBe('aaaa…');
  expect(clip('abcdef', 3)).toBe('abc…');
});
