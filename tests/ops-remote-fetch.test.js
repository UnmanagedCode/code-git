import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { startApp } from './_app.js';
import { refsWorld, refused } from './_refsWorld.js';
import { pushFromElsewhere } from './_remotes.js';

// remote.fetch and remote.peek against real bare remotes: what git's refs hold afterwards.

const fetchArgv = (w) => w.argvs().filter((a) => a.includes('fetch'));
const refsUnder = (w, prefix) => w.repo.git('for-each-ref', '--format=%(refname) %(objectname)', prefix).split('\n').filter(Boolean);

test('fetch one remote: changes (moved, created) match git and are the undo; the argv pins gc, maintenance, submodules and pruning', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('fetch', '-q', 'origin');
  const main2 = pushFromElsewhere(w, 'main', { 'm.txt': 'm\n' });
  const feat = pushFromElsewhere(w, 'feat', { 'f2.txt': 'f\n' });
  const r = await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(r.remotes.length, 1);
  const [one] = r.remotes;
  assert.equal(one.remote, 'origin');
  const sorted = [...one.changes].sort((a, b) => a.ref.localeCompare(b.ref));
  assert.deepEqual(sorted, [
    { ref: 'refs/remotes/origin/feat', old: null, new: feat },
    { ref: 'refs/remotes/origin/main', old: w.base, new: main2 },
  ]);
  assert.deepEqual([w.oid('refs/remotes/origin/main'), w.oid('refs/remotes/origin/feat')], [main2, feat]);
  assert.deepEqual([one.pruned, one.symrefsResolved, one.partial], [[], [], null]);
  assert.deepEqual(r.undo.refs, one.changes);
  assert.deepEqual(fetchArgv(w), [['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--no-recurse-submodules', '--no-prune', '--no-prune-tags', '--end-of-options', 'origin']]);
  assert.equal(w.oid('main'), w.base, 'no local branch moved');
  const again = await w.op('remote.fetch', { remote: 'origin' });
  assert.deepEqual(again.remotes[0].changes, [], 'an up-to-date fetch changes nothing');
});

test('fetch every remote: each is fetched in turn; one failing is reported beside the others, not thrown; a push-only remote is skipped', async (t) => {
  const w = await refsWorld(t);
  const main2 = pushFromElsewhere(w, 'main', { 'm.txt': 'm\n' });
  w.repo.git('remote', 'add', 'nowhere', path.join(w.repo.root, 'missing.git'));
  w.repo.git('remote', 'add', 'zz', w.origin.dir);
  w.repo.git('config', 'remote.pushonly.pushurl', w.origin.dir);
  const r = await w.op('remote.fetch', { remote: null });
  const by = Object.fromEntries(r.remotes.map((x) => [x.remote, x]));
  assert.deepEqual(Object.keys(by).sort(), ['nowhere', 'origin', 'zz']);
  assert.equal(by.nowhere.error.code, 'REMOTE_UNREACHABLE');
  assert.equal(by.nowhere.error.reason, 'not-found');
  assert.match(by.nowhere.error.stderr, /does not appear to be a git repository/);
  assert.deepEqual(by.origin.changes, [{ ref: 'refs/remotes/origin/main', old: w.base, new: main2 }]);
  assert.equal(w.oid('refs/remotes/zz/main'), main2, 'the remote after the failing one was fetched too');
  assert.deepEqual(r.undo.refs.map((c) => c.ref).sort(), ['refs/remotes/origin/main', 'refs/remotes/zz/main']);
  await assert.rejects(w.op('remote.fetch', { remote: 'nowhere' }), refused('REMOTE_UNREACHABLE', { reason: 'not-found' }));
  await assert.rejects(w.op('remote.fetch', { remote: 'nope' }), refused('REMOTE_UNKNOWN'));
  await assert.rejects(w.op('remote.fetch', {}), refused('BAD_PARAMS'));
  await assert.rejects(w.op('remote.fetch', { remote: 'origin', prune: 'yes' }), refused('BAD_PARAMS'));
});

