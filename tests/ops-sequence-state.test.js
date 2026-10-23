import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { hermeticEnv } from './_git.js';
import { refsWorld } from './_refsWorld.js';

// commit.state's operation and conflicts (src/git/sequence/state.js): what is in progress, read from git's own files.

/** main: base ← main change (f.txt "main"); topic: base ← topic change (f.txt "topic"), two more commits. */
async function world(t) {
  const w = await refsWorld(t);
  w.repo.branch('topic');
  const topic = w.repo.commit({ 'f.txt': 'topic\n' }, 'topic change');
  const t2 = w.repo.commit({ 't2.txt': 't2\n' }, 't2');
  const t3 = w.repo.commit({ 't3.txt': 't3\n' }, 't3');
  w.repo.checkout('main');
  const main = w.repo.commit({ 'f.txt': 'main\n' }, 'main change');
  /** git run as the user would, exit code not checked (a conflict exits 1). */
  const user = (...args) => spawnSync('git', ['-C', w.repo.dir, ...args], { env: { ...hermeticEnv(w.repo.home), GIT_EDITOR: 'false' }, encoding: 'utf8' });
  const state = () => w.op('commit.state');
  return { ...w, topic, t2, t3, main, user, state };
}

const bothModified = (p) => ({ path: p, kind: 'bothModified' });
const shape = (conflicts) => conflicts.map((c) => ({ path: c.path, kind: c.kind }));

test('nothing in progress: operation null, conflicts [], merging false — in three commands', async (t) => {
  const w = await world(t);
  const before = w.argvs().length;
  assert.deepEqual(await w.state(), { merging: false, operation: null, conflicts: [] });
  assert.equal(w.argvs().length - before, 3);
});

test('a merge stopped on conflicts: kind merge, the incoming commit and its subject, the conflicted file with its stages', async (t) => {
  const w = await world(t);
  w.user('merge', 'topic');
  const s = await w.state();
  assert.deepEqual(s.operation, { kind: 'merge', incoming: { oid: w.t3, subject: 't3' }, rebase: null });
  assert.equal(s.merging, true);
  assert.deepEqual(shape(s.conflicts), [bothModified('f.txt')]);
  const [c] = s.conflicts;
  assert.deepEqual([c.base.oid, c.ours.oid, c.theirs.oid], [w.oid(`${w.base}:f.txt`), w.oid(`${w.main}:f.txt`), w.oid(`${w.topic}:f.txt`)]);
  assert.equal(c.ours.mode, '100644');
});

test('a rebase stopped on conflicts: kind rebase, its branch, onto, step and total, and the commit being replayed', async (t) => {
  const w = await world(t);
  w.repo.checkout('topic');
  w.user('-c', 'rebase.backend=merge', 'rebase', 'main');
  const s = await w.state();
  assert.deepEqual(s.operation, {
    kind: 'rebase', incoming: { oid: w.topic, subject: 'topic change' }, rebase: { branch: 'refs/heads/topic', onto: w.main, step: 1, total: 3 },
  });
  assert.equal(s.merging, false);
  assert.deepEqual(shape(s.conflicts), [bothModified('f.txt')]);
});

test('an apply-backend rebase (rebase-apply/ with rebasing) is a rebase too, its counts from next/last; git am\'s rebase-apply/ is not', async (t) => {
  const w = await world(t);
  w.repo.checkout('topic');
  w.user('-c', 'rebase.backend=apply', 'rebase', 'main');
  const s = await w.state();
  assert.equal(s.operation.kind, 'rebase');
  assert.deepEqual(s.operation.rebase, { branch: 'refs/heads/topic', onto: w.main, step: 1, total: 3 });
  w.user('rebase', '--abort');
  // git am: rebase-apply/ without `rebasing`, HEAD detached.
  w.repo.git('checkout', '-q', '--detach');
  fs.mkdirSync(path.join(w.repo.dir, '.git', 'rebase-apply'));
  fs.writeFileSync(path.join(w.repo.dir, '.git', 'rebase-apply', 'applying'), '');
  assert.equal((await w.state()).operation, null);
});

test('cherry-pick and revert stopped on conflicts report their kind and incoming commit', async (t) => {
  const w = await world(t);
  w.user('cherry-pick', w.topic);
  assert.deepEqual((await w.state()).operation, { kind: 'cherry-pick', incoming: { oid: w.topic, subject: 'topic change' }, rebase: null });
  w.user('cherry-pick', '--abort');
  w.repo.commit({ 'f.txt': 'later\n' }, 'later');
  w.user('revert', '--no-edit', w.main);
  assert.deepEqual((await w.state()).operation, { kind: 'revert', incoming: { oid: w.main, subject: 'main change' }, rebase: null });
});

test('the same answer from a fresh backend (a reload): nothing about the operation lives in code-git', async (t) => {
  const w = await world(t);
  w.repo.checkout('topic');
  w.user('-c', 'rebase.backend=merge', 'rebase', 'main');
  const first = await w.state();
  const cc = await fakeCc({ projects: { again: { dir: w.repo.dir } }, home: w.repo.home });
  try {
    const def = getOp(OPS, 'commit.state');
    const target = { project: 'again', worktree: null };
    const again = await def.run(gitFor(ctxFor(target, 'read', { op: 'commit.state' })), def.params(undefined), { target });
    assert.deepEqual(again, first);
  } finally {
    await cc.close();
  }
});

test('conflicts with nothing in progress (a squash merge): operation null, the conflicts listed', async (t) => {
  const w = await world(t);
  w.user('merge', '--squash', 'topic');
  const s = await w.state();
  assert.deepEqual([s.operation, s.merging, shape(s.conflicts)], [null, false, [bothModified('f.txt')]]);
});

test('hostile rebase state files are ignored, never trusted: a non-oid onto, a head-name outside refs/heads and a non-integer count become null', async (t) => {
  const w = await world(t);
  w.repo.checkout('topic');
  w.user('-c', 'rebase.backend=merge', 'rebase', 'main');
  const dir = path.join(w.repo.dir, '.git', 'rebase-merge');
  fs.writeFileSync(path.join(dir, 'onto'), '--output=/tmp/x\n');
  fs.writeFileSync(path.join(dir, 'head-name'), 'refs/tags/v1\n');
  fs.writeFileSync(path.join(dir, 'msgnum'), '1e9\n');
  fs.writeFileSync(path.join(dir, 'end'), 'x'.repeat(5000));
  assert.deepEqual((await w.state()).operation.rebase, { branch: null, onto: null, step: null, total: null });
  fs.writeFileSync(path.join(dir, 'head-name'), 'refs/heads/a..b\n');
  assert.equal((await w.state()).operation.rebase.branch, null);
});
