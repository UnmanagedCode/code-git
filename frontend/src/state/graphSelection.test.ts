import { expect, test } from 'vitest';
import type { GraphRow } from '@/features/graph/types';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { checkout, commit, oid, stash } from '@/test/graphData';
import {
  dispatchSelection, fileIntentStore, getSelection, NO_SELECTION, requestFileOpen, selectedRows, selectionReducer, type GraphSelection,
} from './graphSelection';

const TAB = { project: 'app', worktree: null };
const ids = ['wip:', oid(1), `stash:${oid(9)}`, oid(2), oid(3), oid(4)];
const rows: GraphRow[] = [
  { kind: 'wip', id: 'wip:', checkout: checkout(null) },
  { kind: 'commit', id: oid(1), item: commit(oid(1)) },
  { kind: 'stash', id: `stash:${oid(9)}`, stash: stash(oid(9), oid(2)) },
  ...[2, 3, 4].map((n): GraphRow => ({ kind: 'commit', id: oid(n), item: commit(oid(n)) })),
];
const run = (actions: Parameters<typeof selectionReducer>[1][], from: GraphSelection = NO_SELECTION) => actions.reduce(selectionReducer, from);

test('click selects one row and sets anchor and focus; clicking the only selected row again deselects it', () => {
  const one = run([{ type: 'click', id: ids[3], rows }]);
  expect(one).toMatchObject({ ids: [ids[3]], anchor: ids[3], focus: ids[3] });
  expect(run([{ type: 'click', id: ids[4], rows }], one).ids).toEqual([ids[4]]);
  expect(run([{ type: 'click', id: ids[3], rows }], one)).toEqual({ ids: [], anchor: null, focus: ids[3], items: [] });
});

test('Ctrl-toggle adds and removes (WIP included); ids stay in row order', () => {
  const s = run([{ type: 'click', id: ids[4], rows }, { type: 'toggle', id: ids[0], rows }, { type: 'toggle', id: ids[1], rows }]);
  expect(s.ids).toEqual([ids[0], ids[1], ids[4]]);
  expect(run([{ type: 'toggle', id: ids[1], rows }], s).ids).toEqual([ids[0], ids[4]]);
});

test('Shift-range selects anchor…row in row order, either direction; without an anchor it acts as a click', () => {
  const down = run([{ type: 'click', id: ids[1], rows }, { type: 'range', id: ids[4], rows }]);
  expect(down).toMatchObject({ ids: ids.slice(1, 5), anchor: ids[1], focus: ids[4] });
  const up = run([{ type: 'click', id: ids[4], rows }, { type: 'range', id: ids[0], rows }]);
  expect(up.ids).toEqual(ids.slice(0, 5));
  expect(run([{ type: 'range', id: ids[2], rows }]).ids).toEqual([ids[2]]);
});

test('move selects only its target; clear keeps the focus; prune drops rows gone after a reload', () => {
  const many = run([{ type: 'click', id: ids[1], rows }, { type: 'range', id: ids[4], rows }]);
  expect(run([{ type: 'move', id: ids[5], rows }], many).ids).toEqual([ids[5]]);
  expect(run([{ type: 'clear' }], many)).toEqual({ ...NO_SELECTION, focus: ids[4] });
  const after = rows.filter((r) => r.id !== ids[1] && r.id !== ids[4]);
  const pruned = run([{ type: 'prune', rows: after }], many);
  expect(pruned).toMatchObject({ ids: [ids[2], ids[3]], anchor: null, focus: null });
  expect(run([{ type: 'prune', rows }], many)).toBe(many);
});

test('selectedRows resolves the selection top to bottom: WIP by checkout, a stash and commits by oid', () => {
  dispatchSelection(TAB, { type: 'click', id: ids[3], rows });
  dispatchSelection(TAB, { type: 'toggle', id: ids[2], rows });
  dispatchSelection(TAB, { type: 'toggle', id: ids[0], rows });
  expect(selectedRows(TAB)).toEqual([
    { kind: 'wip', checkout: { project: 'app', worktree: null } }, { kind: 'stash', oid: oid(9) }, { kind: 'commit', oid: oid(2) },
  ]);
  expect(getSelection({ project: 'app', worktree: 'other' })).toBe(NO_SELECTION);
});

test('requestFileOpen publishes the documented intent with an increasing seq and the current selection', () => {
  // The intent also opens the diff (features/graph/diffWiring.ts), which lists its files.
  stubGraph(linearWorld(2));
  dispatchSelection(TAB, { type: 'click', id: ids[1], rows });
  requestFileOpen({ tab: TAB, commit: oid(1), parent: oid(2), path: 'src/a.ts', oldPath: null });
  const first = fileIntentStore.get()!;
  expect(first).toEqual({ seq: first.seq, tab: TAB, commit: oid(1), parent: oid(2), path: 'src/a.ts', oldPath: null, selection: [{ kind: 'commit', oid: oid(1) }] });
  requestFileOpen({ tab: TAB, commit: oid(1), parent: null, path: 'new.ts', oldPath: 'old.ts' });
  expect(fileIntentStore.get()!.seq).toBe(first.seq + 1);
});
