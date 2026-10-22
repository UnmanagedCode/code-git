import { expect, test } from 'vitest';
import { buildInputs } from './rows';
import { checkout, commit, oid, stash } from '@/test/graphData';

const A = oid(1);
const B = oid(2);
const C = oid(3);
const commits = [commit(A, [B]), commit(B, [C]), commit(C)];

test('WIP rows come first: the own checkout, then the others by name; each links to its HEAD with a dashed edge', () => {
  const wips = [checkout('zed', { headOid: C }), checkout(null, { headOid: A }), checkout('alpha', { headOid: B })];
  const { rows, inputs } = buildInputs(commits, wips, []);
  expect(rows.map((r) => r.id)).toEqual(['wip:', 'wip:alpha', 'wip:zed', A, B, C]);
  expect(inputs.slice(0, 3)).toEqual([
    { id: 'wip:', parents: [A], dashed: true }, { id: 'wip:alpha', parents: [B], dashed: true }, { id: 'wip:zed', parents: [C], dashed: true },
  ]);
  expect(inputs[3]).toEqual({ id: A, parents: [B], dashed: false });
});

test('a WIP whose HEAD is not loaded has no parent edge (no lane waits for a row that may never come)', () => {
  const { inputs } = buildInputs(commits, [checkout(null, { headOid: oid(99) }), checkout('x', { headOid: null })], []);
  expect(inputs[0].parents).toEqual([]);
  expect(inputs[1].parents).toEqual([]);
});

test('a stash sits directly above its base commit, newest first; a stash whose base is not loaded is left out', () => {
  const s0 = stash(oid(10), B, 0);
  const s1 = stash(oid(11), B, 1);
  const lost = stash(oid(12), oid(98), 2);
  const { rows, inputs } = buildInputs(commits, [], [s0, s1, lost]);
  expect(rows.map((r) => r.id)).toEqual([A, `stash:${oid(10)}`, `stash:${oid(11)}`, B, C]);
  expect(inputs[1]).toEqual({ id: `stash:${oid(10)}`, parents: [B], dashed: true });
  expect(rows[1]).toEqual({ kind: 'stash', id: `stash:${oid(10)}`, stash: s0 });
});
