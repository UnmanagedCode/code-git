import type { BranchDropCtx, BranchesCtx, CommitCtx, RefCtx } from '@/features/graph/contexts';
import type { Ref } from '@/features/graph/types';
import type { ApiError } from '@/lib/api';
import type { ToastText } from '@/lib/opToast';
import type { MenuAction } from '@/shell/menus';
import { trackingOf } from '@/state/branchTracking';
import { openRefDialog, type Point } from '@/state/refDialog';
import type { Tab } from '@/state/tabs';
import {
  checkoutBranch, cherryPick, fastForward, pushTags, resetHead, revertCommit, type CheckoutResult, type ResetMode,
} from './api';
import { abbrev, ccHead, checkedOutAnywhere, checkedOutElsewhere, headLabel, headOf, isCcOwned, refNamed, remoteBranch, remotesOf, shortBranch } from './refInfo';
import { applyToast, fileList, rejectedLines, runRefOp } from './run';

// The branch, tag and HEAD actions (docs/refs.md → Menus). Orders: 100 checkout, 200 create, 300 history-rewriting;
// on the branch-drop menu 100–199 are left to the merge/rebase card.

const MODES: ResetMode[] = ['soft', 'mixed', 'hard'];
const MODE_LABEL: Record<ResetMode, string> = { soft: 'Soft (keep index and files)', mixed: 'Mixed (keep files)', hard: 'Hard (discard changes)' };

const pointOf = (r: Ref): Point | null => (r.oid ? { oid: r.oid, label: r.short } : null);
const commitPoint = (c: CommitCtx): Point => ({ oid: c.commit.oid, label: abbrev(c.commit.oid) });

/**
 * Runs `run` at once unless this checkout's HEAD is a code-conductor/* branch; then only the ccHeadMove confirmation
 * runs it, with the acknowledgement.
 */
export function withCcHeadAck(tab: Tab, action: 'checkout' | 'reset', label: string, run: (ccOwned?: true) => Promise<unknown>): void {
  if (!ccHead(tab)) { void run(); return; }
  openRefDialog({ kind: 'ccHeadMove', tab, branch: shortBranch(headOf(tab).branch!), action, label, run });
}

/** A CC_OWNED_BRANCH refusal about this HEAD (the UI's refs were stale): the toast offers the confirmation. */
const ccRetry = (tab: Tab, action: 'checkout' | 'reset', label: string, run: (ccOwned: true) => Promise<unknown>) => (e: ApiError): Partial<ToastText> | undefined => {
  const body = e.body as { head?: unknown; branches?: unknown } | undefined;
  if (e.code !== 'CC_OWNED_BRANCH' || body?.head !== true) return undefined;
  const branch = Array.isArray(body.branches) && typeof body.branches[0] === 'string' ? body.branches[0] : '';
  return {
    title: 'This checkout is code-conductor\'s worktree',
    action: { label: 'Review…', onClick: () => openRefDialog({ kind: 'ccHeadMove', tab, branch, action, label, run }) },
  };
};

function checkoutDone(r: CheckoutResult): string | ToastText {
  const name = shortBranch(r.branch);
  if (r.ffBlocked) return { tone: 'warning', title: `Checked out ${name}, not fast-forwarded`, description: `Local changes in ${fileList(r.ffBlocked)}.` };
  if (r.created) return `Created and checked out ${name}`;
  return r.fastForwarded ? `Checked out ${name}, fast-forwarded` : `Checked out ${name}`;
}

/** Checks `r` out (a remote branch: as its local branch). Gated on a cc-owned HEAD unless nothing would switch. */
export function checkout(tab: Tab, r: Ref): void {
  const name = r.kind === 'remote' ? remoteBranch(r) : r.short;
  const go = (ccOwned?: true): Promise<unknown> => runRefOp(tab, {
    running: `Checking out ${name}…`, done: checkoutDone, failed: ccRetry(tab, 'checkout', `Switching to ${name}`, go),
  }, () => checkoutBranch(tab, r.name, ccOwned));
  // A remote branch whose local twin is HEAD only fast-forwards it: no switch, no acknowledgement.
  if (r.kind === 'remote' && headOf(tab).branch === `refs/heads/${name}`) { void go(); return; }
  withCcHeadAck(tab, 'checkout', `Switching to ${name}`, go);
}

