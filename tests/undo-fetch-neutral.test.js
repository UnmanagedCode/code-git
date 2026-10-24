import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { OPS } from '../src/git/ops/index.js';
import { bindRepo, hermeticEnv } from './_git.js';
import { refused } from './_refsWorld.js';
import { pushFromElsewhere } from './_remotes.js';
import { undoWorld } from './_undoWorld.js';

// R3: remote.fetch (a manual fetch and the auto-fetch alike) is journal-neutral: it neither records an entry nor clears
// the slots. That is safe only because every registered plan refuses, rather than misapplies, once a fetch moved refs
// (docs/undo.md → Fetch neutrality).

const stage = (w, files) => { for (const [f, c] of Object.entries(files)) w.repo.write(f, c); w.repo.git('add', '-A'); };
const commit = async (w, summary) => { stage(w, { [`${summary}.txt`]: `${summary}\n` }); return w.op('commit.create', { summary }); };

/**
 * The ops audited against a fetch: every op carrying `undo` must be here, and only those. A card that registers an op
 * extends this list and the audit table in docs/undo.md.
 */
const FETCH_AUDITED = [
  'branch.checkout', 'branch.create', 'branch.delete', 'branch.fastForward', 'branch.move', 'branch.rename',
  'commit.create',
  'head.cherryPick', 'head.continue', 'head.reset', 'head.revert', 'head.skip',
  'merge.start',
  'rebase.interactive', 'rebase.start',
  'remote.add', 'remote.edit', 'remote.remove', 'remote.rename',
  'stage.discardFiles', 'stage.discardLines',
  'stash.apply', 'stash.applyFile', 'stash.branch', 'stash.drop', 'stash.pop', 'stash.push', 'stash.pushLines', 'stash.rename',
  'tag.create', 'tag.delete',
];

// Invariant: the set of undoable ops is exactly the audited list, so registering an op forces extending the fetch audit.
test('every op with an undo is in FETCH_AUDITED, and only those', () => {
  const undoable = [...OPS.values()].filter((o) => o.undo).map((o) => o.name).sort();
  assert.deepEqual(undoable, [...FETCH_AUDITED].sort());
});

// Invariant: remote.fetch is a journal-neutral write with no undo of its own.
test('remote.fetch is declared journal-neutral and not undoable', () => {
  const fetch = OPS.get('remote.fetch');
  assert.equal(fetch.kind, 'write');
  assert.equal(fetch.journal, 'neutral');
  assert.equal(fetch.undo, undefined);
});

// Invariant: a fetch that moves a tracking ref keeps the undo slot exactly (same entry id), and records nothing.
test('a fetch moving origin/main keeps the undo slot', async (t) => {
  const w = await undoWorld(t);
  await commit(w, 'one');
  const before = await w.state();
  const moved = pushFromElsewhere(w, 'main', { 'other.txt': 'o\n' });
  const r = await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(r.remotes[0].changes[0].new, moved, 'the fetch moved origin/main');
  assert.deepEqual(await w.state(), before);
});

// Invariant: a pruning fetch that deletes a tracking ref keeps the slot.
test('a fetch with prune deleting a tracking ref keeps the undo slot', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('push', '-q', 'origin', 'main:gone');
  w.origin.git('update-ref', '-d', 'refs/heads/gone');
  await commit(w, 'one');
  const before = await w.state();
  const r = await w.op('remote.fetch', { remote: 'origin', prune: true });
  assert.deepEqual(r.remotes[0].pruned, ['refs/remotes/origin/gone']);
  assert.deepEqual(await w.state(), before);
});

// Invariant: a fetch that creates tags keeps the slot.
test('a fetch creating tags keeps the undo slot', async (t) => {
  const w = await undoWorld(t);
  w.origin.git('tag', 'v9', 'main');
  await commit(w, 'one');
  const before = await w.state();
  await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(w.oid('refs/tags/v9'), w.base, 'the tag was fetched');
  assert.deepEqual(await w.state(), before);
});

// Invariant: the auto-fetch's shape (every remote, remote: null) keeps the slot.
test('a fetch of every remote (the auto-fetch shape) keeps the undo slot', async (t) => {
  const w = await undoWorld(t);
  pushFromElsewhere(w, 'main', { 'other.txt': 'o\n' });
  await commit(w, 'one');
  const before = await w.state();
  await w.op('remote.fetch', { remote: null });
  assert.deepEqual(await w.state(), before);
});

// Invariant: a failed fetch (an unreachable remote) keeps the slot too: neutral means never touched, success or not.
test('a failed fetch keeps the undo slot', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('remote', 'add', 'nowhere', path.join(w.repo.root, 'missing.git'));
  await commit(w, 'one');
  const before = await w.state();
  await assert.rejects(w.op('remote.fetch', { remote: 'nowhere' }), (e) => e.code !== undefined);
  assert.deepEqual(await w.state(), before);
});

