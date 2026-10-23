import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { roundTrip, undoWorld } from './_undoWorld.js';

// Every registered op: do → undo restores the state before exactly (HEAD, every ref, the index, the worktree's files and
// modes, the branch config) → redo restores the state after exactly.

const stage = (w, files) => { for (const [f, c] of Object.entries(files)) w.repo.write(f, c); w.repo.git('add', '-A'); };

// Invariant: a commit's undo moves HEAD's branch back with the index kept (the commit's changes staged again); redo re-commits.
test('commit.create: a commit', async (t) => {
  const w = await undoWorld(t);
  stage(w, { 'n.txt': 'n\n' });
  const { state } = await roundTrip(w, () => w.op('commit.create', { summary: 'add n' }));
  assert.equal(state.undo.label, 'Commit “add n”');
  assert.equal(state.undo.confirm, null, 'a commit undoes without asking');
});

// Invariant: an amend's undo restores the amended commit with the amended-in change staged again.
test('commit.create: amend, and message-only amend keeping what else is staged', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'a.txt': 'a\n' }, 'a');
  stage(w, { 'a.txt': 'a2\n' });
  const amend = await roundTrip(w, () => w.op('commit.create', { summary: 'a amended', amend: true }));
  assert.equal(amend.state.undo.label, 'Amend “a amended”');
  stage(w, { 'other.txt': 'staged, not amended\n' });
  const reword = await roundTrip(w, () => w.op('commit.create', { summary: 'reworded', amend: true, messageOnly: true }));
  assert.equal(reword.state.undo.label, 'Reword “reworded”');
  assert.match(w.repo.git('diff', '--cached', '--name-only'), /other\.txt/);
});

// Invariant: the first commit on an unborn branch undoes by deleting the branch ref (HEAD stays on it), confirmed.
test('commit.create: the first commit on an unborn branch', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '--orphan', 'fresh');
  stage(w, { 'first.txt': 'first\n' });
  const { state } = await roundTrip(w, () => w.op('commit.create', { summary: 'first' }));
  assert.deepEqual(state.undo.confirm, { kind: 'deletesRefs', refs: ['refs/heads/fresh'] });
});

// Invariant: a local checkout undoes by switching back to the branch it left.
test('branch.checkout: a local branch', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'feature');
  w.repo.git('-C', w.repo.dir, 'commit', '-q', '--allow-empty', '-m', 'main moves on');
  const { state } = await roundTrip(w, () => w.op('branch.checkout', { ref: 'refs/heads/feature' }));
  assert.equal(state.undo.label, 'Checkout feature');
});

// Invariant: checking out a remote branch as a new tracking branch undoes by switching back and deleting the branch and
// its config (confirmed); redo recreates it with its upstream.
test('branch.checkout: a remote branch becomes a tracking branch', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'feat');
  w.repo.commit({ 'feat.txt': '1\n' }, 'feat');
  w.repo.git('push', '-q', 'origin', 'feat');
  w.repo.git('switch', '-q', 'main');
  w.repo.git('branch', '-D', 'feat');
  const { state } = await roundTrip(w, () => w.op('branch.checkout', { ref: 'refs/remotes/origin/feat' }));
  assert.deepEqual(state.undo.confirm, { kind: 'deletesRefs', refs: ['refs/heads/feat'] });
  assert.equal(w.repo.git('config', 'branch.feat.merge'), 'refs/heads/feat');
});

// Invariant: a remote checkout that switched and fast-forwarded the local twin undoes both: the switch back, the twin's tip back.
test('branch.checkout: a remote branch whose tracking twin is switched to and fast-forwarded', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'feat');
  w.repo.commit({ 'feat.txt': '1\n' }, 'feat1');
  w.repo.git('push', '-q', '-u', 'origin', 'feat');
  w.repo.commit({ 'feat.txt': '2\n' }, 'feat2');
  w.repo.git('push', '-q', 'origin', 'feat');
  w.repo.git('reset', '-q', '--hard', 'HEAD~1');
  w.repo.git('switch', '-q', 'main');
  const { result } = await roundTrip(w, () => w.op('branch.checkout', { ref: 'refs/remotes/origin/feat' }));
  assert.equal(result.fastForwarded, true);
});

