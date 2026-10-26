import { expect, test } from 'vitest';
import { ageMarkers } from './ages';
import type { GraphRow } from './types';
import { commit, oid, stash, checkout } from '@/test/graphData';

// Local-time constructors keep the calendar rung timezone-independent (dates sit away from DST changes).
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const S = (ms: number) => Math.floor(ms / 1000);
const H = 3600;
const D = 86400;
const YEAR = 365 * D;

const row = (id: number, committerTime: unknown): GraphRow => ({ kind: 'commit', id: oid(id), item: commit(oid(id), [], { committerTime: committerTime as number }) });
/** Rows oid(0), oid(1), … with the given committer times (the first row sits at index 0). */
const rowsOf = (times: unknown[]): GraphRow[] => times.map((t, i) => row(i, t));
const labels = (rows: GraphRow[], now: number) => [...ageMarkers(rows, now)].map(([id, l]) => [Number(id), l]);

const NOW = at(2026, 5, 15, 10, 0);
const NOW_S = S(NOW);
const ago = (s: number) => NOW_S - s;

// Invariant: walking down a monotonic list each rung of the ladder labels the first row that crossed it, once, in rank order.
test('the whole ladder, each label once in rank order', () => {
  const rows = rowsOf([ago(60), ago(1.5 * H), ago(5 * H), ago(10 * H + 20 * H), ago(8 * D), ago(40 * D), ago(100 * D), ago(400 * D), ago(800 * D), ago(1200 * D)]);
  // Row 3 is 30h old: before today's midnight (10:00 now), so yesterday.
  expect(labels(rows, NOW)).toEqual([
    [1, '1 hour ago'], [2, '3 hours ago'], [3, 'yesterday'], [4, 'last week'], [5, 'last month'], [6, '3 months ago'], [7, '1 year ago'], [8, '2 years ago'], [9, '3 years ago'],
  ]);
});

// Invariant: a rung once crossed stays crossed (a newer commit after it gets nothing); a later older commit still crosses the next rung.
test('non-monotonic times: a newer commit below a crossing is unmarked, a later older one still fires', () => {
  const rows = rowsOf([ago(60), ago(40 * D), ago(2 * D), ago(100 * D)]);
  expect(labels(rows, NOW)).toEqual([[1, 'last month'], [3, '3 months ago']]);
});

// Invariant: several rungs crossed in one gap collapse into one marker bearing the oldest rung's label.
test('one gap crossing several rungs yields a single marker with the oldest label', () => {
  expect(labels(rowsOf([ago(60), ago(8 * D)]), NOW)).toEqual([[1, 'last week']]);
});

// Invariant: `yesterday` is the calendar rung (before local midnight), and the highest rung wins, so the hour rungs never appear below it.
test('yesterday follows local midnight and suppresses the hour rungs below it', () => {
  const justAfterMidnight = at(2026, 5, 15, 0, 30);
  expect(labels(rowsOf([S(justAfterMidnight) - 60, S(at(2026, 5, 14, 23, 45)), S(at(2026, 5, 14, 23, 0))]), justAfterMidnight)).toEqual([[1, 'yesterday']]);
  const two = at(2026, 5, 15, 2, 0);
  expect(labels(rowsOf([S(two) - 60, S(at(2026, 5, 15, 0, 30)), S(at(2026, 5, 14, 23, 0))]), two)).toEqual([[1, '1 hour ago'], [2, 'yesterday']]);
  const ten = at(2026, 5, 15, 10, 0);
  expect(labels(rowsOf([S(ten) - 60, S(at(2026, 5, 15, 9, 30)), S(at(2026, 5, 15, 8, 30)), S(at(2026, 5, 15, 6, 0)), S(at(2026, 5, 14, 23, 59))]), ten))
    .toEqual([[2, '1 hour ago'], [3, '3 hours ago'], [4, 'yesterday']]);
});

