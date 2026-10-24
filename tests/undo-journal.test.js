import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startApp } from './_app.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';
import { refused } from './_refsWorld.js';
import { undoWorld } from './_undoWorld.js';

// The journal's lifecycle with real ops (D1): what records, what clears, what keeps the slots, per checkout.

const stage = (w, files) => { for (const [f, c] of Object.entries(files)) w.repo.write(f, c); w.repo.git('add', '-A'); };
const commit = async (w, summary = 'c', at = null) => {
  stage(w, { [`${summary}.txt`]: `${summary}\n` });
  return w.op('commit.create', { summary }, at);
};
const EMPTY = { undo: null, redo: null };

// Invariant (D1): a write that is not registered for undo clears both slots, even one that leaves every ref as it was.
test('an unregistered write — stage.files, stage.unstageFiles, remote.pull — clears both slots', async (t) => {
  const w = await undoWorld(t);
  const writes = [
    ['stage.files', () => { w.repo.write('s.txt', 's\n'); return { paths: ['s.txt'] }; }],
    ['stage.unstageFiles', () => {
      w.repo.write('u.txt', 'u\n');
      w.repo.git('add', 'u.txt');
      return { paths: ['u.txt'] };
    }],
    ['remote.pull', () => ({ mode: 'ff' })],
  ];
  for (const [name, setup] of writes) {
    await commit(w, `before-${name.replace('.', '-')}`);
    await w.undo();
    await commit(w, `again-${name.replace('.', '-')}`);
    const s = await w.state();
    assert.ok(s.undo, name);
    await w.op(name, setup());
    assert.deepEqual(await w.state(), EMPTY, `${name} cleared the slots`);
  }
});

// Invariant (D1): a registered op that fails, or stops on conflicts (no plan), clears the slots.
test('a failed registered op and a conflicts outcome both clear the slots', async (t) => {
  const w = await undoWorld(t);
  await commit(w, 'one');
  await assert.rejects(w.op('commit.create', { summary: 'nothing staged' }), refused('NOTHING_TO_COMMIT'));
  assert.deepEqual(await w.state(), EMPTY);
  w.repo.git('switch', '-q', '-c', 'side');
  const s = w.repo.commit({ 'f.txt': 'side\n' }, 'side');
  w.repo.git('switch', '-q', 'main');
  w.repo.commit({ 'f.txt': 'main\n' }, 'main');
  await commit(w, 'two');
  const r = await w.op('head.cherryPick', { oid: s });
  assert.equal(r.conflicts, true);
  assert.deepEqual(await w.state(), EMPTY);
});

// Invariant (D1): a registered stash op whose outcome has no plan — a pop that stopped on conflicts — clears the slots.
test('a stash.pop that stops on conflicts records nothing and clears the slots', async (t) => {
  const w = await undoWorld(t);
  w.repo.write('f.txt', 'stashed\n');
  w.repo.git('stash', 'push', '-q');
  const oid = w.oid('refs/stash');
  w.repo.commit({ 'f.txt': 'committed over it\n' }, 'conflicting');
  await commit(w, 'one');
  assert.ok((await w.state()).undo);
  const r = await w.op('stash.pop', { oid });
  assert.deepEqual(r.conflicts, ['f.txt']);
  assert.deepEqual(await w.state(), EMPTY);
});

/** A stash of f.txt changed, saved with raw git → its oid. */
const stashed = (w) => {
  w.repo.write('f.txt', 'stashed\n');
  w.repo.git('stash', 'push', '-q');
  return w.oid('refs/stash');
};

// Invariant: a clean stash.apply records its own entry in place of the previous one, and empties redo.
test('a clean stash.apply records its own entry', async (t) => {
  const w = await undoWorld(t);
  const oid = stashed(w);
  await commit(w, 'one');
  await w.undo();
  await commit(w, 'two');
  const s = await w.state();
  assert.equal(s.undo.op, 'commit.create');
  await w.op('stash.apply', { oid });
  const after = await w.state();
  assert.equal(after.undo.op, 'stash.apply');
  assert.notEqual(after.undo.id, s.undo.id);
  assert.equal(after.redo, null);
});

// Invariant (D1): a stash.apply that stops on conflicts records nothing and clears the slots; its stash stays listed.
test('a stash.apply that stops on conflicts records nothing and clears the slots', async (t) => {
  const w = await undoWorld(t);
  const oid = stashed(w);
  w.repo.commit({ 'f.txt': 'committed over it\n' }, 'conflicting');
  await commit(w, 'one');
  assert.ok((await w.state()).undo);
  const r = await w.op('stash.apply', { oid });
  assert.deepEqual(r.conflicts, ['f.txt']);
  assert.deepEqual(await w.state(), EMPTY);
  assert.equal(w.oid('refs/stash'), oid);
});

// Invariant (D1): a stash.apply refused CHECKOUT_CONFLICT is a failed write: it records nothing and clears the slots.
test('a stash.apply refused CHECKOUT_CONFLICT clears the slots', async (t) => {
  const w = await undoWorld(t);
  const oid = stashed(w);
  await commit(w, 'one');
  assert.ok((await w.state()).undo);
  w.repo.write('f.txt', 'local edit\n');
  await assert.rejects(w.op('stash.apply', { oid }), refused('CHECKOUT_CONFLICT'));
  assert.deepEqual(await w.state(), EMPTY);
});