// Invariant: discarding tracked and untracked files undoes from the snapshot — content, an exec bit, a symlink, a
// deletion and an untracked file all come back; redo (confirmed) discards them again.
test('stage.discardFiles: tracked, untracked, an exec-bit change, a symlink and a deleted file', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'a.txt': 'a\n', 'run.sh': 'echo\n', 'gone.txt': 'gone\n', 'dir/deep.txt': 'deep\n' }, 'files');
  w.repo.write('a.txt', 'a changed\n');
  fs.chmodSync(path.join(w.repo.dir, 'run.sh'), 0o755);
  fs.rmSync(path.join(w.repo.dir, 'gone.txt'));
  w.repo.write('dir/deep.txt', 'deep changed\n');
  w.repo.write('new.txt', 'untracked\n');
  fs.symlinkSync('a.txt', path.join(w.repo.dir, 'link'));
  const tracked = ['a.txt', 'run.sh', 'gone.txt', 'dir/deep.txt'];
  const untracked = ['new.txt', 'link'];
  const { state } = await roundTrip(w, () => w.op('stage.discardFiles', { tracked, untracked }));
  assert.equal(state.undo.label, 'Discard 6 files');
  assert.equal((await w.state()).undo.confirm, null);
  await w.undo();
  assert.deepEqual((await w.state()).redo.confirm, { kind: 'discards', paths: [...tracked, ...untracked] });
});

// Invariant: discarding selected lines undoes by applying the patch forward onto the worktree; redo takes them out again.
test('stage.discardLines', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'l.txt': 'one\ntwo\nthree\n' }, 'lines');
  w.repo.write('l.txt', 'one\nTWO\nthree\nfour\n');
  const fd = await w.op('diff.file', { source: { kind: 'unstaged' }, path: 'l.txt', context: 3, whitespace: 'none' });
  const h = fd.hunks[0];
  // Only "four": TWO stays.
  const i = h.lines.findIndex((l) => l.kind === 'add' && l.text === 'four');
  const { state } = await roundTrip(w, () => w.op('stage.discardLines', { path: 'l.txt', context: 3, hunks: [{ header: h.header, lines: [{ index: i, text: 'four' }] }] }));
  assert.equal(state.undo.label, 'Discard lines in l.txt');
});

// Invariant: a deleted branch comes back at its tip with its upstream; redo deletes it again (confirmed).
test('branch.delete: a branch with an upstream', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'gone');
  w.repo.commit({ 'g.txt': 'g\n' }, 'g');
  w.repo.git('push', '-q', '-u', 'origin', 'gone');
  w.repo.git('switch', '-q', 'main');
  await roundTrip(w, () => w.op('branch.delete', { names: ['gone'], force: true }));
  await w.undo();
  assert.deepEqual((await w.state()).redo.confirm, { kind: 'deletesRefs', refs: ['refs/heads/gone'] });
});

// Invariant: a deleted symbolic ref comes back as the same symbolic ref (its target untouched); redo deletes only the alias.
test('branch.delete: a symbolic ref', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'target');
  w.repo.git('symbolic-ref', 'refs/heads/alias', 'refs/heads/target');
  const { state } = await roundTrip(w, () => w.op('branch.delete', { names: ['alias'] }));
  await w.undo();
  assert.equal(w.repo.git('symbolic-ref', 'refs/heads/alias'), 'refs/heads/target');
  assert.equal(state.undo.label, 'Delete branch alias');
});

// Invariant: a created branch undoes by deletion (confirmed); with checkout, undo switches back first.
test('branch.create, with and without checkout', async (t) => {
  const w = await undoWorld(t);
  const plain = await roundTrip(w, () => w.op('branch.create', { name: 'side' }));
  assert.deepEqual(plain.state.undo.confirm, { kind: 'deletesRefs', refs: ['refs/heads/side'] });
  const co = await roundTrip(w, () => w.op('branch.create', { name: 'work', checkout: true }));
  assert.equal(co.state.undo.label, 'Create branch work and check it out');
});

// Invariant: a rename of this checkout's branch undoes with `branch -m` back: HEAD and the config follow.
test('branch.rename: this checkout\'s own branch', async (t) => {
  const w = await undoWorld(t);
  await roundTrip(w, () => w.op('branch.rename', { name: 'main', newName: 'trunk' }));
});

// Invariant: a moved branch (checked out nowhere) goes back with a compare-and-swap.
test('branch.move', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'free');
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  await roundTrip(w, () => w.op('branch.move', { name: 'free', to: two, expect: w.base }));
});

