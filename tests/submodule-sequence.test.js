import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT, subWorld } from './_submodules.js';

// The merge/rebase card's reads and gates in a submodule tab: each reads the submodule's own state (its `-C` target),
// never the checkout's; and commitPointer's operation guard, which reads the same state (operationState).

const headOf = (w, dir) => w.repo.git('-C', dir, 'rev-parse', 'HEAD');

/** A stopped merge in `dir` (relative to the parent): conflict.txt differs on `side`. */
function stoppedMerge(w, dir) {
  const g = (...a) => w.fx(dir, ...a);
  const write = (c) => fs.writeFileSync(path.join(path.resolve(w.repo.dir, dir), 'conflict.txt'), c);
  write('base\n'); g('add', 'conflict.txt'); g('commit', '-qm', 'base');
  g('checkout', '-q', '-b', 'side'); write('side\n'); g('commit', '-qam', 'side');
  g('checkout', '-q', '-'); write('mine\n'); g('commit', '-qam', 'mine');
  assert.notEqual(w.git(dir, 'merge', '-q', 'side').status, 0);
  assert.ok(fs.existsSync(path.join(w.repo.git('-C', dir, 'rev-parse', '--absolute-git-dir'), 'MERGE_HEAD')));
}

test('commit.state in a submodule tab reports the submodule\'s merge and conflicts; the checkout reports none', async (t) => {
  const w = await subWorld(t, { nested: false });
  stoppedMerge(w, 'libA');
  const inSub = await w.ok('commit.state', undefined, ['libA']);
  assert.equal(inSub.operation.kind, 'merge');
  assert.equal(inSub.merging, true);
  assert.deepEqual(inSub.conflicts.map((c) => c.path), ['conflict.txt']);
  const root = await w.ok('commit.state');
  assert.deepEqual([root.operation, root.merging, root.conflicts], [null, false, []]);
});

test("commitPointer reads the op repo's own operation: a merge stopped in libA refuses libB's pointer in libA's tab; one stopped in the checkout does not", async (t) => {
  const w = await subWorld(t);
  // The checkout has a merge stopped; libA (the tab's repo) has none.
  stoppedMerge(w, '.');
  w.fx('libA/libB', 'commit', '-q', '--allow-empty', '-m', 'moved');
  const r = await w.ok('submodule.commitPointer', { path: 'libB', expect: headOf(w, 'libA/libB'), summary: 's' }, ['libA']);
  assert.equal(r.oid, headOf(w, 'libA'));
  // Now a merge stopped in libA: refused there, libA's index and HEAD untouched.
  stoppedMerge(w, 'libA');
  w.fx('libA/libB', 'commit', '-q', '--allow-empty', '-m', 'moved again');
  const index = fs.readFileSync(path.join(w.file('.git/modules/libA'), 'index'));
  const head = headOf(w, 'libA');
  const b = await w.op('submodule.commitPointer', { path: 'libB', expect: headOf(w, 'libA/libB'), summary: 's' }, ['libA']);
  assert.deepEqual([b.body.code, b.body.operation], ['OPERATION_IN_PROGRESS', 'merge']);
  assert.deepEqual(fs.readFileSync(path.join(w.file('.git/modules/libA'), 'index')), index);
  assert.equal(headOf(w, 'libA'), head);
});

test('commitPointer in a cc worktree reads that worktree\'s operation, not the main checkout\'s', async (t) => {
  const w = await subWorld(t, { nested: false });
  const wt = w.repo.worktreeAdd(path.join(w.root, 'wt'), 'wtb');
  w.fx(wt.dir, 'submodule', 'update', '-q', '--init');
  w.cc.state.projects[PROJECT].worktrees = { wt: wt.dir };
  stoppedMerge(w, wt.dir);
  w.fx(path.join(wt.dir, 'libA'), 'commit', '-q', '--allow-empty', '-m', 'moved in wt');
  const expect = wt.git('-C', 'libA', 'rev-parse', 'HEAD');
  const call = (worktree, e) => w.app.call('POST', '/api/ops/submodule.commitPointer', { target: { project: PROJECT, ...(worktree ? { worktree } : {}) }, params: { path: 'libA', expect: e, summary: 's' } });
  const r = await call('wt', expect);
  assert.deepEqual([r.status, r.body.code, r.body.operation], [409, 'OPERATION_IN_PROGRESS', 'merge']);
  // The main checkout has no operation: its own pointer commit goes through.
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved in main');
  assert.equal((await call(null, headOf(w, 'libA'))).status, 200);
});