test('pruning only when asked: fetch.prune / remote.prune config prune nothing; prune deletes gone branches; tags are never pruned, fetch.pruneTags included', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('push', '-q', 'origin', 'main:gone');
  w.repo.git('tag', 'local-only');
  w.repo.git('fetch', '-q', 'origin');
  w.origin.git('branch', '-D', 'gone');
  for (const [k, v] of [['fetch.prune', 'true'], ['fetch.pruneTags', 'true'], ['remote.origin.prune', 'true'], ['remote.origin.pruneTags', 'true']]) w.repo.git('config', k, v);
  const kept = await w.op('remote.fetch', { remote: 'origin' });
  assert.deepEqual(kept.remotes[0].pruned, []);
  assert.equal(w.exists('refs/remotes/origin/gone'), true);
  const pruned = await w.op('remote.fetch', { remote: 'origin', prune: true });
  assert.deepEqual(pruned.remotes[0].pruned, ['refs/remotes/origin/gone']);
  assert.deepEqual(pruned.remotes[0].changes, [{ ref: 'refs/remotes/origin/gone', old: w.base, new: null }]);
  assert.equal(w.exists('refs/remotes/origin/gone'), false);
  assert.equal(w.exists('refs/tags/local-only'), true, 'a tag the remote lacks is never pruned');
  assert.ok(fetchArgv(w).at(-1).includes('--prune') && fetchArgv(w).at(-1).includes('--no-prune-tags'));
  assert.deepEqual(pruned.undo.refs, [{ ref: 'refs/remotes/origin/gone', old: w.base, new: null }]);
});