// Invariant: a fast-forward undoes — a free branch by compare-and-swap, this checkout's branch with reset --keep.
test('branch.fastForward: a free branch and this checkout\'s own', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'free');
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  await roundTrip(w, () => w.op('branch.fastForward', { name: 'free', to: two, expect: w.base }));
  w.repo.git('switch', '-q', 'free');
  w.repo.git('reset', '-q', '--hard', w.base);
  await roundTrip(w, () => w.op('branch.fastForward', { name: 'free', to: two, expect: w.base }));
});

// Invariant: tag create undoes by deletion (confirmed); a deleted annotated tag comes back as the same tag object.
test('tag.create and tag.delete: an annotated tag keeps its message', async (t) => {
  const w = await undoWorld(t);
  const created = await roundTrip(w, () => w.op('tag.create', { name: 'v1', oid: w.base, message: 'release one\n' }));
  assert.deepEqual(created.state.undo.confirm, { kind: 'deletesRefs', refs: ['refs/tags/v1'] });
  const object = w.oid('refs/tags/v1');
  await roundTrip(w, () => w.op('tag.delete', { names: ['v1'] }));
  await w.undo();
  assert.equal(w.oid('refs/tags/v1'), object);
  assert.equal(w.repo.git('tag', '-l', '--format=%(contents)', 'v1'), 'release one');
});

/** main: base ← g (adds g.txt) ← two (f.txt "two"). */
function resetCommits(w) {
  w.repo.commit({ 'g.txt': 'g\n' }, 'g');
  return w.repo.commit({ 'f.txt': 'two\n' }, 'two');
}

// Invariant: a soft reset undoes and redoes with only the branch moving.
test('head.reset soft', async (t) => {
  const w = await undoWorld(t);
  const two = resetCommits(w);
  await roundTrip(w, () => w.op('head.reset', { to: w.base, mode: 'soft', expect: two }));
});

// Invariant: a mixed reset's undo restores the index it rewrote — a staged/unstaged split comes back as it was.
test('head.reset mixed: the staged/unstaged split comes back', async (t) => {
  const w = await undoWorld(t);
  const two = resetCommits(w);
  stage(w, { 'f.txt': 'staged\n' });
  w.repo.write('f.txt', 'staged\nand unstaged\n');
  await roundTrip(w, () => w.op('head.reset', { to: w.base, mode: 'mixed', expect: two }));
});

// Invariant: a hard reset's undo restores the discarded staged and unstaged changes from its snapshot; both ways confirm.
test('head.reset hard: the snapshot comes back, staged and unstaged', async (t) => {
  const w = await undoWorld(t);
  const two = resetCommits(w);
  stage(w, { 'f.txt': 'staged\n', 'added.txt': 'staged new file\n' });
  w.repo.write('f.txt', 'staged\nand unstaged\n');
  w.repo.write('untouched.txt', 'untracked stays\n');
  const { state } = await roundTrip(w, () => w.op('head.reset', { to: w.base, mode: 'hard', expect: two }));
  assert.deepEqual(state.undo.confirm, { kind: 'resetHard' });
  await w.undo();
  assert.deepEqual((await w.state()).redo.confirm, { kind: 'resetHard' });
});

/** feature: base ← f1 ← f2; main: base ← m. */
function divergent(w) {
  w.repo.git('switch', '-q', '-c', 'feature');
  const f1 = w.repo.commit({ 'f1.txt': '1\n' }, 'f1');
  const f2 = w.repo.commit({ 'f2.txt': '2\n' }, 'f2');
  w.repo.git('switch', '-q', 'main');
  const m = w.repo.commit({ 'm.txt': 'm\n' }, 'm');
  return { f1, f2, m };
}

// Invariant: a rebase undoes with reset --keep to the branch's old tip, and redoes to the rebased tip.
test('rebase.start', async (t) => {
  const w = await undoWorld(t);
  const { f2, m } = divergent(w);
  w.repo.git('switch', '-q', 'feature');
  await roundTrip(w, () => w.op('rebase.start', { onto: m, upstream: w.base, expect: f2 }));
});

