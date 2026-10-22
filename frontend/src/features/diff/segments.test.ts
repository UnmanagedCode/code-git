import { expect, test } from 'vitest';
import { mergeSegments } from './segments';

test('overlapping syntax, emphasis and match ranges become non-overlapping segments keeping every flag', () => {
  const syntax = [{ text: 'const', cls: 'k' }, { text: ' x = ', cls: null }, { text: '"abc"', cls: 's' }];
  const out = mergeSegments(syntax, [{ start: 3, end: 8 }], [{ start: 6, end: 12 }], { start: 6, end: 12 });
  expect(out.map((s) => s.text).join('')).toBe('const x = "abc"');
  expect(out.map((s) => [s.text, s.cls, s.em, s.match, s.current])).toEqual([
    ['con', 'k', false, false, false], ['st', 'k', true, false, false], [' ', null, true, false, false],
    ['x ', null, true, true, true], ['= ', null, false, true, true], ['"a', 's', false, true, true], ['bc"', 's', false, false, false],
  ]);
});

test('no overlays leave the syntax segments as they are; an empty line has no segments', () => {
  const syntax = [{ text: 'ab', cls: 'k' }, { text: 'cd', cls: null }];
  expect(mergeSegments(syntax, [], []).map((s) => [s.text, s.cls, s.em || s.match || s.current])).toEqual([['ab', 'k', false], ['cd', null, false]]);
  expect(mergeSegments([{ text: '', cls: null }], [], [])).toEqual([]);
});
