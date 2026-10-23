import { abbrev, ccHead, headLabel, headOf, shortBranch } from '@/features/branches/refInfo';
import { ancestorsWithin } from '@/features/graph/ancestry';
import type { BranchDropCtx, CommitCtx, CommitsCtx, DragRef, RefCtx } from '@/features/graph/contexts';
import type { CommitItem } from '@/features/graph/types';
import type { MenuAction } from '@/shell/menus';
import { getGraph } from '@/state/graph';
import { openSequenceDialog } from '@/state/sequenceDialog';
import type { Tab } from '@/state/tabs';
import type { MergeMode } from './api';
import { mergeFlow, rebaseFlow } from './flows';

// The merge and rebase menu items (docs/merge.md → Where the actions are). Orders: the branch-drop menu's 100–199
// (merge 100–102, rebase 110), the branch menu's 330–, the commit menu's 312–, the commits menu's 320–; group `rewrite`
// beside C5's reset (300), revert (310) and cherry-pick (311). HEAD is read from the graph's refs answer.

const parentsMemo = new WeakMap<readonly CommitItem[], ReadonlyMap<string, string[]>>();
/** The loaded commits' parents, one map per loaded page set (ancestorsWithin memoizes on its identity). */
function parentsOf(tab: Tab): ReadonlyMap<string, string[]> {
  const commits = getGraph(tab).commits;
  let m = parentsMemo.get(commits);
  if (!m) { m = new Map(commits.map((c) => [c.oid, c.parents])); parentsMemo.set(commits, m); }
  return m;
}

/** `oid` is HEAD's commit or one of its ancestors, among the loaded rows. */
export function inHeadHistory(tab: Tab, oid: string): boolean {
  const head = headOf(tab).oid;
  return head !== null && ancestorsWithin(head, parentsOf(tab)).has(oid);
}

const headBorn = (tab: Tab) => headOf(tab).oid !== null;
const isHeadBranch = (tab: Tab, r: { name: string }) => headOf(tab).branch === r.name;

/**
 * The selected commits as one first-parent chain, newest first, when they are one: every row a commit with exactly one
 * parent (no merge, no root), each the parent of the one above it. null otherwise.
 */
export function chainOf(c: CommitsCtx): CommitItem[] | null {
  const items = c.rows.map((r) => (r.kind === 'commit' ? r.item : null));
  if (items.length < 2 || items.some((i) => i === null || i.parents.length !== 1)) return null;
  const chain = items as CommitItem[];
  return chain.every((it, i) => i === chain.length - 1 || it.parents[0] === chain[i + 1].oid) ? chain : null;
}

// ---- merge ----

function merge(tab: Tab, source: { ref: string | null; oid: string; label: string }, mode: MergeMode): void {
  const expect = headOf(tab).oid;
  if (!expect) return;
  void mergeFlow(tab, { ...source, into: headLabel(tab), expect, mode });
}
const dropMergeable = (c: BranchDropCtx) => c.target.kind === 'local' && isHeadBranch(c.tab, c.target) && !!c.source.oid && !!c.target.oid && c.source.oid !== c.target.oid;
const dropSource = (c: BranchDropCtx) => ({ ref: c.source.name, oid: c.source.oid!, label: c.source.short });

const MERGE_ITEMS: [MergeMode, number, (s: string, t: string) => string][] = [
  ['ff', 100, (s, t) => `Merge ${s} into ${t}`],
  ['noFf', 101, (s, t) => `Merge ${s} into ${t} (no fast-forward)`],
  ['squash', 102, (s, t) => `Squash ${s} into ${t}`],
];

// ---- rebase ----

/** Rebase HEAD's branch onto `onto`: the commits not in it are replayed (`git rebase <onto>`). */
function rebaseOnto(tab: Tab, onto: string, ontoLabel: string): void {
  const expect = headOf(tab).oid;
  if (!expect) return;
  rebaseFlow(tab, { onto, upstream: onto, expect, branch: headLabel(tab), ontoLabel });
}

