import { waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { BranchDropCtx, CommitCtx, CommitsCtx, RefCtx } from '@/features/graph/contexts';
import { toDragRef } from '@/features/graph/drag';
import type { CommitItem, Ref, RefsResult } from '@/features/graph/types';
import { labelOf, resolveActions, type MenuAction } from '@/shell/menus';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { sequenceDialogStore } from '@/state/sequenceDialog';
import { tabKey } from '@/state/tabs';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { commit, oid, ref, refsResult, worktree } from '@/test/graphData';
import { SEQUENCE_ACTIONS } from './actions';

const T = { project: 'app', worktree: null };
// History: 1 ← 2 ← 3 ← 4 (HEAD, main); 1 ← 5 (free); a merge 6 of 4 and 5.
const C = (n: number, parents: number[]) => commit(oid(n), parents.map(oid));
const COMMITS: CommitItem[] = [C(6, [4, 5]), C(4, [3]), C(3, [2]), C(5, [1]), C(2, [1]), C(1, [])];
const HEAD = oid(4);
const MAIN = ref('refs/heads/main', HEAD, { isHead: true });
const FREE = ref('refs/heads/free', oid(5));
const BUSY = ref('refs/heads/busy', oid(2));
const ORIGIN_FREE = ref('refs/remotes/origin/free', oid(5));

function setGraph(head: Partial<RefsResult['head']> = {}) {
  const refs = refsResult({
    head: { oid: HEAD, branch: MAIN.name, detached: false, unborn: false, ...head },
    refs: [MAIN, FREE, BUSY, ORIGIN_FREE], worktrees: [worktree('/p/app', HEAD, MAIN.name), worktree('/p/wt', oid(2), BUSY.name)],
  });
  graphStore.set(new Map([[tabKey(T), { ...EMPTY_GRAPH, status: 'ready', refs, commits: COMMITS }]]));
}
const items = <C>(context: string, ctx: C) => resolveActions(SEQUENCE_ACTIONS as unknown as MenuAction<C>[], context, ctx);
const menu = <C>(context: string, ctx: C) => items(context, ctx).map((a) => `${a.order} ${labelOf(a, ctx)}`);
const run = <C>(context: string, ctx: C, label: string) => {
  const a = items(context, ctx).find((x) => labelOf(x, ctx) === label);
  if (!a) throw new Error(`no ${label} in ${menu(context, ctx).join(' | ')}`);
  void a.run!(ctx);
};
const drop = (source: Ref, target: Ref): BranchDropCtx => ({ tab: T, source: toDragRef(source)!, target: toDragRef(target)! });
const branch = (r: Ref): RefCtx => ({ tab: T, ref: r });
const commitCtx = (n: number): CommitCtx => ({ tab: T, commit: COMMITS.find((c) => c.oid === oid(n))!, refs: [], selection: [oid(n)] });
const commits = (...ns: number[]): CommitsCtx => ({ tab: T, rows: ns.map((n) => ({ kind: 'commit' as const, id: oid(n), item: COMMITS.find((c) => c.oid === oid(n))! })) });
const ok = (result: unknown) => ({ ok: true, result });

test('drop onto HEAD\'s branch: Merge, Merge (no fast-forward), Squash at 100–102 and Rebase HEAD onto the source at 110', () => {
  setGraph();
  expect(menu('branch-drop', drop(FREE, MAIN))).toEqual([
    '100 Merge free into main', '101 Merge free into main (no fast-forward)', '102 Squash free into main', '110 Rebase main onto free',
  ]);
  expect(menu('branch-drop', drop(ORIGIN_FREE, MAIN))).toEqual([
    '100 Merge origin/free into main', '101 Merge origin/free into main (no fast-forward)', '102 Squash origin/free into main', '110 Rebase main onto origin/free',
  ]);
});

test('drop of HEAD\'s branch onto another: only Rebase HEAD onto the target; neither side HEAD\'s, or the same commit: nothing', () => {
  setGraph();
  expect(menu('branch-drop', drop(MAIN, FREE))).toEqual(['110 Rebase main onto free']);
  expect(menu('branch-drop', drop(FREE, BUSY))).toEqual([]);
  expect(menu('branch-drop', drop({ ...FREE, oid: HEAD }, MAIN))).toEqual([]);
});

test('the drop items post merge.start with the source ref, its oid, the mode and HEAD; rebase.start onto the other side', async () => {
  setGraph();
  const f = stubGraph(linearWorld(2), {
    'POST api/ops/merge.start': ok({ outcome: 'merged', files: [], oid: oid(7), message: null, undo: {} }),
    'POST api/ops/rebase.start': ok({ outcome: 'done', files: [], oid: oid(7), undo: {} }),
    'POST api/ops/commit.state': ok({ merging: false }),
  });
  run('branch-drop', drop(FREE, MAIN), 'Merge free into main (no fast-forward)');
  run('branch-drop', drop(MAIN, ORIGIN_FREE), 'Rebase main onto origin/free');
  await waitFor(() => expect(paramsOf(f, 'POST api/ops/merge.start')).toEqual([{ ref: FREE.name, oid: FREE.oid, mode: 'noFf', expect: HEAD }]));
  await waitFor(() => expect(paramsOf(f, 'POST api/ops/rebase.start')).toEqual([{ onto: ORIGIN_FREE.oid, upstream: ORIGIN_FREE.oid, expect: HEAD }]));
});

test('branch menu: Merge <b> into <HEAD> (330) and Rebase <HEAD> onto <b> (331), for another branch at another commit with HEAD born', () => {
  setGraph();
  expect(menu('branch', branch(FREE))).toEqual(['330 Merge free into main', '331 Rebase main onto free']);
  expect(menu('branch', branch(ORIGIN_FREE))).toEqual(['330 Merge origin/free into main', '331 Rebase main onto origin/free']);
  expect(menu('branch', branch(MAIN))).toEqual([]);
  expect(menu('branch', branch({ ...FREE, oid: HEAD }))).toEqual([]);
  setGraph({ oid: null, unborn: true });
  expect(menu('branch', branch(FREE))).toEqual([]);
  setGraph({ branch: null, detached: true });
  expect(menu('branch', branch(FREE))).toEqual(['330 Merge free into HEAD', '331 Rebase HEAD onto free']);
});

test('commit menu: Rebase <HEAD> onto this commit (312) only for a commit outside HEAD\'s loaded history', () => {
  setGraph();
  expect(menu('commit', commitCtx(5))).toEqual(['312 Rebase main onto this commit']);
  expect(menu('commit', commitCtx(6))).toEqual(['312 Rebase main onto this commit']);
  for (const n of [4, 3, 1]) expect(menu('commit', commitCtx(n))).toEqual([]);
});

test('commits menu: Rebase N commits onto… (322) for a first-parent run ending at HEAD; it opens the dialog with the oldest\'s parent as upstream', () => {
  setGraph();
  expect(menu('commits', commits(4, 3, 2))).toEqual(['322 Rebase 3 commits onto…']);
  run('commits', commits(4, 3), 'Rebase 2 commits onto…');
  expect(sequenceDialogStore.get()).toMatchObject({ kind: 'rebaseOnto', count: 2, upstream: oid(2), expect: HEAD });
  // Not ending at HEAD, not contiguous, a root commit (no parent), a merge: no item.
  for (const ns of [[3, 2], [4, 2], [2, 1], [6, 4]]) expect(menu('commits', commits(...ns))).toEqual([]);
});
