import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { roundTrip, undoWorld } from './_undoWorld.js';

// The stash ops registered for undo: do → undo restores the state before exactly (HEAD, refs, index, worktree files and
// modes, the stash list with its subjects) → redo restores the state after exactly. R1: a stash put back by an undo or a
// redo lands at stash@{0}, so only an entry dropped from the top comes back in place.

const nums = (n) => Array.from({ length: n }, (_, i) => `l${i + 1}`);
const text = (ls) => ls.map((l) => `${l}\n`).join('');
const stashes = (w) => w.repo.git('stash', 'list', '--format=%H %gs').split('\n').filter(Boolean);
const gitVersion = (w) => w.repo.git('version').match(/(\d+)\.(\d+)/).slice(1).map(Number);
const atLeast = (w, [a, b]) => { const [x, y] = gitVersion(w); return x > a || (x === a && y >= b); };

/** A stash of `files` written over the base, saved with raw git (it does not touch the journal) → its oid. */
function saved(w, files, args = []) {
  for (const [f, c] of Object.entries(files)) w.repo.write(f, c);
  w.repo.git('stash', 'push', '-q', ...args);
  return w.oid('refs/stash');
}

/** Both slots' confirmations along a round trip: the undo's before it runs, the redo's after it. */
async function confirms(w) {
  const undo = (await w.state()).undo.confirm;
  await w.undo();
  const redo = (await w.state()).redo.confirm;
  await w.redo();
  return { undo, redo };
}

// Invariant: a plain save undoes into the changes it took (staged stays staged, unstaged unstaged, the stash gone) and
// redoes into the same stash entry; neither direction asks.
test('stash.push: tracked changes, staged and unstaged', async (t) => {
  const w = await undoWorld(t);
  w.repo.write('f.txt', 'unstaged\n');
  w.repo.write('g.txt', 'new, staged\n');
  w.repo.git('add', 'g.txt');
  const { state, result } = await roundTrip(w, () => w.op('stash.push', {}));
  assert.equal(state.undo.label, 'Stash changes');
  assert.equal(stashes(w)[0].split(' ')[0], result.oid, 'redo stored the same entry');
  assert.deepEqual(await confirms(w), { undo: null, redo: null });
});

// Invariant: a save with a message and untracked files in a nested directory undoes the files back (directories
// included) and redoes them away; the label quotes the message.
test('stash.push: a message and includeUntracked with a nested untracked directory', async (t) => {
  const w = await undoWorld(t);
  w.repo.write('f.txt', 'changed\n');
  w.repo.write('n/e/s/t.txt', 'deep\n');
  w.repo.write('top.txt', 'top\n');
  const { state } = await roundTrip(w, () => w.op('stash.push', { message: 'wip', includeUntracked: true }));
  assert.equal(state.undo.label, 'Stash “wip”');
});

// Invariant: keepIndex leaves the staged change in index and worktree; undo and redo reproduce both sides exactly.
test('stash.push: keepIndex', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'g.txt': 'g\n' }, 'g');
  w.repo.write('f.txt', 'staged\n');
  w.repo.git('add', 'f.txt');
  w.repo.write('g.txt', 'unstaged\n');
  await roundTrip(w, () => w.op('stash.push', { keepIndex: true }));
});

// Invariant: a staged-only save undoes into the staged change and leaves the unstaged one as it was.
test('stash.push: staged only', async (t) => {
  const w = await undoWorld(t);
  if (!atLeast(w, [2, 35])) return t.skip('stash push --staged needs git 2.35');
  w.repo.commit({ 'g.txt': 'g\n' }, 'g');
  w.repo.write('f.txt', 'staged\n');
  w.repo.git('add', 'f.txt');
  w.repo.write('g.txt', 'unstaged, kept\n');
  await roundTrip(w, () => w.op('stash.push', { staged: true }));
});

