import { expect, test } from 'vitest';
import { DIFF3_MAX_LINES, matchLines, merge3, splitLines } from './diff3';

const L = (...xs: string[]) => xs.map((x) => `${x}\n`).join('');

test('splitLines keeps each line\'s newline, a \\r inside its text, and a last line without one', () => {
  expect(splitLines('a\r\nb\nc')).toEqual(['a\r\n', 'b\n', 'c']);
  expect(splitLines('')).toEqual([]);
});

test('matchLines finds a longest common subsequence, in order', () => {
  const a = splitLines(L('a', 'b', 'c', 'a', 'b', 'b', 'a'));
  const b = splitLines(L('c', 'b', 'a', 'b', 'a', 'c'));
  const m = matchLines(a, b)!;
  expect(m.length).toBe(4);
  expect(m.every(([i, j]) => a[i] === b[j])).toBe(true);
  expect(m.every(([i, j], k) => k === 0 || (i > m[k - 1][0] && j > m[k - 1][1]))).toBe(true);
});

test('changes on one side merge cleanly; the same change on both sides too', () => {
  const base = L('a', 'b', 'c', 'd');
  expect(merge3(base, L('a', 'B', 'c', 'd'), L('a', 'b', 'c', 'D'))).toEqual([{ kind: 'stable', lines: splitLines(L('a', 'B', 'c', 'D')) }]);
  expect(merge3(base, L('a', 'X', 'c', 'd'), L('a', 'X', 'c', 'd'))).toEqual([{ kind: 'stable', lines: splitLines(L('a', 'X', 'c', 'd')) }]);
  expect(merge3(base, L('a', 'b', 'new', 'c', 'd'), L('a', 'b', 'c', 'd'))).toEqual([{ kind: 'stable', lines: splitLines(L('a', 'b', 'new', 'c', 'd')) }]);
});

test('overlapping changes conflict, with each side\'s line range', () => {
  const r = merge3(L('a', 'b', 'c', 'd', 'e'), L('a', 'ours1', 'ours2', 'd', 'e'), L('a', 'theirs', 'd', 'E'));
  expect(r).toEqual([
    { kind: 'stable', lines: ['a\n'] },
    { kind: 'conflict', base: ['b\n', 'c\n'], ours: ['ours1\n', 'ours2\n'], theirs: ['theirs\n'], oursRange: { start: 1, end: 3 }, theirsRange: { start: 1, end: 2 } },
    { kind: 'stable', lines: ['d\n', 'E\n'] },
  ]);
});

test('two separate conflicts stay two regions', () => {
  const r = merge3(L('1', '2', '3', '4', '5'), L('1', 'x', '3', '4', 'y'), L('1', 'X', '3', '4', 'Y'))!;
  expect(r.filter((x) => x.kind === 'conflict')).toHaveLength(2);
});

test('both added (empty base): one conflict of the whole files, or stable when equal', () => {
  expect(merge3('', L('ours'), L('theirs'))).toEqual([
    { kind: 'conflict', base: [], ours: ['ours\n'], theirs: ['theirs\n'], oursRange: { start: 0, end: 1 }, theirsRange: { start: 0, end: 1 } },
  ]);
  expect(merge3('', L('same'), L('same'))).toEqual([{ kind: 'stable', lines: ['same\n'] }]);
});

test('CRLF lines compare with their \\r; a final newline removed on one side is a change of the last line', () => {
  expect(merge3('a\r\nb\r\n', 'a\r\nB\r\n', 'a\r\nb\r\n')).toEqual([{ kind: 'stable', lines: ['a\r\n', 'B\r\n'] }]);
  expect(merge3(L('a', 'b'), 'a\nb', L('a', 'b'))).toEqual([{ kind: 'stable', lines: ['a\n', 'b'] }]);
  const r = merge3(L('a', 'b'), 'a\nb', L('a', 'B'))!;
  expect(r[1]).toMatchObject({ kind: 'conflict', ours: ['b'], theirs: ['B\n'] });
});

test('past the line cap the merge gives up (null: take a side)', () => {
  const big = 'x\n'.repeat(DIFF3_MAX_LINES + 1);
  expect(merge3(big, big, 'y\n')).toBeNull();
});

test('matchLines matches as many lines as a brute-force LCS on random small inputs (a seeded generator)', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  const lcs = (a: string[], b: string[]) => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    return dp[0][0];
  };
  for (let t = 0; t < 300; t++) {
    const a = Array.from({ length: rnd(12) }, () => `${'abc'[rnd(3)]}\n`);
    const b = Array.from({ length: rnd(12) }, () => `${'abc'[rnd(3)]}\n`);
    const m = matchLines(a, b)!;
    expect(m.length, `${a.join('')}|${b.join('')}`).toBe(lcs(a, b));
    expect(m.every(([i, j], k) => a[i] === b[j] && (k === 0 || (i > m[k - 1][0] && j > m[k - 1][1])))).toBe(true);
  }
});