test('a fetch refspec writing outside refs/remotes/ and refs/tags/ → REMOTE_CONFIG_UNSUPPORTED before any fetch; local branches untouched', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  pushFromElsewhere(w, 'code-conductor/wt', { 'evil.txt': 'x\n' });
  w.repo.git('config', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*');
  await assert.rejects(w.op('remote.fetch', { remote: 'origin' }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin', refspec: '+refs/heads/*:refs/heads/*' }));
  assert.deepEqual(fetchArgv(w), [], 'no fetch ran');
  assert.equal(w.oid('refs/heads/code-conductor/wt'), w.base);
  assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD'), w.base);
  const all = await w.op('remote.fetch', { remote: null });
  assert.equal(all.remotes[0].error.code, 'REMOTE_CONFIG_UNSUPPORTED', 'fetch all reports it per remote');
});

test('a live symbolic tracking ref → SYMBOLIC_REF (ref, target) before any fetch; its target stays', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'victim');
  pushFromElsewhere(w, 'x', { 'x.txt': 'x\n' });
  w.repo.git('symbolic-ref', 'refs/remotes/origin/x', 'refs/heads/victim');
  await assert.rejects(w.op('remote.fetch', { remote: 'origin' }), refused('SYMBOLIC_REF', { ref: 'refs/remotes/origin/x', target: 'refs/heads/victim' }));
  assert.deepEqual(fetchArgv(w), []);
  assert.equal(w.oid('victim'), w.base);
  w.repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/x');
  w.repo.git('symbolic-ref', 'refs/tags/t', 'refs/heads/victim');
  await assert.rejects(w.op('remote.fetch', { remote: 'origin' }), refused('SYMBOLIC_REF', { ref: 'refs/tags/t' }), 'a symbolic tag is refused too');
});

test('the remote\'s HEAD alias is not refused, and a fetch creating it is not reported', async (t) => {
  const w = await refsWorld(t);
  const first = await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(w.repo.git('symbolic-ref', 'refs/remotes/origin/HEAD'), 'refs/remotes/origin/main', 'git created the alias');
  assert.deepEqual(first.remotes[0].symrefsResolved, []);
  pushFromElsewhere(w, 'main', { 'm.txt': 'm\n' });
  const second = await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(second.remotes[0].changes.length, 1);
});

test('a dangling symbolic tracking ref the fetch brings to life (it fetches the target): symrefsResolved names the ref and its target', async (t) => {
  const w = await refsWorld(t);
  // git (2.55) never writes through a symbolic tracking ref, but a fetch can create what a dangling one names: the tag it follows.
  w.origin.git('tag', 'v9', w.base);
  w.repo.git('symbolic-ref', 'refs/remotes/origin/new', 'refs/tags/v9');
  const r = await w.op('remote.fetch', { remote: 'origin' });
  assert.deepEqual(r.remotes[0].symrefsResolved, [{ ref: 'refs/remotes/origin/new', target: 'refs/tags/v9' }]);
  assert.equal(w.oid('refs/tags/v9'), w.base);
  assert.equal(r.remotes[0].changes.some((c) => c.ref === 'refs/remotes/origin/new'), false, 'a symbolic ref is not a change');
  await assert.rejects(w.op('remote.fetch', { remote: 'origin' }), refused('SYMBOLIC_REF', { ref: 'refs/remotes/origin/new', target: 'refs/tags/v9' }), 'live now: the next fetch refuses it');
});

test('a held fetch is cancelled from the activity route: CANCELLED, the entry ends cancelled, the repo is consistent', async (t) => {
  const w = await refsWorld(t);
  pushFromElsewhere(w, 'main', { 'm.txt': 'm\n' });
  const app = await startApp(t);
  w.cc.state.execHook = (body) => (body.argv.includes('fetch') ? 'hold' : undefined);
  const response = app.call('POST', '/api/ops/remote.fetch', { target: { project: 'repo' }, params: { remote: 'origin' } });
  const held = await w.cc.nextHeld();
  const entry = (await app.call('GET', '/api/activity')).body.entries.at(-1);
  assert.deepEqual([entry.op, entry.cancellable], ['remote.fetch', true]);
  assert.equal((await app.call('POST', `/api/activity/${entry.id}/cancel`, {})).status, 200);
  const r = await response;
  assert.deepEqual([r.status, r.body.code], [409, 'CANCELLED']);
  await held.closed;
  assert.equal(held.disconnected, true);
  assert.equal(w.oid('refs/remotes/origin/main'), w.base, 'nothing was fetched');
  w.repo.git('fsck', '--no-progress');
});

test('peek: the remote branch\'s oid against its tracking ref — not stale, stale, missing; exact name only', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('fetch', '-q', 'origin');
  assert.deepEqual(await w.op('remote.peek', { remote: 'origin', branch: 'main' }), { oid: w.base, tracking: { ref: 'refs/remotes/origin/main', oid: w.base }, stale: false });
  const moved = pushFromElsewhere(w, 'main', { 'm.txt': 'm\n' });
  assert.deepEqual(await w.op('remote.peek', { remote: 'origin', branch: 'main' }), { oid: moved, tracking: { ref: 'refs/remotes/origin/main', oid: w.base }, stale: true });
  assert.equal(w.oid('refs/remotes/origin/main'), w.base, 'peek writes nothing');
  pushFromElsewhere(w, 'a/refs/heads/x', { 'a.txt': 'a\n' });
  assert.deepEqual(await w.op('remote.peek', { remote: 'origin', branch: 'x' }), { oid: null, tracking: null, stale: false });
  const ls = w.argvs().findLast((a) => a.includes('ls-remote'));
  assert.deepEqual(ls, ['ls-remote', '--refs', '--end-of-options', 'origin', 'refs/heads/x']);
  w.repo.git('update-ref', 'refs/remotes/origin/gone', w.base);
  assert.deepEqual(await w.op('remote.peek', { remote: 'origin', branch: 'gone' }), { oid: null, tracking: { ref: 'refs/remotes/origin/gone', oid: w.base }, stale: true });
  await assert.rejects(w.op('remote.peek', { remote: 'origin', branch: '-x' }), refused('BAD_REF'));
  await assert.rejects(w.op('remote.peek', { remote: 'nope', branch: 'main' }), refused('REMOTE_UNKNOWN'));
});
