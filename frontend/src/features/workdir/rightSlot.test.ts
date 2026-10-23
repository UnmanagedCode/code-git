import { expect, test } from 'vitest';
import type { DiffSource } from '@/features/diff/api';
import type { DiffTabState } from '@/state/diff';
import type { SelectedRow } from '@/state/graphSelection';
import { oid } from '@/test/graphData';
import { diffOwnerCommit } from '@/features/diff/binding';
import { rightSlotFor } from './rightSlot';

const A = oid(1);
const B = oid(2);
const W = oid(10);
const I = oid(11);
const U = oid(12);
const STASHES = [{ oid: W, parents: [A, I, U], selector: 'stash@{0}', time: 1, subject: 'WIP' }];

const diff = (source: DiffSource, resolved?: string): DiffTabState => ({
  source,
  list: { loading: false, error: null, whitespace: 'none', result: resolved ? { files: [], pair: { old: { type: 'index' }, new: { type: 'worktree' } }, commit: { oid: resolved, parents: [] }, mergeBase: null, series: null } : null },
  selected: [], viewed: null, forced: [], files: new Map(), notice: null, generation: 1,
});
const commitRow = (o: string): SelectedRow => ({ kind: 'commit', oid: o });
const stashRow = (o: string): SelectedRow => ({ kind: 'stash', oid: o });
const WIP: SelectedRow = { kind: 'wip', checkout: { project: 'app', worktree: null } };

test('no open diff: Changes for nothing or a single WIP row, else the details', () => {
  expect(rightSlotFor([], null, [])).toBe('changes');
  expect(rightSlotFor([WIP], null, [])).toBe('changes');
  expect(rightSlotFor([commitRow(A)], null, [])).toBe('details');
  expect(rightSlotFor([stashRow(W)], null, STASHES)).toBe('details');
  expect(rightSlotFor([commitRow(A), WIP], null, [])).toBe('details');
});

test('an unstaged or staged diff shows Changes, even with a commit selected', () => {
  for (const kind of ['unstaged', 'staged'] as const) {
    expect(rightSlotFor([commitRow(A)], diff({ kind }), [])).toBe('changes');
    expect(rightSlotFor([], diff({ kind }), [])).toBe('changes');
  }
});

test('a commit diff of the selected commit binds the details; of any other commit it shows the Changed files panel', () => {
  expect(rightSlotFor([commitRow(A)], diff({ kind: 'commit', rev: A }), [])).toBe('details');
  expect(rightSlotFor([commitRow(A)], diff({ kind: 'commit', rev: A, parent: 2 }, A), [])).toBe('details');
  // The resolved commit decides once the list loaded (a rev given by name).
  expect(rightSlotFor([commitRow(A)], diff({ kind: 'commit', rev: 'HEAD' }, A), [])).toBe('details');
  expect(rightSlotFor([commitRow(B)], diff({ kind: 'commit', rev: A }), [])).toBe('diff-files');
  expect(rightSlotFor([], diff({ kind: 'commit', rev: A }), [])).toBe('diff-files');
  expect(rightSlotFor([WIP], diff({ kind: 'commit', rev: A }), [])).toBe('diff-files');
  expect(rightSlotFor([commitRow(A), commitRow(B)], diff({ kind: 'commit', rev: A }), [])).toBe('diff-files');
});

test("a stash's All / Staged / Untracked diff binds the selected stash's details", () => {
  expect(rightSlotFor([stashRow(W)], diff({ kind: 'commit', rev: W, parent: 1 }, W), STASHES)).toBe('details');
  expect(rightSlotFor([stashRow(W)], diff({ kind: 'commit', rev: I }, I), STASHES)).toBe('details');
  expect(rightSlotFor([stashRow(W)], diff({ kind: 'commit', rev: U }, U), STASHES)).toBe('details');
  // Without the stash list, I is just another commit.
  expect(rightSlotFor([stashRow(W)], diff({ kind: 'commit', rev: I }, I), [])).toBe('diff-files');
});

test('compare, worktree, commits and pair diffs show the Changed files panel', () => {
  for (const source of [
    { kind: 'compare', from: 'main', to: 'side', mode: '..' },
    { kind: 'worktree', rev: A },
    { kind: 'commits', oids: [A, B] },
    { kind: 'pair', old: { type: 'tree', oid: A }, new: { type: 'worktree' } },
  ] as DiffSource[]) {
    expect(rightSlotFor([commitRow(A)], diff(source), [])).toBe('diff-files');
    expect(rightSlotFor([], diff(source), [])).toBe('diff-files');
  }
});

test('diffOwnerCommit: the resolved commit, else the given rev, mapped to its stash; null for a non-commit source', () => {
  expect(diffOwnerCommit(diff({ kind: 'commit', rev: A }), [])).toBe(A);
  expect(diffOwnerCommit(diff({ kind: 'commit', rev: 'HEAD' }, B), [])).toBe(B);
  expect(diffOwnerCommit(diff({ kind: 'commit', rev: U }, U), STASHES)).toBe(W);
  expect(diffOwnerCommit(diff({ kind: 'unstaged' }), STASHES)).toBeNull();
  expect(diffOwnerCommit(diff({ kind: 'commits', oids: [A] }), [])).toBeNull();
});
