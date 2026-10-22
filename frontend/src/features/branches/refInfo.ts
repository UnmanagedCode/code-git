import type { Ref } from '@/features/graph/types';
import { getGraph } from '@/state/graph';
import { getTracking } from '@/state/branchTracking';
import type { Tab } from '@/state/tabs';

// What the branch UI reads about a checkout's refs, from the graph's last refs answer (docs/refs.md → Checked-out
// rules). The backend re-checks everything: this only decides what is offered.

const HEADS = 'refs/heads/';
const CC_PREFIX = 'code-conductor/';

/** `refs/heads/x` → `x`. */
export const shortBranch = (ref: string): string => (ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref);
/** A branch code-conductor owns (short or full name). */
export const isCcOwned = (name: string): boolean => shortBranch(name).startsWith(CC_PREFIX);
/** A remote ref's branch on its remote: `origin/feature/a` → `feature/a`. */
export const remoteBranch = (r: Ref): string => (r.remote ? r.short.slice(r.remote.length + 1) : r.short);
export const abbrev = (oid: string): string => oid.slice(0, 7);

/** This checkout's HEAD: its branch (full) or null when detached, and its commit or null when unborn. */
export function headOf(tab: Tab): { branch: string | null; oid: string | null } {
  const h = getGraph(tab).refs?.head;
  return { branch: h?.branch && !h.detached ? h.branch : null, oid: h?.oid ?? null };
}

/** What a reset of HEAD names: its branch, else "HEAD". */
export const headLabel = (tab: Tab): string => {
  const b = headOf(tab).branch;
  return b ? shortBranch(b) : 'HEAD';
};

/** This checkout's HEAD is a code-conductor/* branch: moving it needs the user's acknowledgement. */
export const ccHead = (tab: Tab): boolean => {
  const b = headOf(tab).branch;
  return b !== null && isCcOwned(b);
};

/**
 * `ref` (full) is checked out in another checkout of the repo. Unknown worktrees (git < 2.36) count as not: the
 * action is offered and the backend refuses.
 */
export function checkedOutElsewhere(tab: Tab, ref: string): boolean {
  const refs = getGraph(tab).refs;
  if (!refs || refs.head.branch === ref) return false;
  return (refs.worktrees ?? []).some((w) => w.branch === ref);
}

export const checkedOutAnywhere = (tab: Tab, ref: string): boolean => headOf(tab).branch === ref || checkedOutElsewhere(tab, ref);

/** The repo's remotes: from tracking when loaded, else those the graph's remote refs name. */
export function remotesOf(tab: Tab): string[] {
  const fromTracking = getTracking(tab).data?.remotes;
  if (fromTracking) return fromTracking;
  return [...new Set((getGraph(tab).refs?.refs ?? []).filter((r) => r.kind === 'remote' && r.remote).map((r) => r.remote!))].sort();
}

/** The graph's ref of that full name. */
export const refNamed = (tab: Tab, name: string): Ref | undefined => getGraph(tab).refs?.refs.find((r) => r.name === name);
