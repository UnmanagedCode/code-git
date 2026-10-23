import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';
import { pushFromElsewhere } from './_remotes.js';

// remote.push against a real bare origin. Every test's exec log is scanned: no push ever forces except by lease.

const onOrigin = (w, ref) => { try { return w.origin.git('rev-parse', '--verify', '-q', ref); } catch { return null; } };
const config = (w, key) => { try { return w.repo.git('config', key); } catch { return null; } };
const pushes = (w) => w.argvs().filter((a) => a[0] === 'push');

/** refsWorld whose exec log, after the test, holds no `--force`, `-f` or `+` refspec in any push. */
async function world(t) {
  const w = await refsWorld(t);
  t.after(() => {
    for (const a of pushes(w)) {
      assert.ok(!a.some((x) => x === '--force' || x === '-f' || /^\+/.test(x) || /^--force(?!-with-lease=)/.test(x)), a.join(' '));
    }
  });
  return w;
}

test('a first push creates the remote branch and sets the upstream; the argv is the pinned porcelain push', async (t) => {
  const w = await world(t);
  w.repo.git('checkout', '-q', '-b', 'feature/new');
  const tip = w.repo.commit({ 'n.txt': 'n\n' }, 'new');
  const r = await w.op('remote.push', { branch: 'feature/new', remote: 'origin', setUpstream: true });
  assert.deepEqual(r, {
    remote: 'origin', branch: 'feature/new', to: 'feature/new', created: true, forced: false, upToDate: false, upstreamSet: true, unrequested: [],
    undo: { refs: [], remoteRefs: [], head: null, worktreeSnapshot: null, stashes: [], worktreePatch: null, remotes: [] },
  });
  assert.equal(onOrigin(w, 'refs/heads/feature/new'), tip);
  assert.deepEqual([config(w, 'branch.feature/new.remote'), config(w, 'branch.feature/new.merge')], ['origin', 'refs/heads/feature/new']);
  assert.equal(w.oid('refs/remotes/origin/feature/new'), tip, 'the tracking ref follows');
  assert.deepEqual(pushes(w), [['push', '--porcelain', '--no-follow-tags', '--set-upstream', '--end-of-options', 'origin', 'refs/heads/feature/new:refs/heads/feature/new']]);
  endOfOptionsBefore(pushes(w)[0], 'origin');
});

test('without a remote the branch pushes to its upstream (another name included); up to date is reported; no upstream → NO_UPSTREAM', async (t) => {
  const w = await world(t);
  const tip = w.repo.commit({ 'm.txt': 'm\n' }, 'm');
  const r = await w.op('remote.push', { branch: 'main' });
  assert.deepEqual([r.remote, r.to, r.created, r.forced, r.upToDate, r.upstreamSet], ['origin', 'main', false, false, false, false]);
  assert.equal(onOrigin(w, 'refs/heads/main'), tip);
  assert.equal((await w.op('remote.push', { branch: 'main' })).upToDate, true);
  w.repo.git('branch', 'local-name');
  w.repo.git('push', '-q', 'origin', 'local-name:remote-name');
  w.repo.git('branch', '--set-upstream-to=origin/remote-name', 'local-name');
  w.repo.git('update-ref', 'refs/heads/local-name', w.repo.commit({ 'x.txt': 'x\n' }, 'x'));
  const named = await w.op('remote.push', { branch: 'local-name' });
  assert.equal(named.to, 'remote-name');
  assert.equal(onOrigin(w, 'refs/heads/remote-name'), w.oid('local-name'));
  w.repo.git('branch', 'loose');
  await assert.rejects(w.op('remote.push', { branch: 'loose' }), refused('NO_UPSTREAM'));
  w.repo.git('branch', '--set-upstream-to=main', 'loose');
  await assert.rejects(w.op('remote.push', { branch: 'loose' }), refused('NO_UPSTREAM'), 'a local upstream');
});

test('push to a differently named remote branch (the drop target), creating it', async (t) => {
  const w = await world(t);
  w.repo.git('branch', 'track');
  const r = await w.op('remote.push', { branch: 'track', remote: 'origin', to: 'other/name' });
  assert.deepEqual([r.to, r.created], ['other/name', true]);
  assert.equal(onOrigin(w, 'refs/heads/other/name'), w.base);
  assert.equal(config(w, 'branch.track.remote'), null, 'no upstream unless asked');
});

test('a non-fast-forward push → PUSH_REJECTED with the tracking ref the UI leases against; nothing moves', async (t) => {
  const w = await world(t);
  const theirs = pushFromElsewhere(w, 'main', { 'r.txt': 'r\n' });
  w.repo.commit({ 'l.txt': 'l\n' }, 'local');
  await assert.rejects(w.op('remote.push', { branch: 'main' }), refused('PUSH_REJECTED', {
    rejected: [{ ref: 'refs/heads/main', reason: 'fetch first' }], tracking: { ref: 'refs/remotes/origin/main', oid: w.base },
  }));
  assert.equal(onOrigin(w, 'refs/heads/main'), theirs);
});