// Invariant: an interactive rebase undoes in both modes — rebase (rewriting the branch) and pick (adding onto HEAD).
test('rebase.interactive: rebase mode and pick mode', async (t) => {
  const w = await undoWorld(t);
  const { f1, f2, m } = divergent(w);
  w.repo.git('switch', '-q', 'feature');
  await roundTrip(w, () => w.op('rebase.interactive', {
    mode: 'rebase', base: w.base, onto: w.base, expect: f2, rows: [{ oid: f2, action: 'pick' }, { oid: f1, action: 'pick' }],
  }));
  w.repo.git('switch', '-q', 'main');
  const pick = await roundTrip(w, () => w.op('rebase.interactive', {
    mode: 'pick', base: m, onto: m, expect: m, rows: [{ oid: f1, action: 'pick', message: { summary: 'both', description: '' } }, { oid: f2, action: 'squash' }],
  }));
  assert.equal(pick.state.undo.label, 'Cherry-pick 2 commits');
});

// Invariant: a cherry-pick and a revert undo with reset --keep to HEAD before.
test('head.cherryPick and head.revert', async (t) => {
  const w = await undoWorld(t);
  const { f1 } = divergent(w);
  const pick = await roundTrip(w, () => w.op('head.cherryPick', { oid: f1 }));
  assert.equal(pick.state.undo.label, `Cherry-pick ${f1.slice(0, 7)}`);
  const m = w.oid('HEAD~1');
  await roundTrip(w, () => w.op('head.revert', { oid: m }));
});

// Invariant: a fast-forward merge and a merge commit both undo to HEAD before.
test('merge.start: fast-forward and merged', async (t) => {
  const w = await undoWorld(t);
  const { f2 } = divergent(w);
  const merged = await roundTrip(w, () => w.op('merge.start', { ref: 'refs/heads/feature', oid: f2, mode: 'ff', expect: w.oid('HEAD') }));
  assert.equal(merged.result.outcome, 'merged');
  assert.equal(merged.state.undo.label, 'Merge feature');
  w.repo.git('switch', '-q', 'feature');
  w.repo.git('branch', 'behind', w.base);
  w.repo.git('switch', '-q', 'behind');
  const ff = await roundTrip(w, () => w.op('merge.start', { ref: 'refs/heads/feature', oid: f2, mode: 'ff', expect: w.base }));
  assert.equal(ff.result.outcome, 'fastForward');
});

/** main: base ← c (f.txt "main"); side: base ← s (f.txt "side"); HEAD main. */
function conflicting(w) {
  w.repo.git('switch', '-q', '-c', 'side');
  const s = w.repo.commit({ 'f.txt': 'side\n' }, 'side');
  w.repo.git('switch', '-q', 'main');
  w.repo.commit({ 'f.txt': 'main\n' }, 'main');
  return s;
}

// Invariant: an operation finished by head.continue undoes to before the whole operation, and redoes to its end.
test('head.continue done: a cherry-pick resolved and continued', async (t) => {
  const w = await undoWorld(t);
  const s = conflicting(w);
  const start = w.snap();
  const stopped = await w.op('head.cherryPick', { oid: s });
  assert.equal(stopped.conflicts, true);
  assert.deepEqual(await w.state(), { undo: null, redo: null }, 'a stop records nothing');
  stage(w, { 'f.txt': 'resolved\n' });
  const done = await w.op('head.continue', { which: 'cherry-pick' });
  assert.equal(done.outcome, 'done');
  const end = w.snap();
  await w.undo();
  assert.deepEqual(w.snap(), start);
  await w.redo();
  assert.deepEqual(w.snap(), end);
});

// Invariant: a rebase finished by head.skip undoes to the branch before the rebase.
test('head.skip done: a rebase whose conflicting commit is skipped', async (t) => {
  const w = await undoWorld(t);
  const s = conflicting(w);
  w.repo.git('switch', '-q', 'side');
  w.repo.commit({ 'later.txt': 'later\n' }, 'later');
  const start = w.snap();
  const main = w.oid('main');
  const stopped = await w.op('rebase.start', { onto: main, upstream: w.base, expect: w.oid('HEAD') });
  assert.equal(stopped.outcome, 'conflicts');
  assert.ok(s);
  const done = await w.op('head.skip', { which: 'rebase' });
  assert.equal(done.outcome, 'done');
  const end = w.snap();
  const { undo } = await w.state();
  assert.equal(undo.label, 'Skip in the rebase');
  await w.undo();
  assert.deepEqual(w.snap(), start);
  await w.redo();
  assert.deepEqual(w.snap(), end);
});
