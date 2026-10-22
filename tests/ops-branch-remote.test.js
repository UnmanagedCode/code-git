import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
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
  assert.deepEqual(pushArgv, ['push', '--porcelain', '--end-of-options', 'origin', ':refs/heads/feat']);
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
