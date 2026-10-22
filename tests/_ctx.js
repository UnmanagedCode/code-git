import { createActivityLog } from '../src/activity/log.js';
import { createLocks } from '../src/git/locks.js';
import { runGit } from '../src/git/runner.js';

/** A runner context as routes/ops.js builds one, with its own activity log and locks unless given. */
export function ctxFor(target, kind = 'read', over = {}) {
  return {
    target: { project: target.project, worktree: target.worktree ?? null }, op: 'test.op', kind, cancellable: kind === 'read',
    signal: undefined, opRunId: 'run-t', activity: createActivityLog(), locks: createLocks(), ...over,
  };
}

/** `git(args, opts)` bound to `ctx`, as an op's run() receives it. */
export const gitFor = (ctx) => (args, opts) => runGit(ctx, args, opts);
