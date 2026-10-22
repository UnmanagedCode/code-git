import type { Target } from './endpoints';

// The active tab lives in the query string (`?project=…&worktree=…`), never in the hash: the bridge turns
// pushState into replaceState, so the plugin adds one history entry to cc's.

export function readRoute(search = location.search): Target | null {
  const q = new URLSearchParams(search);
  const project = q.get('project');
  if (!project) return null;
  return { project, worktree: q.get('worktree') || null };
}

export function routeSearch(t: Target | null): string {
  if (!t) return '';
  const q = new URLSearchParams({ project: t.project });
  if (t.worktree) q.set('worktree', t.worktree);
  return `?${q}`;
}

/** Mirrors `t` into the URL when it differs from what is there. */
export function writeRoute(t: Target | null): void {
  const search = routeSearch(t);
  if (search === location.search) return;
  history.pushState(null, '', search || location.pathname);
}