// Invariant: a save of some paths only undoes and redoes those paths; the others keep their changes throughout.
test('stash.push: a subset of paths, one of them a directory', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'g.txt': 'g\n', 'd/one.txt': '1\n', 'd/two.txt': '2\n' }, 'more');
  w.repo.write('f.txt', 'kept\n');
  w.repo.write('g.txt', 'stashed\n');
  w.repo.write('d/two.txt', 'stashed too\n');
  w.repo.write('d/new.txt', 'untracked, stashed\n');
  await roundTrip(w, () => w.op('stash.push', { paths: ['g.txt', 'd'], includeUntracked: true }));
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'f.txt'), 'utf8'), 'kept\n');
});

// Invariant: an exec bit set on a tracked file and an untracked symlink come back exactly (mode and link target).
test('stash.push: an exec-bit change and an untracked symlink', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'run.sh': 'echo hi\n' }, 'script');
  fs.chmodSync(path.join(w.repo.dir, 'run.sh'), 0o755);
  fs.symlinkSync('f.txt', path.join(w.repo.dir, 'link'));
  const { before } = await roundTrip(w, () => w.op('stash.push', { includeUntracked: true }));
  assert.deepEqual([before.files.link, before.files['run.sh'].exec], [{ link: 'f.txt' }, true], 'the state undo restored has both');
});

// Invariant: a line save undoes by putting the lines back and dropping its stash, and redoes by storing the same entry
// and taking the lines out again; neither direction asks (the lines are in a stash, not discarded).
test('stash.pushLines', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'l.txt': text(nums(30)) }, 'lines');
  w.repo.write('l.txt', text(nums(30).map((l, i) => (i === 1 ? 'L2' : i === 24 ? 'L25' : l))));
  const fd = await w.op('diff.file', { source: { kind: 'unstaged' }, path: 'l.txt', context: 3, whitespace: 'none' });
  const h = fd.hunks[0];
  const hunks = [{ header: h.header, lines: h.lines.flatMap((l, i) => (l.kind === 'context' ? [] : [{ index: i, text: l.text }])) }];
  const { state } = await roundTrip(w, () => w.op('stash.pushLines', { path: 'l.txt', context: 3, hunks }));
  assert.equal(state.undo.label, 'Stash lines in l.txt');
  assert.deepEqual(await confirms(w), { undo: null, redo: null });
});

// Invariant: a clean pop undoes into the stash back on the list and the worktree and index as they were, and redoes
// into the popped state; neither direction asks.
test('stash.pop: clean, without index', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'g.txt': 'g\n' }, 'g');
  const oid = saved(w, { 'f.txt': 'stashed\n', 'u.txt': 'untracked\n' }, ['-u', '-m', 'mine']);
  w.repo.write('g.txt', 'a local change elsewhere\n');
  const { state } = await roundTrip(w, () => w.op('stash.pop', { oid }));
  assert.equal(state.undo.label, 'Pop “On main: mine”');
  assert.deepEqual(await confirms(w), { undo: null, redo: null });
});

// Invariant: a pop with its index restores the staged part exactly both ways.
test('stash.pop: clean, with index', async (t) => {
  const w = await undoWorld(t);
  w.repo.write('g.txt', 'staged new file\n');
  w.repo.git('add', 'g.txt');
  const oid = saved(w, { 'f.txt': 'unstaged\n' });
  await roundTrip(w, () => w.op('stash.pop', { oid, index: true }));
});

// Invariant: a pop whose drop met STASH_MOVED (both stashes kept) still records a worktree-only plan: its undo restores
// the worktree and index as they were before the pop and leaves the stash list alone; its redo is exact.
test('stash.pop: the drop raced (STASH_MOVED): the worktree part alone undoes and redoes', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'g.txt': 'g\n' }, 'g');
  const oid = saved(w, { 'f.txt': 'stashed\n' });
  const before = w.snap();
  w.cc.state.execHook = (body) => (body.argv.includes('drop') ? 'hold' : undefined);
  const popping = w.op('stash.pop', { oid });
  const held = await w.cc.nextHeld();
  w.repo.write('g.txt', 'raced\n');
  w.repo.git('stash', 'push', '-q', '-m', 'raced', '--', 'g.txt');
  w.cc.state.execHook = null;
  held.release();
  assert.equal((await popping).dropError, 'STASH_MOVED');
  const after = w.snap();
  assert.equal(stashes(w).length, 2, 'both entries still listed');
  await w.undo();
  const undone = w.snap();
  assert.deepEqual({ head: undone.head, index: undone.index, files: undone.files }, { head: before.head, index: before.index, files: before.files });
  assert.equal(undone.stashes, after.stashes, 'the stash list is not the plan\'s');
  await w.redo();
  assert.deepEqual(w.snap(), after);
});

