import assert from 'node:assert/strict';
import path from 'node:path';
import { getOp, OPS } from '../src/git/ops/index.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { bareRemote, makeRepo } from './_git.js';

// The world the branch / tag / HEAD op tests share: a repo with one commit on `main`, a bare `origin` holding it,
// the fake cc serving the repo as project `repo`, and `op(name, params, worktree?)` running an op as routes/ops.js does.

export async function refsWorld(t) {
  const repo = makeRepo(t);
  const base = repo.commit({ 'f.txt': 'base\n' }, 'base');
  const origin = bareRemote(repo);
  repo.git('push', '-q', '-u', 'origin', 'main');
  const project = { dir: repo.dir, worktrees: {} };
  const cc = await fakeCc({ projects: { repo: project }, home: repo.home });
  t.after(async () => {
    const v = cc.state.violations;
    await cc.close();
    assert.deepEqual(v, [], 'exec form A only, never a shell');
  });
  /** Runs op `name` in the main checkout or cc worktree `worktree`; params pass the op's own check first. */
  const op = async (name, params, worktree = null) => {
    const def = getOp(OPS, name);
    const target = { project: 'repo', worktree };
    const ctx = ctxFor(target, def.kind, { op: name, cancellable: def.cancellable });
    return def.run(gitFor(ctx), def.params(params), { target });
  };
  /** A git worktree beside the repo on a new branch `branch`, registered with the fake cc as worktree `name`. */
  const worktree = (name, branch, from = 'HEAD') => {
    const wt = repo.worktreeAdd(path.join(repo.root, name), branch, from);
    project.worktrees[name] = wt.dir;
    return wt;
  };
  /** Every exec's argv after `git` and BASE_ARGS, in order. */
  const argvs = () => cc.state.execCalls.map((b) => b.argv.slice(1 + BASE_ARGS.length));
  /** Subcommands that change refs, the index or the worktree, from the exec log. */
  const writes = () => argvs().filter((a) => WRITE_SUBCOMMANDS.has(a[0]));
  const oid = (rev, dir = repo.dir) => repo.git('-C', dir, 'rev-parse', rev);
  const exists = (ref) => { try { repo.git('rev-parse', '--verify', '-q', ref); return true; } catch { return false; } };
  return { repo, origin, base, cc, op, worktree, argvs, writes, oid, exists };
}

const WRITE_SUBCOMMANDS = new Set(['switch', 'checkout', 'branch', 'update-ref', 'merge', 'reset', 'stash', 'tag', 'push', 'revert', 'cherry-pick']);

export const refused = (code, extra = {}) => (e) => {
  assert.equal(e.code, code, e.message);
  for (const [k, v] of Object.entries(extra)) assert.deepEqual(e.extra[k], v, k);
  return true;
};

/** `--end-of-options` comes before `value` in `argv`. */
export const endOfOptionsBefore = (argv, value) => {
  const i = argv.indexOf('--end-of-options');
  assert.ok(i !== -1 && i < argv.lastIndexOf(value), `--end-of-options before ${value} in ${argv.join(' ')}`);
};
