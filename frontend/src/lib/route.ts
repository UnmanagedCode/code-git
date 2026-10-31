import type { Target } from './endpoints';

// The active tab lives in the query string (`?project=…&worktree=…&sub=…&sub=…`, one `sub` per chain entry), never in the hash: the bridge turns
// pushState into replaceState, so the plugin adds one history entry to cc's.

export function readRoute(search = location.search): Target | null {
  const q = new URLSearchParams(search);
  const project = q.get('project');
  if (!project) return null;
  const sub = q.getAll('sub').filter(Boolean);
  return { project, worktree: q.get('worktree') || null, ...(sub.length ? { sub } : {}) };
}

export function routeSearch(t: Target | null): string {
  if (!t) return '';
  const q = new URLSearchParams({ project: t.project });
  if (t.worktree) q.set('worktree', t.worktree);
  for (const s of t.sub ?? []) q.append('sub', s);
  return `?${q}`;
}

/** Mirrors `t` into the URL when it differs from what is there. */
export function writeRoute(t: Target | null): void {
  const search = routeSearch(t);
  if (search === location.search) return;
  history.pushState(null, '', search || location.pathname);
}

// A link from another plugin (code-review) adds `commit=<full oid>` and optionally `path=<repo path>` to the tab's
// query. The keys are one-shot: consumeLink strips them with replaceState on arrival (docs/protocol.md → UI routes).

export interface LinkIntent { commit: string; path?: string }

// The backend's OID_RE (src/git/validate.js), which the frontend cannot import.
const FULL_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** assertPath's rules (src/git/validate.js); the backend re-validates the path when the history is read. */
const validPath = (p: string): boolean =>
  p !== '' && p.length <= 4096 && !p.includes('\0') && !p.includes('\\') && !p.startsWith('/') && !p.split('/').includes('..');

/** The link in `search`: null without a project or a valid `commit`; an invalid `path` is dropped. Never throws. */
export function readLink(search = location.search): LinkIntent | null {
  const q = new URLSearchParams(search);
  const commit = q.get('commit');
  if (!q.get('project') || !commit || !FULL_OID_RE.test(commit)) return null;
  const path = q.get('path');
  return path !== null && validPath(path) ? { commit, path } : { commit };
}

/** Reads the URL's link and strips its keys (valid or not) with replaceState, so no history entry keeps them. */
export function consumeLink(): LinkIntent | null {
  const link = readLink();
  const q = new URLSearchParams(location.search);
  if (q.has('commit') || q.has('path')) history.replaceState(null, '', routeSearch(readRoute()) || location.pathname);
  return link;
}

// code-conductor's row ⋮ items (manifest `menuItems`) add `ccProject` and, for a worktree row, `ccWorktree`; cc owns the
// names (cc docs/plugins.md → `menuItems`). They are one-shot like the link keys, and untrusted: features/links/menu.ts
// checks them against cc's listing before anything is built from them.

const MENU_KEYS = { project: 'ccProject', worktree: 'ccWorktree' };

export interface MenuTarget { project: string | null; worktree: string | null }

/** The cc row target in `search`: null when neither key is there; an empty value counts as absent. */
export function readMenuTarget(search = location.search): MenuTarget | null {
  const q = new URLSearchParams(search);
  if (!q.has(MENU_KEYS.project) && !q.has(MENU_KEYS.worktree)) return null;
  return { project: q.get(MENU_KEYS.project) || null, worktree: q.get(MENU_KEYS.worktree) || null };
}

/**
 * Reads the URL's cc row target and, when there is one, replaces the whole URL with `active`'s route before anything
 * validates it, so a reload or Back never repeats the click. Any other key beside cc's goes with it.
 */
export function consumeMenuTarget(active: Target | null): MenuTarget | null {
  const t = readMenuTarget();
  if (t) history.replaceState(null, '', routeSearch(active) || location.pathname);
  return t;
}
