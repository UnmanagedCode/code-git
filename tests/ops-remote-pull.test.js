import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { refsWorld, refused } from './_refsWorld.js';
import { pushFromElsewhere } from './_remotes.js';

// remote.pull against a real bare origin: main tracks origin/main; another clone pushes to it.

const parents = (w, rev = 'HEAD') => w.repo.git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
const read = (w, f) => fs.readFileSync(path.join(w.repo.dir, f), 'utf8');
const inProgress = (w, ref) => w.exists(ref);
const ran = (w, sub) => w.argvs().filter((a) => a.includes(sub));

/** Origin's main one commit ahead (r.txt); locally one commit ahead too (l.txt) when `diverge`. */
function setup(w, { diverge = false, remoteFiles = { 'r.txt': 'r\n' }, localFiles = { 'l.txt': 'l\n' } } = {}) {
  const remote = pushFromElsewhere(w, 'main', remoteFiles);
  const local = diverge ? w.repo.commit(localFiles, 'local') : w.base;
  return { remote, local };
}

for (const mode of ['ff', 'ffOnly', 'rebase']) {
  test(`${mode}: up to date (and only ahead) → upToDate, HEAD unchanged; the fetch still ran`, async (t) => {
    const w = await refsWorld(t);
    const r = await w.op('remote.pull', { mode });
    assert.deepEqual([r.outcome, r.oid, r.upstream, r.mode], ['upToDate', w.base, 'refs/remotes/origin/main', mode]);
    assert.equal(ran(w, 'fetch').length, 1);
    const ahead = w.repo.commit({ 'a.txt': 'a\n' }, 'ahead');
    assert.equal((await w.op('remote.pull', { mode })).outcome, 'upToDate');
    assert.equal(w.oid('HEAD'), ahead);
    assert.equal(ran(w, 'merge').length + ran(w, 'rebase').length, 0, 'nothing integrated');
  });

  test(`${mode}: behind → fastForward to the fetched upstream; undo names the fetch's changes, the branch move and HEAD`, async (t) => {
    const w = await refsWorld(t);
    const { remote } = setup(w);
    const r = await w.op('remote.pull', { mode });
    assert.deepEqual([r.outcome, r.oid, w.oid('HEAD'), read(w, 'r.txt')], ['fastForward', remote, remote, 'r\n']);
    assert.deepEqual(r.fetch.changes, [{ ref: 'refs/remotes/origin/main', old: w.base, new: remote }]);
    assert.deepEqual(r.undo.refs, [{ ref: 'refs/remotes/origin/main', old: w.base, new: remote }, { ref: 'refs/heads/main', old: w.base, new: remote }]);
    assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/main', oid: w.base }, new: { branch: 'refs/heads/main', oid: remote } });
    assert.deepEqual(ran(w, 'merge'), [['-c', 'merge.autoStash=false', 'merge', '--ff-only', '--end-of-options', remote]]);
  });
}

test('ff, diverged → a merge commit of HEAD and the upstream with the remote-tracking message', async (t) => {
  const w = await refsWorld(t);
  const { remote, local } = setup(w, { diverge: true });
  const r = await w.op('remote.pull', { mode: 'ff' });
  assert.equal(r.outcome, 'merged');
  assert.deepEqual(parents(w), [local, remote]);
  assert.equal(w.repo.git('log', '-1', '--format=%s'), "Merge remote-tracking branch 'origin/main'");
  assert.deepEqual([read(w, 'r.txt'), read(w, 'l.txt'), r.oid], ['r\n', 'l\n', w.oid('HEAD')]);
  assert.deepEqual(ran(w, 'merge').at(-1), ['-c', 'merge.autoStash=false', 'merge', '--ff', '--no-edit', '-m', "Merge remote-tracking branch 'origin/main'", '--no-stat', '--end-of-options', remote]);
});