// Invariant: a fetch after an undo keeps the redo slot.
test('a fetch keeps the redo slot after an undo', async (t) => {
  const w = await undoWorld(t);
  await commit(w, 'one');
  await w.undo();
  const before = await w.state();
  assert.ok(before.redo);
  pushFromElsewhere(w, 'main', { 'other.txt': 'o\n' });
  await w.op('remote.fetch', { remote: 'origin' });
  assert.deepEqual(await w.state(), before);
  await w.redo();
});

// Invariant: a tag a fetch re-created since its delete makes the undo refuse UNDO_STALE (the refs step's
// compare-and-swap), changing nothing.
test('tag.delete, then a fetch re-creates the tag: undo UNDO_STALE, nothing changed', async (t) => {
  const w = await undoWorld(t);
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  w.repo.git('tag', 'v1', two);
  w.repo.git('push', '-q', 'origin', 'v1');
  w.repo.git('reset', '-q', '--hard', w.base);
  w.origin.git('tag', '-f', 'v1', w.base);
  await w.op('tag.delete', { names: ['v1'] });
  await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(w.oid('refs/tags/v1'), w.base, 'the fetch re-created v1 elsewhere');
  const before = w.snap();
  await assert.rejects(w.undo(), refused('UNDO_STALE'));
  assert.deepEqual(w.snap(), before);
});

// Invariant: a lightweight tag a forcing tag refspec moved since its create makes the undo refuse UNDO_STALE.
test('tag.create (lightweight), then a +refs/tags/* fetch moves it: undo UNDO_STALE, nothing changed', async (t) => {
  const w = await undoWorld(t);
  const other = pushFromElsewhere(w, 'main', { 'other.txt': 'o\n' });
  w.origin.git('tag', 'v2', other);
  w.repo.git('config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*');
  await w.op('tag.create', { name: 'v2', oid: w.base });
  await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(w.oid('refs/tags/v2'), other, 'the fetch moved v2');
  const before = w.snap();
  await assert.rejects(w.undo(), refused('UNDO_STALE'));
  assert.deepEqual(w.snap(), before);
});

// Invariant: a remove's redo refuses UNDO_STALE once a fetch moved a tracking ref its undo re-created (the refs step's
// compare-and-swap), changing nothing.
test('remote.remove → undo → a fetch moves origin/main → redo UNDO_STALE, nothing changed', async (t) => {
  const w = await undoWorld(t);
  await w.op('remote.remove', { name: 'origin' });
  await w.undo();
  pushFromElsewhere(w, 'main', { 'other.txt': 'o\n' });
  await w.op('remote.fetch', { remote: 'origin' });
  const before = w.snap();
  await assert.rejects(w.redo(), refused('UNDO_STALE'));
  assert.deepEqual(w.snap(), before);
});

// Invariant: an add's undo refuses UNDO_STALE once the new remote was fetched (removing its config would strand the
// tracking refs the fetch wrote), changing nothing.
test('remote.add → fetch → undo UNDO_STALE (fetched since), nothing changed', async (t) => {
  const w = await undoWorld(t);
  await w.op('remote.add', { name: 'extra', url: w.origin.dir });
  await w.op('remote.fetch', { remote: 'extra' });
  assert.equal(w.oid('refs/remotes/extra/main'), w.base);
  const before = w.snap();
  await assert.rejects(w.undo(), (e) => { refused('UNDO_STALE')(e); assert.match(e.message, /fetched since/); return true; });
  assert.deepEqual(w.snap(), before);
});

// Invariant: a commit another clone pushed, seen once a fetch updates the tracking refs, makes the undo refuse
// UNDO_PUSHED: the fetch only makes the pushed check more accurate.
test('commit, pushed from another clone, then a fetch: undo UNDO_PUSHED, nothing changed', async (t) => {
  const w = await undoWorld(t);
  const { oid } = await commit(w, 'mine');
  const dir = path.join(w.repo.root, 'courier');
  execFileSync('git', ['clone', '-q', w.origin.dir, dir], { env: hermeticEnv(w.repo.home) });
  const courier = bindRepo(dir, w.repo.home);
  courier.git('fetch', '-q', w.repo.dir, 'main');
  courier.git('push', '-q', 'origin', 'FETCH_HEAD:refs/heads/main');
  await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(w.oid('refs/remotes/origin/main'), oid);
  const before = w.snap();
  await assert.rejects(w.undo(), refused('UNDO_PUSHED', { oid }));
  assert.deepEqual(w.snap(), before);
});

// Invariant: a branch delete whose upstream a pruning fetch removed still undoes exactly, with the upstream named in a
// warning (the documented degrade, not a misapply).
test('branch.delete with an upstream, then fetch --prune drops it: undo restores the branch with a warning', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'feat');
  w.repo.git('push', '-q', '-u', 'origin', 'feat');
  await w.op('branch.delete', { names: ['feat'], force: true });
  w.origin.git('update-ref', '-d', 'refs/heads/feat');
  await w.op('remote.fetch', { remote: 'origin', prune: true });
  const r = await w.undo();
  assert.equal(w.oid('refs/heads/feat'), w.base);
  assert.deepEqual(r.warnings, ["feat's upstream refs/remotes/origin/feat no longer exists: not set"]);
  assert.equal(w.exists('refs/remotes/origin/feat'), false);
});
