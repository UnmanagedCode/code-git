import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv } from './_git.js';
import { refused } from './_refsWorld.js';
import { undoWorld } from './_undoWorld.js';

// D3: an undo of an op that created commits is refused UNDO_PUSHED when any created commit is reachable from any
// remote-tracking ref (as the refs are, no fetch); the commits it did not create never count.

const stage = (w, files) => { for (const [f, c] of Object.entries(files)) w.repo.write(f, c); w.repo.git('add', '-A'); };

// Invariant: a commit pushed to its upstream cannot be undone; the refusal names the remote refs; the slots are cleared.
test('a commit already on origin: UNDO_PUSHED naming origin/main, nothing moves, the slots are cleared', async (t) => {
  const w = await undoWorld(t);
  stage(w, { 'n.txt': 'n\n' });
  const { oid } = await w.op('commit.create', { summary: 'n' });
  w.repo.git('push', '-q', 'origin', 'main');
  await assert.rejects(w.undo(), refused('UNDO_PUSHED', { refs: ['refs/remotes/origin/main'], oid }));
  assert.equal(w.oid('HEAD'), oid);
  assert.deepEqual(await w.state(), { undo: null, redo: null });
});

// Invariant: "pushed" is any remote-tracking ref, not the upstream: a branch with no upstream pushed to a second remote.
test('a commit pushed to a second remote from a branch with no upstream: UNDO_PUSHED', async (t) => {
  const w = await undoWorld(t);
  const mirror = path.join(w.repo.root, 'mirror.git');
  execFileSync('git', ['init', '-q', '--bare', mirror], { env: hermeticEnv(w.repo.home) });
  w.repo.git('remote', 'add', 'mirror', mirror);
  w.repo.git('switch', '-q', '-c', 'loose');
  stage(w, { 'l.txt': 'l\n' });
  await w.op('commit.create', { summary: 'loose' });
  w.repo.git('push', '-q', 'mirror', 'loose');
  assert.throws(() => w.repo.git('rev-parse', '--abbrev-ref', 'loose@{upstream}'));
  await assert.rejects(w.undo(), refused('UNDO_PUSHED', { refs: ['refs/remotes/mirror/loose'] }));
});

// Invariant: one created commit on a remote is enough: a rebase whose first rewritten commit alone was pushed.
test('a rebase whose first rewritten commit alone is on a remote: UNDO_PUSHED', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'feature');
  w.repo.commit({ 'f1.txt': '1\n' }, 'f1');
  const f2 = w.repo.commit({ 'f2.txt': '2\n' }, 'f2');
  w.repo.git('switch', '-q', 'main');
  const m = w.repo.commit({ 'm.txt': 'm\n' }, 'm');
  w.repo.git('switch', '-q', 'feature');
  await w.op('rebase.start', { onto: m, upstream: w.base, expect: f2 });
  const first = w.oid('HEAD~1');
  w.repo.git('push', '-q', 'origin', `${first}:refs/heads/partial`);
  await assert.rejects(w.undo(), refused('UNDO_PUSHED', { refs: ['refs/remotes/origin/partial'], oid: first }));
});

/** origin/main moves on (o1) from elsewhere and is fetched; main gets a commit of its own (l1). */
function diverged(w) {
  w.repo.git('switch', '-q', '-c', 'tmp');
  const o1 = w.repo.commit({ 'o.txt': 'o\n' }, 'o1');
  w.repo.git('push', '-q', 'origin', 'tmp:main');
  w.repo.git('switch', '-q', 'main');
  w.repo.git('branch', '-D', 'tmp');
  w.repo.git('fetch', '-q', 'origin');
  return o1;
}

// Invariant: merging origin/main is undoable: the merged-in commits are on the remote, the merge commit is not.
test('a merge of origin/main (its commits pushed, the merge commit not) is undone', async (t) => {
  const w = await undoWorld(t);
  const o1 = diverged(w);
  const l1 = w.repo.commit({ 'l.txt': 'l\n' }, 'l1');
  const r = await w.op('merge.start', { ref: 'refs/remotes/origin/main', oid: o1, mode: 'noFf', expect: l1 });
  assert.equal(r.outcome, 'merged');
  await w.undo();
  assert.equal(w.oid('HEAD'), l1);
});

// Invariant: a merge concluded by commit.create counts MERGE_HEAD's side as not its own, so it is undoable too.
test('a merge of origin/main stopped on conflicts and concluded by commit.create is undone', async (t) => {
  const w = await undoWorld(t);
  const o1 = diverged(w);
  const l1 = w.repo.commit({ 'o.txt': 'local\n' }, 'l1');
  const r = await w.op('merge.start', { ref: 'refs/remotes/origin/main', oid: o1, mode: 'noFf', expect: l1 });
  assert.equal(r.outcome, 'conflicts');
  stage(w, { 'o.txt': 'resolved\n' });
  await w.op('commit.create', { summary: 'merge origin/main' });
  await w.undo();
  assert.equal(w.oid('HEAD'), l1);
});

// Invariant: a fast-forward creates no commit, so landing on a pushed commit never counts as pushed.
test('a fast-forward onto a commit that is on the remote is undone', async (t) => {
  const w = await undoWorld(t);
  const o1 = diverged(w);
  const r = await w.op('merge.start', { ref: 'refs/remotes/origin/main', oid: o1, mode: 'ff', expect: w.base });
  assert.equal(r.outcome, 'fastForward');
  await w.undo();
  assert.equal(w.oid('HEAD'), w.base);
});

// Invariant: an amend after a push is undoable: the amended commit is new; its undo restores the pushed one.
test('an amend of a pushed commit is undone back to the pushed commit', async (t) => {
  const w = await undoWorld(t);
  const pushed = w.repo.commit({ 'p.txt': 'p\n' }, 'p');
  w.repo.git('push', '-q', 'origin', 'main');
  stage(w, { 'p.txt': 'p2\n' });
  await w.op('commit.create', { summary: 'p amended', amend: true });
  await w.undo();
  assert.equal(w.oid('HEAD'), pushed);
});

// Invariant: an op that creates no commits is never refused as pushed, even when its commits are all on the remote.
test('a branch delete of a fully pushed branch is undone (no created commits, no pushed check)', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'pushed');
  w.repo.git('push', '-q', 'origin', 'pushed');
  await w.op('branch.delete', { names: ['pushed'] });
  await w.undo();
  assert.equal(w.oid('pushed'), w.base);
});
