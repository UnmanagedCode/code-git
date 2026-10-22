import { projects, worktrees } from '../conductor/cc.js';
import { assertTarget } from '../git/validate.js';
import { route } from '../http/route.js';

// The picker's data: every cc project (none filtered out; the UI disables what it cannot open) and a project's worktrees.

/** One picker row from a cc project row. `isGitRepo` is absent when cc could not look; the reason fields say why. */
export function toRepo(p) {
  return {
    project: p.name,
    path: p.path,
    workspace: p.workspace ?? null,
    system: p.system ?? 'local',
    remoteId: p.remoteId ?? null,
    ...(typeof p.isGitRepo === 'boolean' ? { isGitRepo: p.isGitRepo } : {}),
    unbornHead: p.unbornHead === true,
    systemUnreachable: p.systemUnreachable ?? null,
    gitRefusal: p.gitRefusal ?? null,
    degraded: p.degraded ?? null,
  };
}

/** One worktree row; `locked` is cc's user lock (absent in cc's row = unlocked). */
export const toWorktree = (w) => ({ worktreeName: w.worktreeName, branch: w.branch ?? null, baseBranch: w.baseBranch ?? null, locked: w.locked === true });

export function mount(router) {
  router.get('/repos', route(async (_req, res) => {
    res.json({ repos: (await projects()).map(toRepo) });
  }));
  router.get('/repos/:project/worktrees', route(async (req, res) => {
    const { project } = assertTarget({ project: req.params.project });
    res.json({ worktrees: (await worktrees(project)).map(toWorktree) });
  }));
}
