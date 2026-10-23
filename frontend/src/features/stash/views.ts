import type { DiffSource } from '@/features/diff/api';
import type { Stash } from '@/features/graph/types';
import { getGraph } from '@/state/graph';
import type { Tab } from '@/state/tabs';

// A stash is three commits: W (the worktree, parents base and I), I (the index, parent base) and, when it holds
// untracked files, U (a root commit). Each view of the switch is the diff of one of them (docs/graph.md → Diffs).

export type StashView = 'all' | 'staged' | 'untracked';
export const STASH_VIEWS: { view: StashView; label: string }[] = [
  { view: 'all', label: 'All changes' }, { view: 'staged', label: 'Staged' }, { view: 'untracked', label: 'Untracked' },
];

/** The views a stash has: Untracked only when it has a U commit. */
export const viewsOf = (stash: Stash): StashView[] => (stash.parents.length >= 3 ? ['all', 'staged', 'untracked'] : ['all', 'staged']);

/** The stash and view whose diff shows `commitOid` (W → all, I → staged, U → untracked), or null when it is none of them. */
export function stashViewOf(stashes: readonly Stash[], commitOid: string): { stash: Stash; view: StashView } | null {
  for (const stash of stashes) {
    if (stash.oid === commitOid) return { stash, view: 'all' };
    if (stash.parents[1] === commitOid) return { stash, view: 'staged' };
    if (stash.parents[2] === commitOid) return { stash, view: 'untracked' };
  }
  return null;
}

/** The diff a view opens: all = W against the base, staged = I against the base (its only parent), untracked = U (a root: against the empty tree). */
export function stashViewSource(stash: Stash, view: StashView): DiffSource {
  if (view === 'staged') return { kind: 'commit', rev: stash.parents[1] };
  if (view === 'untracked') return { kind: 'commit', rev: stash.parents[2] };
  return { kind: 'commit', rev: stash.oid, parent: 1 };
}

/** The tab's stashes as the graph last read them. */
export const stashesOf = (tab: Tab): Stash[] => getGraph(tab).refs?.stashes ?? [];

/** The message part of a stash's subject: what git's "On <branch>: " / "WIP on <branch>: " prefix is followed by. */
export const messageOf = (subject: string): string => subject.replace(/^(?:WIP on|On) [^:]*: /, '');