// Invariant: every rung is crossed at exactly its cutoff (age >= d), not a second before; years are one rung per 365 days.
test('rung boundaries are inclusive and years step by 365 days', () => {
  const first = (age: number) => labels(rowsOf([ago(0), ago(age)]), NOW)[0]?.[1];
  expect(first(H - 1)).toBeUndefined();
  expect(first(H)).toBe('1 hour ago');
  expect(first(3 * H - 1)).toBe('1 hour ago');
  expect(first(3 * H)).toBe('3 hours ago');
  expect(first(7 * D - 1)).toBe('yesterday');
  expect(first(7 * D)).toBe('last week');
  expect(first(30 * D - 1)).toBe('last week');
  expect(first(30 * D)).toBe('last month');
  expect(first(90 * D)).toBe('3 months ago');
  expect(first(YEAR - 1)).toBe('3 months ago');
  expect(first(YEAR)).toBe('1 year ago');
  expect(first(2 * YEAR - 1)).toBe('1 year ago');
  expect(first(2 * YEAR)).toBe('2 years ago');
  expect(first(3 * YEAR + 1)).toBe('3 years ago');
  const long = rowsOf([ago(0), ...Array.from({ length: 6 }, (_, k) => ago((k + 1) * YEAR + D))]);
  expect([...ageMarkers(long, NOW).values()].slice(-6)).toEqual(['1 year ago', '2 years ago', '3 years ago', '4 years ago', '5 years ago', '6 years ago']);
});

// Invariant: an unrepresentable committer time or "now" never yields a marker or throws and leaves the crossed state alone; the future crosses nothing.
test('invalid times are skipped, a future time crosses nothing, an invalid now gives no markers', () => {
  for (const bad of [NaN, Infinity, -Infinity, 1e20, -1e20, 8.64e12 + 1, undefined]) {
    expect(labels(rowsOf([ago(0), bad, ago(2 * D)]), NOW), String(bad)).toEqual([[2, 'yesterday']]);
  }
  expect(labels(rowsOf([ago(0), NOW_S + 5 * D, ago(2 * D)]), NOW)).toEqual([[2, 'yesterday']]);
  for (const now of [NaN, 0, -5, Infinity]) expect(ageMarkers(rowsOf([ago(0), ago(9 * D)]), now).size, String(now)).toBe(0);
});

// Invariant: WIP and stash rows never carry a marker nor count as crossing; a commit directly below a stash gets its own marker.
test('WIP and stash rows are never marked and their times are ignored', () => {
  const wip: GraphRow = { kind: 'wip', id: 'wip:', checkout: checkout(null) };
  const old: GraphRow = { kind: 'stash', id: `stash:${oid(99)}`, stash: { ...stash(oid(99), oid(0)), time: ago(5 * YEAR) } };
  const rows = [wip, row(0, ago(60)), old, row(1, ago(9 * D))];
  expect([...ageMarkers(rows, NOW)]).toEqual([[oid(1), 'last week']]);
});

// Invariant: the first row has no gap above it, so a crossing there is consumed without a marker; below WIP rows the first commit is marked.
test('no marker at row index 0, but it consumes its level', () => {
  expect(labels(rowsOf([ago(9 * D), ago(10 * D), ago(40 * D)]), NOW)).toEqual([[2, 'last month']]);
  const wip: GraphRow = { kind: 'wip', id: 'wip:', checkout: checkout(null) };
  expect([...ageMarkers([wip, row(0, ago(9 * D))], NOW)]).toEqual([[oid(0), 'last week']]);
});

// Invariant: a row's marker depends only on rows above it, so appending a page never moves or adds markers to loaded rows.
test('markers of a prefix equal those of the full list restricted to the prefix', () => {
  const times = [ago(60), ago(2 * H), ago(5 * H), ago(2 * D), ago(40 * D), ago(10 * D), ago(100 * D), ago(2 * YEAR), ago(3 * YEAR)];
  const rows = rowsOf(times);
  const full = ageMarkers(rows, NOW);
  for (const cut of [1, 2, 4, 5, 8]) {
    const prefix = rows.slice(0, cut);
    const ids = new Set(prefix.map((r) => r.id));
    expect([...ageMarkers(prefix, NOW)]).toEqual([...full].filter(([id]) => ids.has(id)));
  }
});