/** Resets HEAD to `to`: hard asks first (reset dialog); soft and mixed run at once, cc-gated. */
export function reset(tab: Tab, to: Point, mode: ResetMode): void {
  const { oid } = headOf(tab);
  if (!oid) return;
  const head = headLabel(tab);
  if (mode === 'hard') {
    openRefDialog({ kind: 'reset', tab, to, mode, branch: head === 'HEAD' ? null : head, expect: oid });
    return;
  }
  const go = (ccOwned?: true): Promise<unknown> => runRefOp(tab, {
    running: `Resetting ${head}…`, done: () => `Reset ${head} to ${to.label} (${mode})`,
    failed: ccRetry(tab, 'reset', `Resetting ${head} to ${to.label}`, go),
  }, () => resetHead(tab, { to: to.oid, mode, expect: oid, ccOwned }));
  withCcHeadAck(tab, 'reset', `Resetting ${head} to ${to.label}`, go);
}

/** The Soft / Mixed / Hard submenu resetting HEAD to the ctx's point. */
const resetChildren = <C extends { tab: Tab }>(id: string, context: string, point: (c: C) => Point | null): MenuAction<C>[] => MODES.map((mode) => ({
  id: `${id}.${mode}`, context, label: MODE_LABEL[mode], destructive: mode === 'hard',
  run: (c: C) => { const p = point(c); if (p) reset(c.tab, p, mode); },
}));

const headBorn = (tab: Tab) => headOf(tab).oid !== null;

/** One item per remote: a plain item (`one(remote)`) for a single remote, a submenu (`many`) for several. */
function perRemote<C extends { tab: Tab }>(
  id: string, context: string, base: Pick<MenuAction<C>, 'group' | 'order' | 'destructive'>,
  labels: { one: (remote: string) => string; many: string }, run: (c: C, remote: string) => void,
): MenuAction<C>[] {
  return [
    { ...base, id, context, label: (c) => labels.one(remotesOf(c.tab)[0]), when: (c) => remotesOf(c.tab).length === 1, run: (c) => run(c, remotesOf(c.tab)[0]) },
    {
      ...base, id: `${id}.pick`, context, label: labels.many, when: (c) => remotesOf(c.tab).length > 1,
      children: (c) => remotesOf(c.tab).map((remote) => ({ id: `${id}.${remote}`, context, label: remote, destructive: base.destructive, run: (x: C) => run(x, remote) })),
    },
  ];
}

function createBranchAt<C extends { tab: Tab }>(id: string, context: string, point: (c: C) => Point | null): MenuAction<C> {
  return {
    id, context, label: 'Create branch here…', group: 'create', order: 200, when: (c) => point(c) !== null,
    run: (c) => openRefDialog({ kind: 'createBranch', tab: c.tab, from: point(c) }),
  };
}
function createTagAt<C extends { tab: Tab }>(id: string, context: string, point: (c: C) => Point | null): MenuAction<C> {
  return {
    id, context, label: 'Create tag here…', group: 'create', order: 201, when: (c) => point(c) !== null,
    run: (c) => { const at = point(c); if (at) openRefDialog({ kind: 'createTag', tab: c.tab, at }); },
  };
}

const isLocal = (c: RefCtx) => c.ref.kind === 'local';
const isRemote = (c: RefCtx) => c.ref.kind === 'remote';
const refPoint = (c: RefCtx) => pointOf(c.ref);

/** Fast-forward to its upstream: only a branch strictly behind it. */
function upstreamOf(c: RefCtx): Ref | null {
  const t = trackingOf(c.tab, c.ref.name);
  if (!t?.upstream || t.gone || t.behind === 0 || t.ahead > 0) return null;
  const up = refNamed(c.tab, t.upstream);
  return up?.oid ? up : null;
}

function fastForwardTo(tab: Tab, name: string, to: string, toLabel: string, expect: string) {
  void runRefOp(tab, {
    running: `Fast-forwarding ${name}…`, done: (r) => (r.upToDate ? `${name} is already at ${toLabel}` : `Fast-forwarded ${name} to ${toLabel}`),
  }, () => fastForward(tab, name, to, expect));
}

function pushTag(tab: Tab, name: string, remote: string) {
  void runRefOp(tab, {
    running: `Pushing ${name} to ${remote}…`,
    done: (r) => (r.rejected.length
      ? { tone: 'warning', title: `${remote} rejected ${name}`, description: rejectedLines(r.rejected).join('\n') }
      : r.upToDate.length ? `${name} is already on ${remote}` : `Pushed ${name} to ${remote}`),
  }, () => pushTags(tab, remote, [name]));
}

function apply(tab: Tab, which: 'revert' | 'cherry-pick', c: CommitCtx) {
  const mainline = c.commit.parents.length > 1 ? 1 : undefined;
  const short = abbrev(c.commit.oid);
  void runRefOp(tab, {
    running: `${which === 'revert' ? 'Reverting' : 'Cherry-picking'} ${short}…`,
    done: applyToast(tab, which, which === 'revert' ? `Reverted ${short}` : `Cherry-picked ${short}`),
  }, () => (which === 'revert' ? revertCommit(tab, c.commit.oid, mainline) : cherryPick(tab, c.commit.oid, mainline)));
}

