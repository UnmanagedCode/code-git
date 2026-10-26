import type { Checkout, CommitItem, GitWorktree, Ref, RefsResult, Stash } from '@/features/graph/types';

// Builders for graph test data (test-only).

export const oid = (n: number | string): string => String(n).padStart(40, '0').slice(-40);
export const commit = (id: string, parents: string[] = [], over: Partial<CommitItem> = {}): CommitItem => ({
  oid: id, parents, author: { name: 'Ann Example', email: 'ann@x.org' }, time: 1_700_000_000, committerTime: 1_700_000_000, subject: `subject ${id.slice(-4)}`, ...over,
});
export const ref = (name: string, at: string | null, over: Partial<Ref> = {}): Ref => {
  const kind = name.startsWith('refs/heads/') ? 'local' : name.startsWith('refs/remotes/') ? 'remote' : 'tag';
  const short = name.replace(/^refs\/(heads|remotes|tags)\//, '');
  return { name, kind, short, remote: kind === 'remote' ? short.split('/')[0] : null, oid: at, isHead: false, ...over };
};
export const stash = (at: string, base: string, n = 0): Stash => ({ oid: at, parents: [base], selector: `stash@{${n}}`, time: 1, subject: `WIP ${n}` });
export const worktree = (path: string, head: string | null, branch: string | null, over: Partial<GitWorktree> = {}): GitWorktree => ({
  path, head, branch, detached: branch === null, bare: false, locked: false, ...over,
});
export const refsResult = (over: Partial<RefsResult> = {}): RefsResult => ({
  head: { oid: null, branch: 'refs/heads/main', detached: false, unborn: false }, refs: [], stashes: [], worktrees: [], worktreesError: null, ...over,
});
export const checkout = (worktree: string | null, over: Partial<Checkout> = {}): Checkout => ({
  target: { project: 'app', worktree }, name: worktree ?? 'app', isOwn: worktree === null, branch: null, headOid: null,
  counts: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 }, ...over,
});