// Invariant: dropping the top entry undoes into exactly the same list; the redo asks first (dropsStashes, the message).
test('stash.drop: the top entry comes back in place', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' }, ['-m', 'top']);
  const { state } = await roundTrip(w, () => w.op('stash.drop', { oid }));
  assert.equal(state.undo.label, 'Drop stash “On main: top”');
  assert.deepEqual(await confirms(w), { undo: null, redo: { kind: 'dropsStashes', messages: ['On main: top'] } });
});

// Invariant (R1): dropping stash@{2} undoes into the same oid and message at stash@{0}; the redo drops it again and the
// list is exactly the one after the drop.
test('stash.drop: an older entry comes back at stash@{0} (R1); redo is exact', async (t) => {
  const w = await undoWorld(t);
  const old = saved(w, { 'f.txt': 'one\n' }, ['-m', 'one']);
  saved(w, { 'f.txt': 'two\n' }, ['-m', 'two']);
  saved(w, { 'f.txt': 'three\n' }, ['-m', 'three']);
  const before = stashes(w);
  assert.equal(before[2], `${old} On main: one`);
  await w.op('stash.drop', { oid: old });
  const after = w.snap();
  await w.undo();
  assert.deepEqual(stashes(w), [before[2], before[0], before[1]]);
  await w.redo();
  assert.deepEqual(w.snap(), after);
});

// Invariant: a rename undoes into the original entry (the copy dropped) and redoes into the same copy.
test('stash.rename', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' }, ['-m', 'old name']);
  const { state, result } = await roundTrip(w, () => w.op('stash.rename', { oid, message: 'new name' }));
  assert.equal(state.undo.label, 'Rename stash to “new name”');
  assert.equal(stashes(w)[0].split(' ')[0], result.oid);
  assert.deepEqual(await confirms(w), { undo: null, redo: null });
});

// Invariant: applying one tracked file of a stash undoes by reversing its patch and redoes by applying it again.
test('stash.applyFile: a tracked file', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'from the stash\n' });
  const { state } = await roundTrip(w, () => w.op('stash.applyFile', { oid, path: 'f.txt' }));
  assert.equal(state.undo.label, 'Apply f.txt from stash');
  assert.deepEqual(await confirms(w), { undo: null, redo: null });
});

// Invariant: applying one untracked file of a stash undoes by deleting it and redoes by creating it again.
test('stash.applyFile: an untracked file', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'tracked part\n', 'u/new.txt': 'untracked part\n' }, ['-u']);
  await roundTrip(w, () => w.op('stash.applyFile', { oid, path: 'u/new.txt' }));
});

// Invariant: a branch from a stash, with a local change carried across the switch and the stash dropped, undoes into
// the old branch with that change, the stash back, the branch deleted (asked first: deletesRefs) — and redoes exactly.
test('stash.branch: local changes carried across the switch, the stash dropped', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'h.txt': 'h\n' }, 'h');
  const oid = saved(w, { 'f.txt': 'stashed\n' }, ['-m', 'for a branch']);
  w.repo.commit({ 'g.txt': 'g\n' }, 'later');
  w.repo.write('h.txt', 'carried\n');
  const { result, state } = await roundTrip(w, () => w.op('stash.branch', { oid, name: 'from-stash' }));
  assert.equal(result.dropped, true);
  assert.equal(state.undo.label, 'Create branch from-stash from stash');
  assert.deepEqual(await confirms(w), { undo: { kind: 'deletesRefs', refs: ['refs/heads/from-stash'] }, redo: null });
});
