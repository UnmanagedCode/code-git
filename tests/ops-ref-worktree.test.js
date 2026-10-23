import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { ctxFor, gitFor } from './_ctx.js';
import { hermeticEnv } from './_git.js';
import { ELSEWHERE_FILES, elsewhereSnapshot, hostile } from './_ops.js';
import { refsWorld, refused } from './_refsWorld.js';

// The ref ops under BASE_ARGS' --work-tree=.: they change only the checkout whatever core.worktree says, and the ones
// that write the working tree or the index refuse a bare repository (assertWorktree, src/git/worktree.js), whose HEAD,
// config and objects/ would otherwise be treated as a working tree.

/** The refs world's bare origin registered with the fake cc as project `bare`: main at base, `other` one commit ahead. */
async function bareWorld(t) {
  const w = await refsWorld(t);
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
  const files = () => ({ HEAD: fs.readFileSync(path.join(w.origin.dir, 'HEAD'), 'utf8'), entries: fs.readdirSync(w.origin.dir).sort() });
  const refs = () => execFileSync('git', ['-C', w.origin.dir, 'for-each-ref'], { env }).toString();
  const snapshot = () => ({ ...files(), refs: refs() });
  return { w, other, op, files, snapshot, bareOid: (ref) => execFileSync('git', ['-C', w.origin.dir, 'rev-parse', ref], { env }).toString().trim() };
}

test('checkout, create+checkout, mixed and hard reset, revert, cherry-pick, abort and the own fast-forward refuse a bare repo; nothing in it changes', async (t) => {
  const { w, other, op, snapshot } = await bareWorld(t);
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
    ['head.abort', { which: 'merge' }],
    ['remote.pull', { mode: 'ff' }],
    ['remote.pull', { mode: 'rebase' }],
  ];
  for (const [name, params] of guarded) await assert.rejects(op(name, params), refused('BARE_REPO'), `${name} ${params.mode ?? ''}`);
  assert.deepEqual(snapshot(), before);
  // Only the bare check ran in it: no checkout, reset, stash, merge, revert or cherry-pick.
  const ran = w.cc.state.execCalls.filter((b) => b.project === 'bare').map((b) => b.argv.slice(1 + BASE_ARGS.length));
  assert.ok(ran.length >= guarded.length);
  for (const a of ran) assert.ok(!['switch', 'checkout', 'reset', 'stash', 'merge', 'revert', 'cherry-pick', 'branch', 'update-ref', 'fetch', 'rebase'].some((x) => a.includes(x)), a.join(' '));
});

test('core.worktree pointing elsewhere: checkout, reset --hard with its stash create snapshot, and cherry-pick change only the checkout', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '-b', 'side');
  const side = w.repo.commit({ 'f.txt': 'side\n', 's.txt': 's\n' }, 'side');
  w.repo.git('checkout', '-q', 'main');
  const pick = w.repo.commit({ 'p.txt': 'p\n' }, 'to pick');
  w.repo.git('reset', '-q', '--hard', w.base);
  hostile(w.repo);
  const read = (rel) => fs.readFileSync(path.join(w.repo.dir, rel), 'utf8');

  await w.op('branch.checkout', { ref: 'refs/heads/side' });
  assert.equal(read('f.txt'), 'side\n');
  assert.equal(read('s.txt'), 's\n');
  w.repo.write('f.txt', 'dirty\n');
  const r = await w.op('head.reset', { to: w.base, mode: 'hard', expect: side });
  assert.equal(read('f.txt'), 'base\n');
  assert.equal(fs.existsSync(path.join(w.repo.dir, 's.txt')), false);
  assert.match(r.undo.worktreeSnapshot, /^[0-9a-f]{40}$/);
  assert.equal(w.repo.git('show', `${r.undo.worktreeSnapshot}:f.txt`), 'dirty');
  const c = await w.op('head.cherryPick', { oid: pick });
  assert.equal(c.conflicts, false);
  assert.equal(read('p.txt'), 'p\n');
  assert.deepEqual(elsewhereSnapshot(w.repo), ELSEWHERE_FILES);
});

/**
 * A ref move in a bare repo writes only git's own ref metadata: under --work-tree=. git treats it as non-bare, so
 * core.logAllRefUpdates defaults on (`logs/`) and a reset records `ORIG_HEAD`. HEAD's file is unchanged, and no index
 * and no file of a commit (`f.txt`, `o.txt`) appears.
 */
function onlyRefMetadataAdded(before, after) {
  assert.equal(after.HEAD, before.HEAD);
  const added = after.entries.filter((e) => !before.entries.includes(e));
  assert.deepEqual(added.filter((e) => e !== 'logs' && e !== 'ORIG_HEAD'), [], `only ref metadata added: ${added}`);
  assert.deepEqual(before.entries.filter((e) => !after.entries.includes(e)), [], 'nothing removed');
}

test('a soft reset in a bare repo is a ref move: it runs (no BARE_REPO) and moves HEAD\'s branch, writing only ref metadata', async (t) => {
  const { w, other, op, files, bareOid } = await bareWorld(t);
  const before = files();
  const r = await op('head.reset', { to: other, mode: 'soft', expect: w.base });
  assert.equal(bareOid('refs/heads/main'), other);
  assert.equal(r.undo.worktreeSnapshot, null);
  onlyRefMetadataAdded(before, files());
});

test('fast-forwarding a branch that is not HEAD in a bare repo is a ref update: it runs (no BARE_REPO), the ref moves, only ref metadata is written', async (t) => {
  const { w, other, op, files, bareOid } = await bareWorld(t);
  execFileSync('git', ['-C', w.origin.dir, 'branch', 'free', w.base], { env: hermeticEnv(w.repo.home) });
  const before = files();
  const r = await op('branch.fastForward', { name: 'free', to: other, expect: w.base });
  assert.equal(r.upToDate, false);
  assert.equal(bareOid('refs/heads/free'), other);
  assert.equal(bareOid('refs/heads/main'), w.base);
  onlyRefMetadataAdded(before, files());
});
