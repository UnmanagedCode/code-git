import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { REBASE } from '../src/git/remote/integrate.js';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

// rebase.start against real git: onto a branch, N commits onto another, the stop rule, the gates and hostile config.

const read = (w, f) => fs.readFileSync(path.join(w.repo.dir, f), 'utf8');
const subjects = (w, range) => w.repo.git('log', '--format=%s', range).split('\n').filter(Boolean);
const rebases = (w) => w.argvs().filter((a) => a.includes('rebase') && !a.includes('--abort'));
const gitVersionHook = (version) => (body) => (body.argv.at(-1) === 'version'
  ? { status: 200, body: { exitCode: 0, stdout: Buffer.from(`git version ${version}\n`).toString('base64'), stderr: '', encoding: 'base64', durationMs: 1 } }
  : undefined);

/** main: base ← m1 (m.txt); topic: base ← t1 ← t2 ← t3 (t1.txt … t3.txt), checked out. */
async function world(t) {
  const w = await refsWorld(t);
  w.repo.branch('topic');
  const [t1, t2, t3] = ['t1', 't2', 't3'].map((n) => w.repo.commit({ [`${n}.txt`]: `${n}\n` }, n));
  w.repo.checkout('main');
  const m1 = w.repo.commit({ 'm.txt': 'm\n' }, 'm1');
  w.repo.checkout('topic');
  const start = (params) => w.op('rebase.start', { expect: w.oid('HEAD'), ...params });
  return { ...w, t1, t2, t3, m1, start };
}

test('params: onto, upstream and expect are full oids; ccOwned a boolean; nothing else', () => {
  const p = (raw) => getOp(OPS, 'rebase.start').params(raw);
  const oid = 'a'.repeat(40);
  for (const bad of [{ onto: 'main', upstream: oid, expect: oid }, { onto: oid, upstream: oid, expect: oid, ccOwned: 'yes' }, { onto: oid, upstream: oid, expect: oid, interactive: true }]) {
    assert.throws(() => p(bad), (e) => ['BAD_PARAMS', 'BAD_REF'].includes(e.code), JSON.stringify(bad));
  }
});

test('onto a branch: the branch\'s commits replayed on it (linear, content kept), done with the branch\'s undo; REBASE\'s pins on the command', async (t) => {
  const w = await world(t);
  const r = await w.start({ onto: w.m1, upstream: w.m1 });
  assert.equal(r.outcome, 'done');
  assert.deepEqual(subjects(w, `${w.m1}..topic`), ['t3', 't2', 't1']);
  assert.deepEqual([w.repo.git('symbolic-ref', 'HEAD'), read(w, 'm.txt'), r.oid], ['refs/heads/topic', 'm\n', w.oid('topic')]);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/topic', old: w.t3, new: r.oid }]);
  assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/topic', oid: w.t3 }, new: { branch: 'refs/heads/topic', oid: r.oid } });
  const argv = rebases(w).at(-1);
  assert.deepEqual(argv.slice(0, REBASE.length), REBASE);
  assert.ok(argv.includes(`--onto=${w.m1}`));
  endOfOptionsBefore(argv, w.m1);
  assert.equal(argv.at(-1), w.m1);
});

test('N commits onto a branch: upstream = the oldest\'s parent, so only those commits move (t1 is left out)', async (t) => {
  const w = await world(t);
  const r = await w.start({ onto: w.m1, upstream: w.t1 });
  assert.equal(r.outcome, 'done');
  assert.deepEqual(subjects(w, `${w.m1}..topic`), ['t3', 't2']);
  assert.equal(fs.existsSync(path.join(w.repo.dir, 't1.txt')), false);
});

test('upToDate when nothing would move (already on onto): HEAD unchanged, nothing in progress', async (t) => {
  const w = await world(t);
  const r = await w.start({ onto: w.base, upstream: w.base });
  assert.deepEqual([r.outcome, r.oid, w.oid('HEAD')], ['upToDate', w.t3, w.t3]);
  assert.equal((await w.op('commit.state')).operation, null);
});