// Invariant: reads never clear the slots.
test('reads keep the slots', async (t) => {
  const w = await undoWorld(t);
  await commit(w, 'one');
  const before = await w.state();
  for (const [name, params] of [['repo.summary', {}], ['graph.refs', {}], ['commit.state', {}], ['undo.state', {}], ['branch.tracking', {}]]) await w.op(name, params);
  assert.deepEqual(await w.state(), before);
});

// Invariant: the slots are per checkout: a worktree's op neither shows in nor clears the main checkout's, nor a submodule tab's.
test('slots are per checkout: the main checkout, a worktree, a submodule target', async (t) => {
  const w = await undoWorld(t);
  const wtRepo = w.worktree('wt', 'wtb');
  await commit(w, 'main-one');
  const main = await w.state();
  wtRepo.write('wt.txt', 'wt\n');
  wtRepo.git('add', 'wt.txt');
  await w.op('commit.create', { summary: 'wt-one' }, 'wt');
  const wt = await w.state('wt');
  assert.ok(wt.undo && wt.undo.id !== main.undo.id);
  assert.deepEqual(await w.state(), main, "the worktree's commit left the main checkout's slot alone");
  assert.deepEqual(await w.state({ sub: ['lib'] }), EMPTY);
  await w.undo({}, 'wt');
  assert.deepEqual(await w.state(), main);
});

// Invariant: a new registered op after an undo replaces the undo slot and empties redo.
test('a new op after an undo clears redo', async (t) => {
  const w = await undoWorld(t);
  await commit(w, 'one');
  await w.undo();
  assert.ok((await w.state()).redo);
  w.repo.git('reset', '-q');
  await commit(w, 'two');
  const s = await w.state();
  assert.equal(s.redo, null);
  assert.equal(s.undo.label, 'Commit “two”');
});

// Invariant: an id that is not the slot's is refused UNDO_STALE and keeps the slots (the request was stale, not the slot).
test('an id mismatch is UNDO_STALE; the slot stays', async (t) => {
  const w = await undoWorld(t);
  await commit(w, 'one');
  const s = await w.state();
  await assert.rejects(w.op('undo.undo', { id: s.undo.id + 1 }), refused('UNDO_STALE'));
  await assert.rejects(w.op('undo.redo', { id: s.undo.id }), refused('NOTHING_TO_REDO'));
  assert.deepEqual(await w.state(), s);
});

// Invariant: a change made outside code-git since the op (a raw git commit) makes the undo UNDO_STALE and clears the slots.
test('a commit made with raw git after the op: UNDO_STALE, nothing moves, the slots are cleared', async (t) => {
  const w = await undoWorld(t);
  await commit(w, 'one');
  const raw = w.repo.commit({ 'raw.txt': 'raw\n' }, 'raw');
  await assert.rejects(w.undo(), refused('UNDO_STALE'));
  assert.equal(w.oid('HEAD'), raw);
  assert.deepEqual(await w.state(), EMPTY);
});

// Invariant: the route wraps every op: over HTTP a commit records, undo.state shows it, stage.files clears it, and a backend
// with a fresh journal (a restart) answers NOTHING_TO_UNDO.
test('over HTTP: a commit records, an unregistered write clears, a fresh backend has nothing to undo', async (t) => {
  const repo = makeRepo(t);
  repo.commit({ 'a.txt': 'a\n' });
  const cc = await fakeCc({ projects: { app: { dir: repo.dir } }, home: repo.home });
  t.after(() => cc.close());
  const target = { project: 'app' };
  const first = await startApp(t);
  repo.write('b.txt', 'b\n');
  repo.git('add', 'b.txt');
  assert.equal((await first.call('POST', '/api/ops/commit.create', { target, params: { summary: 'b' } })).status, 200);
  const s = (await first.call('POST', '/api/ops/undo.state', { target })).body.result;
  assert.equal(s.undo.label, 'Commit “b”');
  const fresh = await startApp(t);
  const none = await fresh.call('POST', '/api/ops/undo.undo', { target, params: { id: s.undo.id } });
  assert.deepEqual([none.status, none.body.code], [409, 'NOTHING_TO_UNDO']);
  repo.write('a.txt', 'dirty\n');
  assert.equal((await first.call('POST', '/api/ops/stage.files', { target, params: { paths: ['a.txt'] } })).status, 200);
  assert.deepEqual((await first.call('POST', '/api/ops/undo.state', { target })).body.result, EMPTY);
});

// Invariant: undo.undo / undo.redo take {id: positive integer, ccOwned?: boolean} only; undo.state takes nothing.
test('params: id is a positive integer, ccOwned a boolean, nothing else', async (t) => {
  const w = await undoWorld(t);
  for (const bad of [{}, { id: 0 }, { id: 1.5 }, { id: '1' }, { id: 1, ccOwned: 'yes' }, { id: 1, steps: [] }]) {
    await assert.rejects(w.op('undo.undo', bad), refused('BAD_PARAMS'), JSON.stringify(bad));
  }
  await assert.rejects(w.op('undo.state', { id: 1 }), refused('BAD_PARAMS'));
});