/** A drop's rebase: which branch moves (HEAD's) onto which; null when neither side is HEAD's branch. */
export function dropRebase(c: BranchDropCtx): { branch: DragRef; onto: DragRef } | null {
  if (!c.source.oid || !c.target.oid || c.source.oid === c.target.oid) return null;
  if (c.source.kind === 'local' && isHeadBranch(c.tab, c.source)) return { branch: c.source, onto: c.target };
  if (c.target.kind === 'local' && isHeadBranch(c.tab, c.target)) return { branch: c.target, onto: c.source };
  return null;
}

/** Another branch than HEAD's, at another commit, with HEAD born: what the branch menu merges or rebases onto. */
const otherBranch = (c: RefCtx) => !!c.ref.oid && headBorn(c.tab) && !isHeadBranch(c.tab, c.ref) && c.ref.oid !== headOf(c.tab).oid;

export const SEQUENCE_ACTIONS: MenuAction<never>[] = [
  // ---- a branch dropped on HEAD's branch (merge), or HEAD's branch dropped on another / another on it (rebase) ----
  ...MERGE_ITEMS.map(([mode, order, label]): MenuAction<BranchDropCtx> => ({
    id: `sequence.drop.merge.${mode}`, context: 'branch-drop', group: 'merge', order,
    label: (c) => label(c.source.short, c.target.short), when: dropMergeable,
    run: (c) => merge(c.tab, dropSource(c), mode),
  })),
  {
    id: 'sequence.drop.rebase', context: 'branch-drop', group: 'rebase', order: 110,
    label: (c: BranchDropCtx) => { const d = dropRebase(c)!; return `Rebase ${d.branch.short} onto ${d.onto.short}`; },
    when: (c: BranchDropCtx) => dropRebase(c) !== null,
    run: (c: BranchDropCtx) => { const d = dropRebase(c)!; rebaseOnto(c.tab, d.onto.oid!, d.onto.short); },
  },
  // ---- a branch other than HEAD's ----
  {
    id: 'sequence.branch.merge', context: 'branch', group: 'rewrite', order: 330,
    label: (c: RefCtx) => `Merge ${c.ref.short} into ${headLabel(c.tab)}`, when: otherBranch,
    run: (c: RefCtx) => merge(c.tab, { ref: c.ref.name, oid: c.ref.oid!, label: c.ref.short }, 'ff'),
  },
  {
    id: 'sequence.branch.rebase', context: 'branch', group: 'rewrite', order: 331,
    label: (c: RefCtx) => `Rebase ${headLabel(c.tab)} onto ${c.ref.short}`, when: otherBranch,
    run: (c: RefCtx) => rebaseOnto(c.tab, c.ref.oid!, c.ref.short),
  },
  // ---- a commit outside HEAD's history ----
  {
    id: 'sequence.commit.rebase', context: 'commit', group: 'rewrite', order: 312,
    label: (c: CommitCtx) => `Rebase ${headLabel(c.tab)} onto this commit`,
    when: (c: CommitCtx) => headBorn(c.tab) && c.commit.oid !== headOf(c.tab).oid && !inHeadHistory(c.tab, c.commit.oid),
    run: (c: CommitCtx) => rebaseOnto(c.tab, c.commit.oid, abbrev(c.commit.oid)),
  },
  // ---- the newest N commits of HEAD's branch ----
  {
    id: 'sequence.commits.rebaseOnto', context: 'commits', group: 'rewrite', order: 322,
    label: (c: CommitsCtx) => `Rebase ${c.rows.length} commits onto…`,
    when: (c: CommitsCtx) => chainOf(c)?.[0].oid === headOf(c.tab).oid,
    run: (c: CommitsCtx) => {
      const chain = chainOf(c)!;
      openSequenceDialog({ kind: 'rebaseOnto', tab: c.tab, count: chain.length, upstream: chain.at(-1)!.parents[0], expect: chain[0].oid });
    },
  },
] as MenuAction<never>[];

/** The branch HEAD is on, short, for a dialog's text ("HEAD" when detached); whether moving it needs the cc warning. */
export const headBranchInfo = (tab: Tab) => ({ name: headOf(tab).branch ? shortBranch(headOf(tab).branch!) : 'HEAD', cc: ccHead(tab) });
