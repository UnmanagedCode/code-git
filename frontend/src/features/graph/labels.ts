import type { Visibility } from './visibility';
import type { Checkout, GitWorktree, Ref, RefsResult } from './types';

export type Label =
  /** The checked-out branch (`ref` set, bold with a check) or, detached, a bare HEAD chip (`ref` null). */
  | { kind: 'head'; text: string; ref: Ref | null; remotes: Ref[] }
  /** A local branch; `remotes` are remote branches of the same name at the same commit, shown in the one chip. */
  | { kind: 'local'; text: string; ref: Ref; remotes: Ref[] }
  | { kind: 'remote'; text: string; ref: Ref }
  | { kind: 'tag'; text: string; ref: Ref }
  | { kind: 'stash'; text: string }
  /** "in X": another checkout of the project has this commit checked out. */
  | { kind: 'worktree'; text: string; worktree: GitWorktree };

/** The branch part of a remote ref's short name: `origin/feat/x` → `feat/x`. */
const branchOf = (r: Ref) => (r.remote ? r.short.slice(r.remote.length + 1) : r.short);
const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/**
 * The cc name of a git worktree: the cc checkout on its branch (or, detached, at its commit), else its directory's name.
 * The main checkout's cc name is the project's.
 */
export function worktreeName(w: GitWorktree, checkouts: Checkout[]): { name: string; checkout: Checkout | null } {
  const c = w.branch
    ? checkouts.find((x) => x.branch === w.branch)
    : checkouts.find((x) => x.branch === null && x.headOid !== null && x.headOid === w.head);
  return c ? { name: c.name, checkout: c } : { name: basename(w.path), checkout: null };
}

/** The git worktree a checkout is: matched by branch, or by commit when detached. */
export function ownWorktree(head: RefsResult['head'], worktrees: GitWorktree[]): GitWorktree | null {
  return worktrees.find((w) => (head.branch ? w.branch === head.branch : w.detached && w.head === head.oid)) ?? null;
}

/** Labels per commit oid for the visible refs, HEAD, stashes and the other checkouts' HEADs. */
export function labelsByOid(refs: RefsResult, vis: Visibility, checkouts: Checkout[]): Map<string, Label[]> {
  // Linear in the number of refs: one list per commit, appended to; remote twins found through one index.
  const out = new Map<string, Label[]>();
  const add = (oid: string | null, l: Label) => {
    if (!oid) return;
    const list = out.get(oid);
    if (list) list.push(l); else out.set(oid, [l]);
  };
  const shown = refs.refs.filter((r) => vis.visible.has(r.name) && r.oid);
  const remotes = shown.filter((r) => r.kind === 'remote');
  const twinsBy = new Map<string, Ref[]>(); // `oid\0branch` → remote refs
  for (const x of remotes) {
    const k = `${x.oid}\0${branchOf(x)}`;
    const list = twinsBy.get(k);
    if (list) list.push(x); else twinsBy.set(k, [x]);
  }
  const merged = new Set<string>();
  for (const r of shown) {
    if (r.kind !== 'local') continue;
    const twins = twinsBy.get(`${r.oid}\0${r.short}`) ?? [];
    for (const x of twins) merged.add(x.name);
    const isHead = r.name === refs.head.branch;
    add(r.oid, isHead ? { kind: 'head', text: r.short, ref: r, remotes: twins } : { kind: 'local', text: r.short, ref: r, remotes: twins });
  }
  if (refs.head.detached && !vis.soloActive) add(refs.head.oid, { kind: 'head', text: 'HEAD', ref: null, remotes: [] });
  for (const r of remotes) if (!merged.has(r.name)) add(r.oid, { kind: 'remote', text: r.short, ref: r });
  for (const r of shown) if (r.kind === 'tag') add(r.oid, { kind: 'tag', text: r.short, ref: r });
  if (vis.stashesVisible) for (const s of refs.stashes) add(s.oid, { kind: 'stash', text: s.selector });
  const own = refs.worktrees ? ownWorktree(refs.head, refs.worktrees) : null;
  for (const w of refs.worktrees ?? []) {
    if (w === own || w.bare || !w.head) continue;
    if (w.branch ? !vis.visible.has(w.branch) : vis.soloActive) continue;
    add(w.head, { kind: 'worktree', text: `in ${worktreeName(w, checkouts).name}`, worktree: w });
  }
  // Within a commit: HEAD first, then branches, remotes, tags, stashes, worktrees (a stable sort keeps ref order).
  const rank = { head: 0, local: 1, remote: 2, tag: 3, stash: 4, worktree: 5 } as const;
  for (const list of out.values()) list.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return out;
}
