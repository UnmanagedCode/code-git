import { expect, test } from 'vitest';
import { fdiff, hunk } from '@/test/diffFixtures';
import { changeBlocks, displayText, fileContent, sideText, splitRows, unifiedRows } from './model';

const H = [hunk(1, 1, [' a', '-b', '+B', ' c', '-d', '-e']), hunk(10, 9, ['+x', ' y'])];

test('changeBlocks: one block per run of del/add lines, with its hunk, first line index and members', () => {
  expect(changeBlocks(H)).toEqual([
    { hunk: 0, start: 1, dels: [1], adds: [2] },
    { hunk: 0, start: 4, dels: [4, 5], adds: [] },
    { hunk: 1, start: 0, dels: [], adds: [0] },
  ]);
});

test('unifiedRows: a header per hunk, every line, and the change index on each block first line only', () => {
  const rows = unifiedRows(H);
  expect(rows.map((r) => (r.type === 'hunk' ? 'H' : `${r.ref.line.kind[0]}${r.change ?? ''}`))).toEqual(['H', 'c', 'd0', 'a', 'c', 'd1', 'd', 'H', 'a2', 'c']);
  expect(unifiedRows(H, false).some((r) => r.type === 'hunk')).toBe(false);
});

test('unifiedRows: a paired del/add carries word emphasis on just the changed word', () => {
  const rows = unifiedRows([hunk(1, 1, ['-foo(bar)', '+foo(baz)'])]).filter((r) => r.type === 'line');
  expect(rows.map((r) => (r.type === 'line' ? r.ref.emphasis : null))).toEqual([[{ start: 4, end: 7 }], [{ start: 4, end: 7 }]]);
});

test('splitRows: the i-th del beside the i-th add, the longer side padded; context on both sides', () => {
  const rows = splitRows([hunk(1, 1, [' a', '-b', '-c', '-d', '+B', ' e'])]).filter((r) => r.type === 'pair');
  expect(rows.map((r) => (r.type === 'pair' ? [r.old?.line.text ?? null, r.new?.line.text ?? null, r.change] : null))).toEqual([
    ['a', 'a', null], ['b', 'B', 0], ['c', null, null], ['d', null, null], ['e', 'e', null],
  ]);
});

test('sideText: the old side is context + deleted lines, the new side context + added lines', () => {
  expect(sideText(H[0], 'old')).toBe('a\nb\nc\nd\ne');
  expect(sideText(H[0], 'new')).toBe('a\nB\nc');
});

test('fileContent rebuilds the new side exactly, honouring "no newline at end of file"; a deletion gives the old side', () => {
  const h = hunk(1, 1, [' a', '-b', '+B', ' c']);
  expect(fileContent(fdiff([h]))).toBe('a\nB\nc\n');
  const last = { ...h, lines: h.lines.map((l, i) => (i === 3 ? { ...l, noNewline: true } : l)) };
  expect(fileContent(fdiff([last]))).toBe('a\nB\nc');
  expect(fileContent(fdiff([hunk(1, 0, ['-x', '-y'])]))).toBe('x\ny\n');
});

test('displayText drops only a trailing carriage return', () => {
  expect(displayText({ text: 'a\r' })).toBe('a');
  expect(displayText({ text: 'a\rb' })).toBe('a\rb');
});
