import { expect, test } from 'vitest';
import { fdiff, hunk } from '@/test/diffFixtures';
import { buildRows, type ViewRow } from './viewRows';

const FD = fdiff([hunk(1, 1, [' a', '-foo(bar)', '+foo(baz)', ' b']), hunk(10, 10, ['-x', '+y', '+z', ' w'])]);
const changes = (rows: ViewRow[]) => new Set(rows.flatMap((r) => ('change' in r && r.change !== null ? [r.change] : [])));

// Invariant: Hunk+Split puts each hunk's header row directly before that hunk's own pairs, and every row id is unique.
test('split with headers emits one hunk row before each hunk\'s pairs, with unique ids', () => {
  const rows = buildRows(FD, 'split', true, null);
  expect(rows.map((r) => (r.type === 'hunk' ? `h${r.hunk}` : r.type))).toEqual(['h0', 'split', 'split', 'split', 'h1', 'split', 'split', 'split']);
  const hunkOf = (r: ViewRow) => (r.type === 'split' ? (r.left ?? r.right)!.hunk : null);
  expect(rows.slice(1, 4).map(hunkOf)).toEqual([0, 0, 0]);
  expect(rows.slice(5).map(hunkOf)).toEqual([1, 1, 1]);
  expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
});

// Invariant: without headers (Full scope) neither layout emits a hunk row.
test('headers=false emits no hunk rows in either layout', () => {
  for (const layout of ['inline', 'split'] as const) expect(buildRows(FD, layout, false, null).some((r) => r.type === 'hunk')).toBe(false);
  expect(buildRows(FD, 'inline', true, null).filter((r) => r.type === 'hunk')).toHaveLength(2);
});

// Invariant: change navigation indexes (data-change-index) cover the same changes whichever layout shows the diff.
test('data-change-index values are the same set in both layouts for the same diff', () => {
  for (const headers of [true, false]) {
    const inline = changes(buildRows(FD, 'inline', headers, null));
    expect(inline).toEqual(new Set([0, 1]));
    expect(changes(buildRows(FD, 'split', headers, null))).toEqual(inline);
  }
});

// Invariant: word emphasis on a paired del/add is kept on both sides of a split row when hunk headers are shown.
test('emphasis survives headers in split', () => {
  const pair = buildRows(FD, 'split', true, null).find((r) => r.type === 'split' && r.left?.kind === 'del');
  expect(pair?.type === 'split' && pair.left!.emphasis.length > 0 && pair.right!.emphasis.length > 0).toBe(true);
});

// Invariant: File view renders the file's content only, whatever the scope asks for.
test('file ignores headers', () => {
  const withHeaders = buildRows(FD, 'file', true, null);
  expect(withHeaders.every((r) => r.type === 'file')).toBe(true);
  expect(withHeaders).toEqual(buildRows(FD, 'file', false, null));
});