test('ffOnly, diverged → NOT_FAST_FORWARD: HEAD unchanged, the upstream fetched', async (t) => {
  const w = await refsWorld(t);
  const { remote, local } = setup(w, { diverge: true });
  await assert.rejects(w.op('remote.pull', { mode: 'ffOnly' }), refused('NOT_FAST_FORWARD'));
  assert.deepEqual([w.oid('HEAD'), w.oid('refs/remotes/origin/main')], [local, remote]);
  assert.equal(ran(w, 'merge').length, 0);
});

test('rebase, diverged → the local commit replayed on the upstream: linear, content kept', async (t) => {
  const w = await refsWorld(t);
  const { remote } = setup(w, { diverge: true });
  const r = await w.op('remote.pull', { mode: 'rebase' });
  assert.equal(r.outcome, 'rebased');
  assert.deepEqual(parents(w), [remote]);
  assert.equal(w.repo.git('log', '-1', '--format=%s'), 'local');
  assert.deepEqual([read(w, 'r.txt'), read(w, 'l.txt'), r.oid], ['r\n', 'l\n', w.oid('HEAD')]);
  assert.deepEqual(ran(w, 'rebase'), [[
    '-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.autoSquash=false', '-c', 'rebase.backend=merge', '-c', 'rebase.rebaseMerges=false',
    'rebase', '--end-of-options', remote,
  ]]);
  assert.equal(ran(w, 'pull').length, 0, 'never git pull');
});

test('a merge conflict leaves the merge in progress with the files; head.abort merge puts HEAD and the files back', async (t) => {
  const w = await refsWorld(t);
  const { local } = setup(w, { diverge: true, remoteFiles: { 'f.txt': 'remote\n' }, localFiles: { 'f.txt': 'local\n' } });
  const r = await w.op('remote.pull', { mode: 'ff' });
  assert.deepEqual([r.outcome, r.files, r.oid, r.undo.head], ['conflicts', ['f.txt'], local, null]);
  assert.equal(inProgress(w, 'MERGE_HEAD'), true);
  const a = await w.op('head.abort', { which: 'merge' });
  assert.equal(inProgress(w, 'MERGE_HEAD'), false);
  assert.deepEqual([w.oid('HEAD'), read(w, 'f.txt')], [local, 'local\n']);
  assert.deepEqual(a.undo.head, { old: { branch: 'refs/heads/main', oid: local }, new: { branch: 'refs/heads/main', oid: local } });
  await assert.rejects(w.op('head.abort', { which: 'merge' }), refused('NOTHING_IN_PROGRESS'));
});

test('a rebase conflict answers `conflicts` with the files and leaves the rebase in progress; head.abort rebase puts HEAD, the branch and the files back', async (t) => {
  const w = await refsWorld(t);
  const { local, remote } = setup(w, { diverge: true, remoteFiles: { 'f.txt': 'remote\n' }, localFiles: { 'f.txt': 'local\n' } });
  const r = await w.op('remote.pull', { mode: 'rebase' });
  assert.deepEqual([r.outcome, r.files, r.oid, r.undo.head], ['conflicts', ['f.txt'], local, null]);
  assert.equal(inProgress(w, 'REBASE_HEAD'), true);
  const state = await w.op('commit.state');
  assert.equal(state.operation.kind, 'rebase');
  assert.deepEqual([state.operation.rebase.branch, state.operation.rebase.onto, state.operation.incoming.oid], ['refs/heads/main', remote, local]);
  assert.deepEqual(state.conflicts.map((c) => [c.path, c.kind]), [['f.txt', 'bothModified']]);
  await w.op('head.abort', { which: 'rebase' });
  assert.equal(fs.existsSync(path.join(w.repo.dir, '.git', 'rebase-merge')), false);
  assert.deepEqual([w.oid('HEAD'), w.repo.git('symbolic-ref', 'HEAD'), read(w, 'f.txt'), w.repo.git('status', '--porcelain')], [local, 'refs/heads/main', 'local\n', '']);
});

