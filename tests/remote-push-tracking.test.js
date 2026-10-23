import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refsWorld, refused } from './_refsWorld.js';

// A push updates (a delete push deletes) the local ref the remote's fetch refspecs map each pushed destination to —
// branches and tags alike (verified with git 2.55). A hostile refspec mapping into refs/heads would move or delete a
// local branch past every guard, so every push refuses a mapped ref outside refs/remotes/ before anything runs.

const onOrigin = (w, ref) => { try { return w.origin.git('rev-parse', '--verify', '-q', ref); } catch { return null; } };
const pushed = (w) => w.argvs().some((a) => a[0] === 'push');
const refspec = (w, ...list) => {
  w.repo.git('config', '--unset-all', 'remote.origin.fetch');
  for (const s of list) w.repo.git('config', '--add', 'remote.origin.fetch', s);
};

test('the fixture is live: plain git pushing main under +refs/heads/main:refs/heads/victim moves victim', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'victim');
  const tip = w.repo.commit({ 'x.txt': 'x\n' }, 'x');
  refspec(w, '+refs/heads/main:refs/heads/victim');
  w.repo.git('push', '-q', 'origin', 'main');
  assert.equal(w.oid('victim'), tip);
});

test('remote.push: a mapping onto the checked-out cc branch → REMOTE_CONFIG_UNSUPPORTED, no push, the branch and its worktree intact', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  w.repo.commit({ 'x.txt': 'x\n' }, 'x');
  const bad = '+refs/heads/main:refs/heads/code-conductor/wt';
  refspec(w, '+refs/heads/*:refs/remotes/origin/*', bad);
  await assert.rejects(w.op('remote.push', { branch: 'main' }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin', refspec: bad }));
  assert.equal(pushed(w), false);
  assert.equal(w.oid('refs/heads/code-conductor/wt'), w.base);
  assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD'), w.base);
  assert.equal(onOrigin(w, 'refs/heads/main'), w.base, 'nothing reached the remote');
});

test('remote.push: a mapping onto a branch checked out in another (non-cc) worktree is refused the same way', async (t) => {
  const w = await refsWorld(t);
  const other = w.worktree('other', 'busy');
  w.repo.git('checkout', '-q', '-b', 'feat');
  w.repo.commit({ 'f.txt': 'f\n' }, 'f');
  refspec(w, '+refs/heads/feat:refs/heads/busy');
  await assert.rejects(w.op('remote.push', { branch: 'feat', remote: 'origin' }), refused('REMOTE_CONFIG_UNSUPPORTED', { refspec: '+refs/heads/feat:refs/heads/busy' }));
  assert.equal(pushed(w), false);
  assert.equal(w.repo.git('-C', other.dir, 'rev-parse', 'HEAD'), w.base);
});

test('branch.deleteRemote: a mapping onto a local branch would delete it → refused, the branch and the remote branch stay', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('push', '-q', 'origin', 'main:doomed');
  w.repo.git('branch', 'victim');
  refspec(w, '+refs/heads/*:refs/remotes/origin/*', '+refs/heads/doomed:refs/heads/victim');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }), refused('REMOTE_CONFIG_UNSUPPORTED', { refspec: '+refs/heads/doomed:refs/heads/victim' }));
  assert.equal(pushed(w), false);
  assert.equal(w.oid('victim'), w.base);
  assert.equal(onOrigin(w, 'refs/heads/doomed'), w.base);
});

test('tag.push and tag.deleteRemote: a tag mapped onto a local branch → refused; a tag mapped onto itself (+refs/tags/*:refs/tags/*) pushes', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('tag', 'v1');
  w.repo.git('branch', 't/v1');
  refspec(w, '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/heads/t/*');
  await assert.rejects(w.op('tag.push', { remote: 'origin', names: ['v1'] }), refused('REMOTE_CONFIG_UNSUPPORTED', { refspec: '+refs/tags/*:refs/heads/t/*' }));
  await assert.rejects(w.op('tag.deleteRemote', { remote: 'origin', names: ['v1'] }), refused('REMOTE_CONFIG_UNSUPPORTED'));
  assert.equal(pushed(w), false);
  assert.equal(w.oid('t/v1'), w.base);
  refspec(w, '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*');
  assert.deepEqual((await w.op('tag.push', { remote: 'origin', names: ['v1'] })).pushed, ['v1']);
  assert.equal(onOrigin(w, 'refs/tags/v1'), w.base);
});

test('a tag destination mapped into refs/remotes/ through a symbolic ref → SYMBOLIC_REF before any push', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('tag', 'v1');
  w.repo.git('branch', 'victim');
  refspec(w, '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/remotes/origin/tags/*');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/tags/v1', 'refs/heads/victim');
  await assert.rejects(w.op('tag.push', { remote: 'origin', names: ['v1'] }), refused('SYMBOLIC_REF', { target: 'refs/heads/victim' }));
  assert.equal(pushed(w), false);
});
