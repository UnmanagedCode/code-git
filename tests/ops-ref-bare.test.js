import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { ctxFor, gitFor } from './_ctx.js';
import { hermeticEnv } from './_git.js';
import { refsWorld, refused } from './_refsWorld.js';

// The ref ops that write the working tree or the index refuse a bare repository (assertWorktree, src/git/worktree.js):
// under BASE_ARGS' --work-tree=. git would treat its HEAD, config and objects/ as a working tree.

test('checkout, create+checkout, mixed and hard reset, revert, cherry-pick, abort and the own fast-forward refuse a bare repo; nothing in it changes', async (t) => {
  const w = await refsWorld(t);
  // The world's bare origin, registered with the fake cc as a project of its own: main at base, `other` one commit ahead.
  w.repo.git('checkout', '-q', '-b', 'other');
  const other = w.repo.commit({ 'o.txt': 'o\n' }, 'other');
  w.repo.git('push', '-q', 'origin', 'other');
  w.cc.state.projects.bare = { dir: w.origin.dir };
  const target = { project: 'bare', worktree: null };
  const op = (name, params) => {
    const def = getOp(OPS, name);
    return def.run(gitFor(ctxFor(target, def.kind, { op: name })), def.params(params), { target });
  };
  const env = hermeticEnv(w.repo.home);
  const snapshot = () => ({
    HEAD: fs.readFileSync(path.join(w.origin.dir, 'HEAD'), 'utf8'),
    entries: fs.readdirSync(w.origin.dir).sort(),
    refs: execFileSync('git', ['-C', w.origin.dir, 'for-each-ref'], { env }).toString(),
  });
  const before = snapshot();
  assert.equal(before.entries.includes('index'), false);
  const guarded = [
    ['branch.checkout', { ref: 'refs/heads/other' }],
    ['branch.create', { name: 'made', checkout: true }],
    ['head.reset', { to: w.base, mode: 'mixed', expect: other }],
    ['head.reset', { to: w.base, mode: 'hard', expect: other }],
    ['head.revert', { oid: other }],
    ['head.cherryPick', { oid: other }],
    ['head.abort', { which: 'cherry-pick' }],
    ['branch.fastForward', { name: 'main', to: other, expect: w.base }],
  ];
  for (const [name, params] of guarded) await assert.rejects(op(name, params), refused('BARE_REPO'), `${name} ${params.mode ?? ''}`);
  assert.deepEqual(snapshot(), before);
  // Only the bare check ran in it: no checkout, reset, stash, merge, revert or cherry-pick.
  const ran = w.cc.state.execCalls.filter((b) => b.project === 'bare').map((b) => b.argv.slice(1 + BASE_ARGS.length));
  assert.ok(ran.length >= guarded.length);
  for (const a of ran) assert.ok(!['switch', 'checkout', 'reset', 'stash', 'merge', 'revert', 'cherry-pick', 'branch', 'update-ref'].includes(a[0]), a.join(' '));
});