test('a rebase pull stopped on conflicts finishes after the file is resolved, staged and continued: the branch is linear on the upstream', async (t) => {
  const w = await refsWorld(t);
  const { local, remote } = setup(w, { diverge: true, remoteFiles: { 'f.txt': 'remote\n' }, localFiles: { 'f.txt': 'local\n' } });
  assert.equal((await w.op('remote.pull', { mode: 'rebase' })).outcome, 'conflicts');
  w.repo.write('f.txt', 'both\n');
  await w.op('stage.files', { paths: ['f.txt'] });
  const c = await w.op('head.continue', { which: 'rebase' });
  assert.equal(c.outcome, 'done');
  assert.deepEqual([parents(w), w.repo.git('symbolic-ref', 'HEAD'), read(w, 'f.txt'), w.repo.git('log', '-1', '--format=%s')], [[remote], 'refs/heads/main', 'both\n', 'local']);
  assert.deepEqual(c.undo.refs, [{ ref: 'refs/heads/main', old: local, new: w.oid('HEAD') }]);
  assert.equal((await w.op('commit.state')).operation, null);
});

test('a pull refuses OPERATION_IN_PROGRESS while a rebase or merge is in progress, before fetching', async (t) => {
  const w = await refsWorld(t);
  setup(w, { diverge: true, remoteFiles: { 'f.txt': 'remote\n' }, localFiles: { 'f.txt': 'local\n' } });
  await w.op('remote.pull', { mode: 'ff' });
  const fetches = ran(w, 'fetch').length;
  for (const mode of ['ff', 'ffOnly', 'rebase']) await assert.rejects(w.op('remote.pull', { mode }), refused('OPERATION_IN_PROGRESS', { operation: 'merge' }));
  assert.equal(ran(w, 'fetch').length, fetches, 'no fetch');
});

test('rebase refuses tracked changes (DIRTY_WORKTREE) before fetching; untracked files do not count; ff merges around unrelated changes', async (t) => {
  const w = await refsWorld(t);
  const { remote } = setup(w, { diverge: true });
  w.repo.write('f.txt', 'edited\n');
  await assert.rejects(w.op('remote.pull', { mode: 'rebase' }), refused('DIRTY_WORKTREE'));
  w.repo.git('add', 'f.txt');
  await assert.rejects(w.op('remote.pull', { mode: 'rebase' }), refused('DIRTY_WORKTREE'));
  assert.equal(ran(w, 'fetch').length, 0);
  w.repo.git('reset', '-q', '--hard');
  w.repo.write('untracked.txt', 'u\n');
  assert.equal((await w.op('remote.pull', { mode: 'rebase' })).outcome, 'rebased');
  assert.deepEqual(parents(w), [remote]);
  assert.equal(read(w, 'untracked.txt'), 'u\n');
});

test('local changes in the way of a fast-forward → CHECKOUT_CONFLICT; nothing moves', async (t) => {
  const w = await refsWorld(t);
  setup(w, { remoteFiles: { 'f.txt': 'remote\n' } });
  w.repo.write('f.txt', 'mine\n');
  await assert.rejects(w.op('remote.pull', { mode: 'ff' }), refused('CHECKOUT_CONFLICT', { files: ['f.txt'] }));
  assert.deepEqual([w.oid('HEAD'), read(w, 'f.txt')], [w.base, 'mine\n']);
});

