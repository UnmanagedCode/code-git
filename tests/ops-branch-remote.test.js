import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { push } from '../src/git/remote/push.js';
import { ctxFor, gitFor } from './_ctx.js';
import { refsWorld, refused } from './_refsWorld.js';

const onOrigin = (w, ref) => { try { return w.origin.git('rev-parse', '--verify', '-q', ref); } catch { return null; } };

test('deleteRemote removes the branch on the remote and its tracking ref here; undo.remoteRefs.old is the tracking oid before', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '-b', 'feat');
  const f = w.repo.commit({ 'x.txt': 'x\n' }, 'x');
  w.repo.git('push', '-q', 'origin', 'feat');
  w.repo.git('checkout', '-q', 'main');
  const r = await w.op('branch.deleteRemote', { remote: 'origin', branches: ['feat'] });
  assert.deepEqual(r.deleted, ['feat']);
  assert.deepEqual(r.rejected, []);
  assert.equal(onOrigin(w, 'refs/heads/feat'), null);
  assert.equal(w.exists('refs/remotes/origin/feat'), false);
  assert.equal(w.oid('feat'), f, 'the local branch stays');
  assert.deepEqual(r.undo.remoteRefs, [{ remote: 'origin', ref: 'refs/heads/feat', old: f, new: null }]);
  const pushArgv = w.argvs().find((a) => a[0] === 'push');
  assert.deepEqual(pushArgv, ['push', '--porcelain', '--no-follow-tags', '--end-of-options', 'origin', ':refs/heads/feat']);
});

test('deleteRemote: an unknown remote → REMOTE_UNKNOWN; a cc-owned branch needs ccOwned', async (t) => {
  const w = await refsWorld(t);
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'upstream', branches: ['main'] }), refused('REMOTE_UNKNOWN'));
  w.repo.git('push', '-q', 'origin', 'main:code-conductor/wt');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['code-conductor/wt'] }), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/wt'] }));
  assert.equal(w.argvs().some((a) => a[0] === 'push'), false);
  await w.op('branch.deleteRemote', { remote: 'origin', branches: ['code-conductor/wt'], ccOwned: true });
  assert.equal(onOrigin(w, 'refs/heads/code-conductor/wt'), null);
});

test('a remote named like an option is refused before any exec', async (t) => {
  const w = await refsWorld(t);
  for (const remote of ['--upload-pack=x', '-o', 'a b', 'x\ny', '']) {
    for (const name of ['branch.deleteRemote', 'tag.push', 'tag.deleteRemote']) {
      const params = name === 'branch.deleteRemote' ? { remote, branches: ['main'] } : { remote, names: ['v1'] };
      await assert.rejects(w.op(name, params), refused('REMOTE_UNKNOWN'), `${name} ${remote}`);
    }
  }
  assert.deepEqual(w.cc.state.execCalls, []);
  assert.throws(() => getOp(OPS, 'tag.push').params({ remote: 'origin', names: ['-x'] }), refused('BAD_REF'));
});

test('a symbolic remote-tracking ref refuses a remote delete (SYMBOLIC_REF) before any push: the cc branch it points at and its worktree stay', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  w.repo.git('push', '-q', 'origin', 'main:doomed');
  w.repo.git('fetch', '-q', 'origin');
  w.repo.git('update-ref', '-d', 'refs/remotes/origin/doomed');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/doomed', 'refs/heads/code-conductor/wt');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }), refused('SYMBOLIC_REF', { target: 'refs/heads/code-conductor/wt' }));
  assert.equal(w.oid('refs/heads/code-conductor/wt'), w.base);
  assert.equal(w.repo.git('-C', wt.dir, 'symbolic-ref', 'HEAD'), 'refs/heads/code-conductor/wt');
  assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD'), w.base);
  assert.equal(w.origin.git('rev-parse', 'refs/heads/doomed'), w.base, 'the remote branch was not deleted either');
  assert.equal(w.argvs().some((a) => a[0] === 'push'), false, 'no push ran');
});

test('the shared push() refuses a branch push whose tracking ref is symbolic, live or dangling; tags are unaffected', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'victim');
  w.repo.git('branch', 'x');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/x', 'refs/heads/victim');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/y', 'refs/heads/nowhere');
  w.repo.git('tag', 'v1');
  const ctx = ctxFor({ project: 'repo' }, 'write', { op: 'test.push', cancellable: true });
  const git = gitFor(ctx);
  await assert.rejects(push(git, 'origin', ['refs/heads/x:refs/heads/x']), refused('SYMBOLIC_REF', { target: 'refs/heads/victim' }));
  await assert.rejects(push(git, 'origin', ['refs/heads/x:refs/heads/y']), refused('SYMBOLIC_REF', { target: 'refs/heads/nowhere' }));
  assert.equal(w.argvs().some((a) => a[0] === 'push'), false, 'no push ran');
  assert.equal(w.repo.git('symbolic-ref', 'refs/remotes/origin/x'), 'refs/heads/victim');
  assert.equal(w.oid('victim'), w.base);
  const r = await push(git, 'origin', ['refs/tags/v1:refs/tags/v1']);
  assert.deepEqual(r.updated.map((u) => u.ref), ['refs/tags/v1']);
});