/** The branches of a multi-selection that may be deleted: checked-out ones never are. */
const deletable = (c: BranchesCtx) => c.refs.filter((r) => r.kind === 'remote' || (r.kind === 'local' && !checkedOutAnywhere(c.tab, r.name)));

const dropTargetLocal = (c: BranchDropCtx) => c.target.kind === 'local' && !!c.target.oid && !!c.source.oid;
const dropIsHead = (c: BranchDropCtx) => dropTargetLocal(c) && headOf(c.tab).branch === c.target.name;
const dropPoint = (c: BranchDropCtx): Point | null => (c.source.oid ? { oid: c.source.oid, label: c.source.short } : null);

export const BRANCH_ACTIONS: MenuAction<never>[] = [
  // ---- branch (local or remote) ----
  {
    id: 'branches.branch.checkout', context: 'branch', label: 'Checkout', group: 'checkout', order: 100, primary: true,
    when: (c: RefCtx) => (isLocal(c) ? !c.ref.isHead && !checkedOutElsewhere(c.tab, c.ref.name) : isRemote(c)),
    run: (c: RefCtx) => checkout(c.tab, c.ref),
  },
  createBranchAt('branches.branch.createBranch', 'branch', refPoint),
  createTagAt('branches.branch.createTag', 'branch', refPoint),
  {
    id: 'branches.branch.rename', context: 'branch', label: 'Rename…', group: 'create', order: 210,
    // cc's worktree record names a checked-out cc branch, wherever it is checked out.
    when: (c: RefCtx) => isLocal(c) && !checkedOutElsewhere(c.tab, c.ref.name) && !(isCcOwned(c.ref.short) && checkedOutAnywhere(c.tab, c.ref.name)),
    run: (c: RefCtx) => openRefDialog({ kind: 'renameBranch', tab: c.tab, name: c.ref.short }),
  },
  {
    id: 'branches.branch.upstream', context: 'branch', label: 'Set upstream…', group: 'create', order: 220, when: isLocal,
    run: (c: RefCtx) => openRefDialog({ kind: 'setUpstream', tab: c.tab, branch: c.ref.short }),
  },
  {
    id: 'branches.branch.fastForward', context: 'branch', group: 'create', order: 230,
    label: (c: RefCtx) => `Fast-forward to ${upstreamOf(c)?.short ?? 'upstream'}`,
    when: (c: RefCtx) => isLocal(c) && !!c.ref.oid && !checkedOutElsewhere(c.tab, c.ref.name) && upstreamOf(c) !== null,
    run: (c: RefCtx) => { const up = upstreamOf(c)!; fastForwardTo(c.tab, c.ref.short, up.oid!, up.short, c.ref.oid!); },
  },
  {
    id: 'branches.branch.reset', context: 'branch', group: 'rewrite', order: 300, label: (c: RefCtx) => `Reset ${headLabel(c.tab)} to here`,
    when: (c: RefCtx) => !c.ref.isHead && !!c.ref.oid && headBorn(c.tab) && c.ref.oid !== headOf(c.tab).oid,
    children: resetChildren<RefCtx>('branches.branch.reset', 'branch', refPoint),
  },
  {
    id: 'branches.branch.delete', context: 'branch', group: 'delete', order: 340, destructive: true,
    label: (c: RefCtx) => `Delete ${c.ref.short}…`,
    when: (c: RefCtx) => isLocal(c) && !checkedOutAnywhere(c.tab, c.ref.name),
    run: (c: RefCtx) => openRefDialog({ kind: 'deleteBranches', tab: c.tab, refs: [c.ref] }),
  },
  {
    id: 'branches.branch.deleteRemote', context: 'branch', group: 'delete', order: 341, destructive: true,
    label: (c: RefCtx) => `Delete ${remoteBranch(c.ref)} from ${c.ref.remote}…`, when: isRemote,
    run: (c: RefCtx) => openRefDialog({ kind: 'deleteBranches', tab: c.tab, refs: [c.ref] }),
  },
  // ---- a refs-panel multi-selection ----
  {
    id: 'branches.branches.delete', context: 'branches', group: 'delete', order: 340, destructive: true,
    label: (c: BranchesCtx) => `Delete ${deletable(c).length} branches…`, when: (c: BranchesCtx) => deletable(c).length > 0,
    run: (c: BranchesCtx) => openRefDialog({ kind: 'deleteBranches', tab: c.tab, refs: deletable(c) }),
  },
  // ---- tag ----
  createBranchAt('branches.tag.createBranch', 'tag', refPoint),
  ...perRemote<RefCtx>('branches.tag.push', 'tag', { group: 'remote', order: 250 }, { one: (remote) => `Push to ${remote}`, many: 'Push to' },
    (c, remote) => pushTag(c.tab, c.ref.short, remote)),
  {
    id: 'branches.tag.reset', context: 'tag', group: 'rewrite', order: 300, label: (c: RefCtx) => `Reset ${headLabel(c.tab)} to here`,
    when: (c: RefCtx) => !!c.ref.oid && headBorn(c.tab) && c.ref.oid !== headOf(c.tab).oid,
    children: resetChildren<RefCtx>('branches.tag.reset', 'tag', refPoint),
  },
  {
    id: 'branches.tag.delete', context: 'tag', group: 'delete', order: 340, destructive: true, label: 'Delete locally…',
    run: (c: RefCtx) => openRefDialog({ kind: 'deleteTags', tab: c.tab, names: [c.ref.short], remote: null }),
  },
  ...perRemote<RefCtx>('branches.tag.deleteRemote', 'tag', { group: 'delete', order: 341, destructive: true }, { one: (remote) => `Delete from ${remote}…`, many: 'Delete from' },
    (c, remote) => openRefDialog({ kind: 'deleteTags', tab: c.tab, names: [c.ref.short], remote })),
  // ---- commit ----
  createBranchAt('branches.commit.createBranch', 'commit', commitPoint),
  createTagAt('branches.commit.createTag', 'commit', commitPoint),
  {
    id: 'branches.commit.reset', context: 'commit', group: 'rewrite', order: 300, label: (c: CommitCtx) => `Reset ${headLabel(c.tab)} to this commit`,
    when: (c: CommitCtx) => headBorn(c.tab) && c.commit.oid !== headOf(c.tab).oid,
    children: resetChildren<CommitCtx>('branches.commit.reset', 'commit', commitPoint),
  },
  {
    id: 'branches.commit.revert', context: 'commit', group: 'rewrite', order: 310, when: (c: CommitCtx) => headBorn(c.tab),
    label: (c: CommitCtx) => (c.commit.parents.length > 1 ? 'Revert merge (keep first parent)' : 'Revert commit'),
    run: (c: CommitCtx) => apply(c.tab, 'revert', c),
  },
  {
    id: 'branches.commit.cherryPick', context: 'commit', group: 'rewrite', order: 311,
    label: (c: CommitCtx) => (c.commit.parents.length > 1 ? 'Cherry-pick merge (first parent)' : 'Cherry-pick commit'),
    when: (c: CommitCtx) => headBorn(c.tab) && c.commit.oid !== headOf(c.tab).oid,
    run: (c: CommitCtx) => apply(c.tab, 'cherry-pick', c),
  },
  // ---- a branch dropped on another (100–199: merge and rebase, a later card) ----
  {
    id: 'branches.drop.fastForward', context: 'branch-drop', group: 'ff', order: 200,
    label: (c: BranchDropCtx) => `Fast-forward ${c.target.short} to ${c.source.short}`,
    when: (c: BranchDropCtx) => dropTargetLocal(c) && !checkedOutElsewhere(c.tab, c.target.name) && c.source.oid !== c.target.oid,
    run: (c: BranchDropCtx) => fastForwardTo(c.tab, c.target.short, c.source.oid!, c.source.short, c.target.oid!),
  },
  {
    id: 'branches.drop.resetHead', context: 'branch-drop', group: 'rewrite', order: 300,
    label: (c: BranchDropCtx) => `Reset ${c.target.short} to ${c.source.short}`,
    when: (c: BranchDropCtx) => dropIsHead(c) && c.source.oid !== c.target.oid,
    children: resetChildren<BranchDropCtx>('branches.drop.resetHead', 'branch-drop', dropPoint),
  },
  {
    id: 'branches.drop.move', context: 'branch-drop', group: 'rewrite', order: 300, destructive: true,
    label: (c: BranchDropCtx) => `Reset ${c.target.short} to ${c.source.short}…`,
    when: (c: BranchDropCtx) => dropTargetLocal(c) && !checkedOutAnywhere(c.tab, c.target.name) && c.source.oid !== c.target.oid,
    run: (c: BranchDropCtx) => openRefDialog({ kind: 'moveBranch', tab: c.tab, name: c.target.short, from: c.target.oid!, to: dropPoint(c)! }),
  },
] as MenuAction<never>[];