test('hostile config changes nothing: merge.autoStash (no hidden stash), rebase.updateRefs (other branches stay), rebase.autoSquash, pull.*', async (t) => {
  const w = await refsWorld(t);
  for (const [k, v] of [['merge.autoStash', 'true'], ['rebase.autoStash', 'true'], ['rebase.updateRefs', 'true'], ['rebase.autoSquash', 'true'], ['pull.rebase', 'interactive'], ['pull.ff', 'only'], ['merge.ff', 'false']]) {
    w.repo.git('config', k, v);
  }
  const remote = pushFromElsewhere(w, 'main', { 'f.txt': 'remote\n' });
  w.repo.write('f.txt', 'mine\n');
  await assert.rejects(w.op('remote.pull', { mode: 'ff' }), refused('CHECKOUT_CONFLICT'), 'no autostash around the fast-forward');
  assert.equal(w.repo.git('stash', 'list'), '');
  w.repo.git('checkout', '-q', 'f.txt');
  const one = w.repo.commit({ 'a.txt': 'a\n' }, 'one');
  w.repo.git('branch', 'pinned');
  const fixup = w.repo.commit({ 'b.txt': 'b\n' }, 'fixup! one');
  const r = await w.op('remote.pull', { mode: 'rebase' });
  assert.equal(r.outcome, 'rebased');
  assert.equal(w.oid('pinned'), one, 'rebase.updateRefs moved no other branch');
  assert.deepEqual(w.repo.git('log', '--format=%s', `${remote}..HEAD`).split('\n'), ['fixup! one', 'one'], 'autoSquash reordered nothing');
  assert.notEqual(w.oid('HEAD'), fixup);
  pushFromElsewhere(w, 'main', { 'g.txt': 'g\n' });
  w.repo.commit({ 'h.txt': 'h\n' }, 'h');
  assert.equal((await w.op('remote.pull', { mode: 'ff' })).outcome, 'merged', 'pull.ff=only and merge.ff=false do not apply');
});

test('a code-conductor/* HEAD needs ccOwned for a rebase pull only; ff and merge add commits', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  w.repo.git('push', '-q', 'origin', 'code-conductor/wt');
  wt.git('branch', '--set-upstream-to=origin/code-conductor/wt');
  pushFromElsewhere(w, 'code-conductor/wt', { 'r.txt': 'r\n' });
  wt.commit({ 'l.txt': 'l\n' }, 'local');
  await assert.rejects(w.op('remote.pull', { mode: 'rebase' }, 'wt'), refused('CC_OWNED_BRANCH', { head: true, branches: ['code-conductor/wt'] }));
  assert.equal(ran(w, 'fetch').length, 0);
  assert.equal((await w.op('remote.pull', { mode: 'rebase', ccOwned: true }, 'wt')).outcome, 'rebased');
  pushFromElsewhere(w, 'code-conductor/wt', { 's.txt': 's\n' });
  assert.equal((await w.op('remote.pull', { mode: 'ff' }, 'wt')).outcome, 'merged');
});

test('NO_UPSTREAM: detached HEAD, no upstream, a local upstream, an upstream remote that does not exist, an upstream gone from the remote', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '--detach');
  await assert.rejects(w.op('remote.pull', { mode: 'ff' }), refused('NO_UPSTREAM'));
  w.repo.git('checkout', '-q', '-b', 'loose');
  await assert.rejects(w.op('remote.pull', { mode: 'ff' }), refused('NO_UPSTREAM'));
  w.repo.git('branch', '--set-upstream-to=main');
  await assert.rejects(w.op('remote.pull', { mode: 'ff' }), refused('NO_UPSTREAM'), 'a local upstream');
  w.repo.git('config', 'branch.loose.remote', 'ghost');
  await assert.rejects(w.op('remote.pull', { mode: 'ff' }), refused('NO_UPSTREAM'));
  w.repo.git('push', '-q', '-u', 'origin', 'loose');
  w.origin.git('branch', '-D', 'loose');
  w.repo.git('update-ref', '-d', 'refs/remotes/origin/loose');
  await assert.rejects(w.op('remote.pull', { mode: 'ff' }), refused('NO_UPSTREAM'), 'gone from the remote: no tracking ref after the fetch');
  assert.equal(ran(w, 'merge').length, 0);
});

test('a pull never prunes: fetch.prune=true keeps a stale tracking ref, which the pull integrates (up to date)', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '-b', 'loose');
  w.repo.git('push', '-q', '-u', 'origin', 'loose');
  w.origin.git('branch', '-D', 'loose');
  w.repo.git('config', 'fetch.prune', 'true');
  assert.equal((await w.op('remote.pull', { mode: 'ff' })).outcome, 'upToDate');
  assert.equal(w.exists('refs/remotes/origin/loose'), true);
});