test('force with lease: the right expect overwrites (forced); a stale expect is rejected (stale info) and the remote is unchanged', async (t) => {
  const w = await world(t);
  const theirs = pushFromElsewhere(w, 'main', { 'r.txt': 'r\n' });
  const mine = w.repo.commit({ 'l.txt': 'l\n' }, 'local');
  await assert.rejects(w.op('remote.push', { branch: 'main', forceWithLease: { expect: w.base } }), refused('PUSH_REJECTED', { rejected: [{ ref: 'refs/heads/main', reason: 'stale info' }] }));
  assert.equal(onOrigin(w, 'refs/heads/main'), theirs, 'the lease protected their commit');
  const r = await w.op('remote.push', { branch: 'main', forceWithLease: { expect: theirs } });
  assert.deepEqual([r.forced, r.created], [true, false]);
  assert.equal(onOrigin(w, 'refs/heads/main'), mine);
  assert.deepEqual(pushes(w).at(-1), ['push', '--porcelain', '--no-follow-tags', `--force-with-lease=refs/heads/main:${theirs}`, '--end-of-options', 'origin', 'refs/heads/main:refs/heads/main']);
});

test('a lease expecting no branch (null) creates one, and is rejected when the branch exists', async (t) => {
  const w = await world(t);
  w.repo.git('branch', 'fresh');
  assert.equal((await w.op('remote.push', { branch: 'fresh', remote: 'origin', forceWithLease: { expect: null } })).created, true);
  assert.equal(pushes(w).at(-1)[3], '--force-with-lease=refs/heads/fresh:');
  w.repo.git('update-ref', 'refs/heads/fresh', w.repo.commit({ 'z.txt': 'z\n' }, 'z'));
  await assert.rejects(w.op('remote.push', { branch: 'fresh', remote: 'origin', forceWithLease: { expect: null } }), refused('PUSH_REJECTED'));
  assert.equal(onOrigin(w, 'refs/heads/fresh'), w.base);
});

test('a code-conductor/* source or destination needs ccOwned before anything runs', async (t) => {
  const w = await world(t);
  w.worktree('wt', 'code-conductor/wt');
  await assert.rejects(w.op('remote.push', { branch: 'code-conductor/wt', remote: 'origin' }, 'wt'), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/wt'] }));
  await assert.rejects(w.op('remote.push', { branch: 'main', remote: 'origin', to: 'code-conductor/x' }), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/x'] }));
  assert.deepEqual(pushes(w), []);
  await w.op('remote.push', { branch: 'code-conductor/wt', remote: 'origin', ccOwned: true }, 'wt');
  assert.equal(onOrigin(w, 'refs/heads/code-conductor/wt'), w.base);
});

test('a symbolic tracking ref, a symbolic or unknown local branch → refused before any push; tags never follow', async (t) => {
  const w = await world(t);
  w.repo.git('branch', 'victim');
  w.repo.git('branch', 'x');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/x', 'refs/heads/victim');
  await assert.rejects(w.op('remote.push', { branch: 'x', remote: 'origin' }), refused('SYMBOLIC_REF', { target: 'refs/heads/victim' }));
  w.repo.git('symbolic-ref', 'refs/heads/alias', 'refs/heads/main');
  await assert.rejects(w.op('remote.push', { branch: 'alias', remote: 'origin' }), refused('SYMBOLIC_REF', { target: 'refs/heads/main' }));
  w.repo.git('symbolic-ref', 'refs/heads/dangling', 'refs/heads/nowhere');
  await assert.rejects(w.op('remote.push', { branch: 'dangling', remote: 'origin' }), refused('SYMBOLIC_REF', { target: 'refs/heads/nowhere' }));
  await assert.rejects(w.op('remote.push', { branch: 'nope', remote: 'origin' }), refused('REF_UNKNOWN'));
  await assert.rejects(w.op('remote.push', { branch: 'main', remote: 'nope' }), refused('REMOTE_UNKNOWN'));
  assert.deepEqual(pushes(w), []);
  w.repo.git('config', 'push.followTags', 'true');
  w.repo.git('tag', '-a', '-m', 'v', 'v1');
  w.repo.git('update-ref', 'refs/heads/main', w.repo.commit({ 'q.txt': 'q\n' }, 'q'));
  await w.op('remote.push', { branch: 'main' });
  assert.equal(onOrigin(w, 'refs/tags/v1'), null, 'push.followTags published nothing');
});

test('params: to needs remote; a lease is {expect: oid | null}; names are checked', async (t) => {
  const w = await world(t);
  for (const [params, code] of [
    [{ branch: 'main', to: 'x' }, 'BAD_PARAMS'],
    [{ branch: 'main', forceWithLease: { expect: 'abc' } }, 'BAD_REF'],
    [{ branch: 'main', forceWithLease: {} }, 'BAD_PARAMS'],
    [{ branch: 'main', forceWithLease: { expect: null, more: 1 } }, 'BAD_PARAMS'],
    [{ branch: 'main', forceWithLease: true }, 'BAD_PARAMS'],
    [{ branch: '-x' }, 'BAD_REF'],
    [{ branch: 'main', remote: 'origin', to: 'refs/heads/x' }, 'BAD_REF'],
    [{ branch: 'main', remote: '--receive-pack=x' }, 'REMOTE_UNKNOWN'],
    [{ branch: 'main', setUpstream: 'yes' }, 'BAD_PARAMS'],
  ]) await assert.rejects(w.op('remote.push', params), refused(code), JSON.stringify(params));
  assert.deepEqual(w.cc.state.execCalls, []);
});
