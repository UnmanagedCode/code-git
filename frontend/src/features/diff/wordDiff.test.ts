import { expect, test } from 'vitest';
import { WORD_DIFF_MAX_CHARS, WORD_DIFF_MAX_TOKENS, wordDiff } from './wordDiff';

test('only the changed token is emphasised on each side', () => {
  expect(wordDiff('foo(bar)', 'foo(baz)')).toEqual({ a: [{ start: 4, end: 7 }], b: [{ start: 4, end: 7 }] });
  expect(wordDiff('let x = 1;', 'let x = 1; // two')).toEqual({ a: [], b: [{ start: 10, end: 17 }] });
});

test('identical lines have no emphasis', () => {
  expect(wordDiff('same line', 'same line')).toEqual({ a: [], b: [] });
});

test('past the character or token caps there is no word diff', () => {
  expect(wordDiff('a'.repeat(WORD_DIFF_MAX_CHARS + 1), 'b')).toBeNull();
  expect(wordDiff('b', 'a'.repeat(WORD_DIFF_MAX_CHARS + 1))).toBeNull();
  const many = Array.from({ length: Math.ceil((WORD_DIFF_MAX_TOKENS + 1) / 2) }, () => 'x').join(' ');
  expect(many.length).toBeLessThanOrEqual(WORD_DIFF_MAX_CHARS);
  expect(wordDiff(many, 'x')).toBeNull();
  expect(wordDiff('a'.repeat(WORD_DIFF_MAX_CHARS), 'b')).not.toBeNull();
});
