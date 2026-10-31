import { toast } from 'sonner';
import { clip } from '@/lib/clip';
import { listRepos, listWorktrees, type Repo, type Worktree } from '@/lib/endpoints';
import type { MenuTarget } from '@/lib/route';
import { dispatchTabs } from '@/state/tabs';
import { commitRepos, disabledReason } from '@/state/useRepos';

// Opens the checkout a code-conductor row ⋮ item names (lib/route.ts → consumeMenuTarget). The names are untrusted:
// each is checked against a fresh cc listing, and the tab is built from the listing's own strings only, never with `sub`.
// App's effect cleanup must not cancel a pending target: under StrictMode the first mount consumes the keys, and the
// second finds nothing to restart (as with cancelLink).

export type Resolved<K extends string> = ({ ok: true } & Record<K, string>) | { ok: false; message: string };

/** The listed project `t` names, refused when unnamed, unlisted, or one the picker disables. */
export function resolveMenuProject(repos: Repo[], t: MenuTarget): Resolved<'project'> {
  if (t.project === null) return { ok: false, message: "Can't open a repository: code-conductor named no project." };
  const repo = repos.find((r) => r.project === t.project);
  if (!repo) return { ok: false, message: `Can't open a repository: code-conductor lists no project “${t.project}”.` };
  const reason = disabledReason(repo);
  if (reason) return { ok: false, message: `Can't open “${repo.project}”: ${reason}` };
  return { ok: true, project: repo.project };
}

/** The listed worktree `name` of `project`, refused when unlisted. */
export function resolveMenuWorktree(project: string, worktrees: Worktree[], name: string): Resolved<'worktree'> {
  const row = worktrees.find((w) => w.worktreeName === name);
  if (!row) return { ok: false, message: `Can't open a repository: project “${project}” has no worktree “${name}”.` };
  return { ok: true, worktree: row.worktreeName };
}

/** The latest target's number; a response for an older one is dropped. */
let latest = 0;

/** Supersedes a pending target (a Back/Forward to a tab route). */
export function cancelMenuTarget(): void {
  latest++;
}

const refuse = (message: string): void => { toast.error(clip(message)); };

/** Checks `t` against fresh listings and opens (or activates) its checkout's tab; a refusal is one error toast. Never throws. */
export async function openMenuTarget(t: MenuTarget): Promise<void> {
  const seq = ++latest;
  try {
    const repos = await listRepos();
    if (seq !== latest) return;
    commitRepos(repos);
    const p = resolveMenuProject(repos, t);
    if (!p.ok) return refuse(p.message);
    let worktree: string | null = null;
    if (t.worktree !== null) {
      const wts = await listWorktrees(p.project);
      if (seq !== latest) return;
      const w = resolveMenuWorktree(p.project, wts, t.worktree);
      if (!w.ok) return refuse(w.message);
      worktree = w.worktree;
    }
    dispatchTabs({ type: 'open', tab: { project: p.project, worktree } });
  } catch (e) {
    if (seq === latest) refuse(`Can't open a repository: ${e instanceof Error ? e.message : String(e)}`);
  }
}