test('commitPointer: unrelated unmerged entries with no operation (a squash merge) do not refuse; the pointer\'s own conflict does', async (t) => {
  const w = await subWorld(t, { nested: false });
  const g = (...a) => w.repo.git(...a);
  w.repo.commit({ 'conflict.txt': 'base\n' }, 'base');
  w.repo.branch('side'); w.repo.commit({ 'conflict.txt': 'side\n' }, 'side'); w.repo.checkout('main');
  w.repo.commit({ 'conflict.txt': 'mine\n' }, 'mine');
  assert.notEqual(w.git('.', 'merge', '--squash', 'side').status, 0);
  assert.equal(fs.existsSync(w.file('.git/MERGE_HEAD')), false, 'a squash merge leaves no operation');
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved');
  await w.ok('submodule.commitPointer', { path: 'libA', expect: headOf(w, 'libA'), summary: 'pointer only' });
  assert.equal(g('show', '--format=', '--name-only', 'HEAD'), 'libA');
  assert.match(g('ls-files', '-u'), /conflict\.txt/, 'the unrelated conflict is left as it was');
  // The gitlink itself in conflict (stages 1-3): refused, its stages kept.
  const head = headOf(w, 'libA');
  g('update-index', '--force-remove', 'libA');
  execFileSync('git', ['-C', w.repo.dir, 'update-index', '--index-info'], { input: [1, 2, 3].map((n) => `160000 ${head} ${n}\tlibA\n`).join(''), env: w.env });
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved again');
  const b = await w.op('submodule.commitPointer', { path: 'libA', expect: headOf(w, 'libA'), summary: 's' });
  assert.deepEqual([b.body.code, b.body.paths], ['SUBMODULE_CONFLICTED', ['libA']]);
  assert.equal(g('ls-files', '-u', '--', 'libA').split('\n').length, 3);
});

test('remote.pull in a submodule tab fast-forwards the submodule, and its operation gate reads the submodule: a merge stopped in the checkout does not block it', async (t) => {
  const w = await subWorld(t, { nested: false });
  stoppedMerge(w, '.');
  const next = w.advance('libA', { 'a.txt': 'upstream\n' });
  const r = await w.op('remote.pull', { mode: 'ffOnly' }, ['libA']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(headOf(w, 'libA'), next);
  // A merge stopped in libA: its own pull refuses there.
  stoppedMerge(w, 'libA');
  const b = await w.op('remote.pull', { mode: 'ffOnly' }, ['libA']);
  assert.deepEqual([b.body.code, b.body.operation], ['OPERATION_IN_PROGRESS', 'merge']);
});

test('merge.start in a submodule tab merges in the submodule, and a stopped merge there shows in its commit.state only', async (t) => {
  const w = await subWorld(t, { nested: false });
  const g = (...a) => w.fx('libA', ...a);
  const write = (c) => fs.writeFileSync(w.file('libA/conflict.txt'), c);
  write('base\n'); g('add', 'conflict.txt'); g('commit', '-qm', 'base');
  g('checkout', '-q', '-b', 'side'); write('side\n'); g('commit', '-qam', 'side');
  g('checkout', '-q', '-'); write('mine\n'); g('commit', '-qam', 'mine');
  const parentHead = w.repo.git('rev-parse', 'HEAD');
  const r = await w.ok('merge.start', { ref: 'refs/heads/side', oid: w.repo.git('-C', 'libA', 'rev-parse', 'side'), mode: 'noFf', expect: headOf(w, 'libA') }, ['libA']);
  assert.equal(r.outcome, 'conflicts');
  assert.ok(fs.existsSync(path.join(w.file('.git/modules/libA'), 'MERGE_HEAD')));
  assert.equal(fs.existsSync(w.file('.git/MERGE_HEAD')), false);
  assert.equal(w.repo.git('rev-parse', 'HEAD'), parentHead);
  assert.equal((await w.ok('commit.state', undefined, ['libA'])).operation.kind, 'merge');
  assert.equal((await w.ok('commit.state')).operation, null);
});