test('conflicts leave the rebase in progress (commit.state reports it) with the files; head.continue finishes it', async (t) => {
  const w = await world(t);
  w.repo.checkout('main');
  const clash = w.repo.commit({ 't2.txt': 'main\n' }, 'clash');
  w.repo.checkout('topic');
  const r = await w.start({ onto: clash, upstream: clash });
  assert.deepEqual([r.outcome, r.files], ['conflicts', ['t2.txt']]);
  const s = await w.op('commit.state');
  assert.deepEqual([s.operation.kind, s.operation.rebase.branch, s.operation.rebase.step, s.operation.rebase.total], ['rebase', 'refs/heads/topic', 2, 3]);
  w.repo.write('t2.txt', 't2\n');
  w.repo.git('add', 't2.txt');
  const c = await w.op('head.continue', { which: 'rebase' });
  assert.equal(c.outcome, 'done');
  assert.deepEqual(c.undo.refs, [{ ref: 'refs/heads/topic', old: w.t3, new: w.oid('topic') }]);
});

test('HAS_MERGES (a merge commit in upstream..HEAD), DIRTY_WORKTREE (a tracked change), REF_MOVED (stale expect): nothing runs', async (t) => {
  const w = await world(t);
  await assert.rejects(w.op('rebase.start', { onto: w.m1, upstream: w.m1, expect: w.t2 }), refused('REF_MOVED'));
  w.repo.write('t1.txt', 'dirty\n');
  await assert.rejects(w.start({ onto: w.m1, upstream: w.m1 }), refused('DIRTY_WORKTREE'));
  w.repo.git('checkout', '-q', 't1.txt');
  w.repo.write('untracked.txt', 'fine\n');
  w.repo.git('merge', '-q', '--no-ff', '-m', 'merge main', 'main');
  await assert.rejects(w.start({ onto: w.m1, upstream: w.base }), refused('HAS_MERGES'));
  assert.equal(rebases(w).length, 0);
});

test('a code-conductor/* HEAD refuses CC_OWNED_BRANCH (head: true) without ccOwned and rebases with it', async (t) => {
  const w = await world(t);
  w.repo.checkout('main');
  const wt = w.worktree('wt', 'code-conductor/wt', w.t3);
  await assert.rejects(w.op('rebase.start', { onto: w.m1, upstream: w.m1, expect: w.t3 }, 'wt'), refused('CC_OWNED_BRANCH', { head: true, branches: ['code-conductor/wt'] }));
  assert.equal(rebases(w).length, 0);
  assert.equal((await w.op('rebase.start', { onto: w.m1, upstream: w.m1, expect: w.t3, ccOwned: true }, 'wt')).outcome, 'done');
  assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD~3'), w.m1);
});

test('hostile config: rebase.updateRefs=true moves no other branch, rebase.backend=apply is overridden (state in rebase-merge/)', async (t) => {
  const w = await world(t);
  w.repo.git('branch', 'pinned', w.t2);
  for (const [k, v] of [['rebase.updateRefs', 'true'], ['rebase.backend', 'apply'], ['rebase.autoStash', 'true'], ['rebase.rebaseMerges', 'true']]) w.repo.git('config', k, v);
  assert.equal((await w.start({ onto: w.m1, upstream: w.m1 })).outcome, 'done');
  assert.equal(w.oid('pinned'), w.t2, 'rebase.updateRefs moved no other branch');
  w.repo.checkout('main');
  const clash = w.repo.commit({ 't3.txt': 'main\n' }, 'clash');
  w.repo.checkout('topic');
  assert.equal((await w.start({ onto: clash, upstream: clash })).outcome, 'conflicts');
  assert.deepEqual([fs.existsSync(path.join(w.repo.dir, '.git', 'rebase-merge')), fs.existsSync(path.join(w.repo.dir, '.git', 'rebase-apply'))], [true, false]);
});

test('git below 2.26 refuses GIT_TOO_OLD before anything else runs', async (t) => {
  const w = await world(t);
  w.cc.state.execHook = gitVersionHook('2.25.4');
  await assert.rejects(w.start({ onto: w.m1, upstream: w.m1 }), refused('GIT_TOO_OLD', { feature: 'rebase', need: '2.26', have: '2.25' }));
  assert.equal(rebases(w).length, 0);
});

test('a rebase start refuses OPERATION_IN_PROGRESS while another is stopped', async (t) => {
  const w = await world(t);
  w.repo.checkout('main');
  w.repo.git('merge', '-q', '--no-commit', '-s', 'ours', 'topic');
  await assert.rejects(w.op('rebase.start', { onto: w.base, upstream: w.base, expect: w.m1 }), refused('OPERATION_IN_PROGRESS', { operation: 'merge' }));
});
