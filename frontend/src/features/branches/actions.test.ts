import { waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { BranchDropCtx, CommitCtx, RefCtx } from '@/features/graph/contexts';
import { toDragRef } from '@/features/graph/drag';
import type { Ref, RefsResult } from '@/features/graph/types';
import { actionsFor, labelOf, runPrimary, type ResolvedAction } from '@/shell/menus';
import { trackingStore } from '@/state/branchTracking';
import { NAMES_MAX } from './api';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { refDialogStore, type RefDialog } from '@/state/refDialog';
import { tabKey } from '@/state/tabs';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { commit, oid, ref, refsResult, worktree } from '@/test/graphData';

const T = { project: 'app', worktree: null };
const HEAD = oid(9);

const MAIN = ref('refs/heads/main', HEAD, { isHead: true });
const FREE = ref('refs/heads/free', oid(5));
const BUSY = ref('refs/heads/busy', oid(6));
const ORIGIN_FREE = ref('refs/remotes/origin/free', oid(7));
const TAG = ref('refs/tags/v1', oid(5));

/** The graph's refs for T: HEAD on `head`, `busy` checked out in worktree wt. */
function refsOn(head: Ref = MAIN, over: Partial<RefsResult> = {}): RefsResult {
  const refs = [MAIN, FREE, BUSY, ORIGIN_FREE, TAG, ref('refs/heads/code-conductor/wt', oid(8))].map((r) => ({ ...r, isHead: r.name === head.name }));
  return refsResult({
    head: { oid: head.oid, branch: head.name, detached: false, unborn: false },
    refs,
    worktrees: [worktree('/p/app', head.oid, head.name), worktree('/p/wt', oid(6), BUSY.name)],
    ...over,
  });
}
function setRefs(refs: RefsResult) {
  graphStore.set(new Map([[tabKey(T), { ...EMPTY_GRAPH, status: 'ready', refs }]]));
}

/** Every item of a menu as "label" or "submenu › child", in order. */
function labels<C>(list: ResolvedAction<C>[], ctx: C): string[] {
  return list.flatMap((a) => (a.children ? labels(a.children, ctx).map((l) => `${labelOf(a, ctx)} › ${l}`) : [labelOf(a, ctx)]));
}
const menu = (context: string, ctx: unknown) => labels(actionsFor(context, ctx), ctx);
function find<C>(context: string, ctx: C, path: string): ResolvedAction<C> {
  const [top, child] = path.split(' › ');
  const a = actionsFor(context, ctx).find((x) => labelOf(x, ctx) === top);
  const hit = child ? a?.children?.find((x) => labelOf(x, ctx) === child) : a;
  if (!hit) throw new Error(`no "${path}" in ${menu(context, ctx).join(' | ')}`);
  return hit;
}
const branch = (r: Ref): RefCtx => ({ tab: T, ref: r });
const commitCtx = (o: string, parents = [oid(1)]): CommitCtx => ({ tab: T, commit: commit(o, parents), refs: [], selection: [o] });
const drop = (source: Ref, target: Ref): BranchDropCtx => ({ tab: T, source: toDragRef(source)!, target: toDragRef(target)! });

/** Stubs the backend: the graph ops, plus `ops` answering every branch/tag/head op with an empty result. */
function backend() {
  const ok = { ok: true, result: { branch: 'refs/heads/x', created: false, localExisted: true, fastForwarded: false, ffBlocked: null, upToDate: false, conflicts: false, files: [], pushed: [], rejected: [], undo: {} } };
  const routes = Object.fromEntries(['branch.checkout', 'branch.fastForward', 'head.reset', 'head.revert', 'head.cherryPick', 'tag.push'].map((n) => [`POST api/ops/${n}`, ok]));
  return stubGraph(linearWorld(2), routes);
}
const sent = (f: ReturnType<typeof backend>, op: string) => f.calls.filter((c) => c.url.pathname.endsWith(`/ops/${op}`)).map((c) => (c.body as { params: unknown }).params);

test('branch menu: Checkout is hidden for HEAD and for another checkout\'s branch; Delete for any checked-out branch', () => {
  setRefs(refsOn());
  expect(menu('branch', branch({ ...MAIN, isHead: true }))).not.toContain('Checkout');
  expect(menu('branch', branch({ ...MAIN, isHead: true }))).not.toContain('Delete main…');
  expect(menu('branch', branch(BUSY))).not.toContain('Checkout');
  expect(menu('branch', branch(BUSY))).not.toContain('Delete busy…');
  expect(menu('branch', branch(BUSY))).not.toContain('Rename…');
  const free = menu('branch', branch(FREE));
  // The remotes card's Push to <remote>… (250s) sits between upstream (220) and reset (300).
  expect(free.slice(0, 7)).toEqual(['Checkout', 'Create branch here…', 'Create tag here…', 'Rename…', 'Set upstream…', 'Push to origin…', 'Reset main to here › Soft (keep index and files)']);
  expect(free).toContain('Delete free…');
  expect(menu('branch', branch(ORIGIN_FREE))).toEqual(expect.arrayContaining(['Checkout', 'Delete free from origin…']));
});

test('a checked-out code-conductor/* branch has no Rename and no Delete; a free one has both', () => {
  const cc = ref('refs/heads/code-conductor/wt', oid(8));
  setRefs(refsOn(cc));
  expect(menu('branch', branch({ ...cc, isHead: true }))).not.toEqual(expect.arrayContaining(['Rename…']));
  expect(menu('branch', branch({ ...cc, isHead: true })).some((l) => l.startsWith('Delete'))).toBe(false);
  setRefs(refsOn());
  expect(menu('branch', branch(cc))).toEqual(expect.arrayContaining(['Rename…', 'Delete code-conductor/wt…']));
});

test('Fast-forward to upstream is offered only for a branch strictly behind a present upstream', () => {
  setRefs(refsOn());
  const set = (t: object) => trackingStore.set(new Map([['app', { loading: false, data: { remotes: ['origin'], branches: { 'refs/heads/free': { upstream: 'refs/remotes/origin/free', ahead: 0, behind: 0, gone: false, ...t } } } }]]));
  set({ behind: 2 });
  expect(menu('branch', branch(FREE))).toContain('Fast-forward to origin/free');
  for (const t of [{ behind: 0 }, { behind: 2, ahead: 1 }, { behind: 2, gone: true }]) {
    set(t);
    expect(menu('branch', branch(FREE)), JSON.stringify(t)).not.toContain('Fast-forward to origin/free');
  }
});

test('the branches context deletes only branches not checked out, counting them; hidden when none remain', () => {
  setRefs(refsOn());
  expect(menu('branches', { tab: T, refs: [FREE, BUSY, MAIN, ORIGIN_FREE] })).toEqual(['Delete 2 branches…']);
  find('branches', { tab: T, refs: [FREE, BUSY, MAIN, ORIGIN_FREE] }, 'Delete 2 branches…').run!({ tab: T, refs: [FREE, BUSY, MAIN, ORIGIN_FREE] });
  expect((refDialogStore.get() as Extract<RefDialog, { kind: 'deleteBranches' }>).refs.map((r) => r.name)).toEqual([FREE.name, ORIGIN_FREE.name]);
  expect(menu('branches', { tab: T, refs: [BUSY, MAIN] })).toEqual([]);
});

test('the branch-drop menu: Fast-forward and Reset (a submenu onto HEAD, a force-move onto a free branch) after the merge/rebase card\'s items; onto a remote the remotes card\'s Push', () => {
  setRefs(refsOn());
  expect(menu('branch-drop', drop(FREE, MAIN))).toEqual([
    'Merge free into main', 'Merge free into main (no fast-forward)', 'Squash free into main', 'Rebase main onto free',
    'Fast-forward main to free', 'Reset main to free › Soft (keep index and files)', 'Reset main to free › Mixed (keep files)', 'Reset main to free › Hard (discard changes)',
  ]);
  expect(menu('branch-drop', drop(MAIN, FREE))).toEqual(['Rebase main onto free', 'Fast-forward free to main', 'Reset free to main…']);
  expect(menu('branch-drop', drop(MAIN, ORIGIN_FREE))).toEqual(['Rebase main onto origin/free', 'Push main to origin/free']);
  // Another checkout's branch: neither (the backend would refuse both).
  expect(menu('branch-drop', drop(FREE, BUSY))).toEqual([]);
  find('branch-drop', drop(MAIN, FREE), 'Reset free to main…').run!(drop(MAIN, FREE));
  expect(refDialogStore.get()).toMatchObject({ kind: 'moveBranch', name: 'free', from: FREE.oid, to: { oid: HEAD, label: 'main' } });
});

test('Revert and Cherry-pick pass mainline 1 for a merge; Cherry-pick is hidden on HEAD\'s commit', async () => {
  setRefs(refsOn());
  const f = backend();
  expect(menu('commit', commitCtx(HEAD))).not.toContain('Cherry-pick commit');
  const merge = commitCtx(oid(4), [oid(2), oid(3)]);
  expect(menu('commit', merge)).toEqual(expect.arrayContaining(['Revert merge (keep first parent)', 'Cherry-pick merge (first parent)']));
  find('commit', merge, 'Revert merge (keep first parent)').run!(merge);
  find('commit', merge, 'Cherry-pick merge (first parent)').run!(merge);
  const plain = commitCtx(oid(3));
  find('commit', plain, 'Revert commit').run!(plain);
  await waitFor(() => expect(sent(f, 'head.revert')).toHaveLength(2));
  expect(sent(f, 'head.revert')).toEqual([{ oid: oid(4), mainline: 1 }, { oid: oid(3) }]);
  await waitFor(() => expect(sent(f, 'head.cherryPick')).toEqual([{ oid: oid(4), mainline: 1 }]));
});

test('tag menu: Push to the one remote, or a submenu per remote; double-click jumps', () => {
  setRefs(refsOn());
  trackingStore.set(new Map([['app', { loading: false, data: { remotes: ['origin'], branches: {} } }]]));
  expect(menu('tag', branch(TAG))).toEqual(expect.arrayContaining(['Create branch here…', 'Push to origin', 'Delete locally…', 'Delete from origin…', 'Jump to commit']));
  trackingStore.set(new Map([['app', { loading: false, data: { remotes: ['origin', 'upstream'], branches: {} } }]]));
  expect(menu('tag', branch(TAG))).toEqual(expect.arrayContaining(['Push to › origin', 'Push to › upstream', 'Delete from › origin', 'Delete from › upstream']));
  expect(runPrimary('tag', branch(TAG))).toBe(true);
});

const ccHeadRef = ref('refs/heads/code-conductor/wt', oid(8));
const resets = (head: Ref) => [
  () => find('commit', commitCtx(oid(3)), `Reset ${head.short} to this commit › Soft (keep index and files)`).run!(commitCtx(oid(3))),
  () => find('branch', branch(FREE), `Reset ${head.short} to here › Mixed (keep files)`).run!(branch(FREE)),
  () => find('branch-drop', drop(FREE, { ...head, isHead: true }), `Reset ${head.short} to free › Soft (keep index and files)`).run!(drop(FREE, head)),
];

test('on a code-conductor/* HEAD: checkout (menu, double-click, remote) and soft/mixed resets send nothing until the cc confirmation is accepted, then send ccOwned', async () => {
  setRefs(refsOn(ccHeadRef));
  const f = backend();
  const gated: (() => void)[] = [
    () => find('branch', branch(FREE), 'Checkout').run!(branch(FREE)),
    () => runPrimary('branch', branch(FREE)),
    () => find('branch', branch(ORIGIN_FREE), 'Checkout').run!(branch(ORIGIN_FREE)),
    ...resets(ccHeadRef),
  ];
  for (const open of gated) {
    settleConfirm(false);
    open();
    const pending = confirmStore.get();
    expect(pending?.opts.body).toContain("code-conductor's worktree on code-conductor/wt");
    await Promise.resolve();
    expect(sent(f, 'branch.checkout').length + sent(f, 'head.reset').length).toBe(0);
  }
  // Accepting the last one (a drag-menu soft reset) sends the acknowledgement.
  expect(confirmStore.get()?.opts.confirmLabel).toBe('Reset anyway');
  settleConfirm(true);
  await waitFor(() => expect(sent(f, 'head.reset')).toEqual([{ to: oid(5), mode: 'soft', expect: oid(8), ccOwned: true }]));
  expect(sent(f, 'branch.checkout')).toEqual([]);
});

test('with a normal HEAD the same actions run at once, without ccOwned', async () => {
  setRefs(refsOn());
  const f = backend();
  find('branch', branch(FREE), 'Checkout').run!(branch(FREE));
  runPrimary('branch', branch(FREE));
  for (const r of resets(MAIN)) r();
  expect(refDialogStore.get()).toBeNull();
  expect(confirmStore.get()).toBeNull();
  await waitFor(() => expect(sent(f, 'branch.checkout')).toEqual([{ ref: FREE.name }, { ref: FREE.name }]));
  await waitFor(() => expect(sent(f, 'head.reset')).toHaveLength(3));
  expect(sent(f, 'head.reset').every((p) => !('ccOwned' in (p as object)))).toBe(true);
});

test('on a code-conductor/* HEAD, Fast-forward, Revert and Cherry-pick run without the gate', async () => {
  setRefs(refsOn(ccHeadRef));
  const f = backend();
  find('branch-drop', drop(FREE, MAIN), 'Fast-forward main to free').run!(drop(FREE, MAIN));
  find('commit', commitCtx(oid(3)), 'Revert commit').run!(commitCtx(oid(3)));
  find('commit', commitCtx(oid(3)), 'Cherry-pick commit').run!(commitCtx(oid(3)));
  expect(refDialogStore.get()).toBeNull();
  expect(confirmStore.get()).toBeNull();
  await waitFor(() => expect(sent(f, 'branch.fastForward')).toHaveLength(1));
  await waitFor(() => expect(sent(f, 'head.revert').length + sent(f, 'head.cherryPick').length).toBe(2));
});

test('a hard reset always opens the reset dialog with HEAD as expect', () => {
  setRefs(refsOn());
  find('commit', commitCtx(oid(3)), 'Reset main to this commit › Hard (discard changes)').run!(commitCtx(oid(3)));
  expect(refDialogStore.get()).toMatchObject({ kind: 'reset', mode: 'hard', branch: 'main', expect: HEAD, to: { oid: oid(3) } });
});

test('a selection over NAMES_MAX deletes the first NAMES_MAX and tells the dialog how many were left out', () => {
  setRefs(refsOn());
  const many = Array.from({ length: NAMES_MAX + 5 }, (_, i) => ref(`refs/heads/b${i}`, oid(1)));
  const ctx = { tab: T, refs: many };
  expect(menu('branches', ctx)).toEqual([`Delete ${NAMES_MAX} branches…`]);
  find('branches', ctx, `Delete ${NAMES_MAX} branches…`).run!(ctx);
  const d = refDialogStore.get() as Extract<RefDialog, { kind: 'deleteBranches' }>;
  expect(d.refs.map((r) => r.name)).toEqual(many.slice(0, NAMES_MAX).map((r) => r.name));
  expect(d.omitted).toBe(5);
});

test('on a code-conductor/* HEAD, checking out its own remote twin (only a fast-forward) asks nothing and sends no ccOwned', async () => {
  const twin = ref('refs/remotes/origin/code-conductor/wt', oid(9));
  const refs = refsOn(ccHeadRef);
  setRefs({ ...refs, refs: [...refs.refs, twin] });
  const f = backend();
  // Control: the same action on another remote branch is gated (and cancelled here).
  find('branch', branch(ORIGIN_FREE), 'Checkout').run!(branch(ORIGIN_FREE));
  expect(confirmStore.get()?.opts.confirmLabel).toBe('Switch anyway');
  settleConfirm(false);
  find('branch', branch(twin), 'Checkout').run!(branch(twin));
  expect(confirmStore.get()).toBeNull();
  await waitFor(() => expect(sent(f, 'branch.checkout')).toEqual([{ ref: 'refs/remotes/origin/code-conductor/wt' }]));
});
