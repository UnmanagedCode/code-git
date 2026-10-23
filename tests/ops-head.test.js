import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const status = (w, dir) => w.repo.git('-C', dir ?? w.repo.dir, 'status', '--porcelain');
const inProgress = (w, ref, dir) => { try { w.repo.git('-C', dir ?? w.repo.dir, 'rev-parse', '--verify', '-q', ref); return true; } catch { return false; } };

/** main: base ← g (adds g.txt) ← two (f.txt "two"). */
async function resetWorld(t) {
  const w = await refsWorld(t);
  w.repo.commit({ 'g.txt': 'g\n' }, 'g');
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  return { ...w, two };
}

test('params: mode is soft/mixed/hard, oids full hex, mainline 1…16, which merge/rebase/cherry-pick/revert (skip: not merge)', () => {
  const r = (name, raw) => assert.throws(() => getOp(OPS, name).params(raw), (e) => ['BAD_PARAMS', 'BAD_REF'].includes(e.code), JSON.stringify(raw));
  const oid = 'a'.repeat(40);
  r('head.reset', { to: oid, expect: oid, mode: 'keep' });
  r('head.reset', { to: 'HEAD', expect: oid, mode: 'soft' });
  r('head.revert', { oid, mainline: 0 });
  r('head.revert', { oid, mainline: 17 });
  r('head.cherryPick', { oid, mainline: '1' });
  r('head.abort', { which: 'am' });
  r('head.abort', { which: 'toString' });
  r('head.continue', { which: 'bisect' });
  r('head.skip', { which: 'merge' });
  r('head.skip', { which: 'rebase', extra: 1 });
  for (const which of ['revert', 'cherry-pick', 'merge', 'rebase']) {
    assert.deepEqual(getOp(OPS, 'head.abort').params({ which }), { which });
    assert.deepEqual(getOp(OPS, 'head.continue').params({ which }), { which });
  }
  for (const which of ['revert', 'cherry-pick', 'rebase']) assert.deepEqual(getOp(OPS, 'head.skip').params({ which }), { which });
});

test('reset soft keeps index and worktree, mixed keeps the worktree only, hard discards both; undo records the branch and HEAD move', async (t) => {
  for (const mode of ['soft', 'mixed', 'hard']) {
    const w = await resetWorld(t);
    const r = await w.op('head.reset', { to: w.base, mode, expect: w.two });
    assert.equal(w.oid('HEAD'), w.base, mode);
    assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/main');
    const staged = w.repo.git('diff', '--cached', '--name-only');
    const unstaged = w.repo.git('diff', '--name-only');
    if (mode === 'soft') assert.deepEqual([staged, unstaged], ['f.txt\ng.txt', '']);
    if (mode === 'mixed') assert.deepEqual([staged, unstaged], ['', 'f.txt']);
    if (mode === 'hard') assert.deepEqual([staged, unstaged, read(w.repo.dir, 'f.txt')], ['', '', 'base\n']);
    assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/main', old: w.two, new: w.base }]);
    assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/main', oid: w.two }, new: { branch: 'refs/heads/main', oid: w.base } });
    const reset = w.argvs().find((a) => a[0] === 'reset');
    assert.equal(reset[1], `--${mode}`);
    endOfOptionsBefore(reset, w.base);
  }
});

test('reset hard records a worktree snapshot holding the discarded tracked change (stash apply brings it back); null when clean; untracked files stay', async (t) => {
  const w = await resetWorld(t);
  w.repo.write('f.txt', 'discarded\n');
  w.repo.write('untracked.txt', 'u\n');
  const r = await w.op('head.reset', { to: w.base, mode: 'hard', expect: w.two });
  assert.equal(read(w.repo.dir, 'untracked.txt'), 'u\n');
  assert.match(r.undo.worktreeSnapshot, /^[0-9a-f]{40}$/);
  w.repo.git('reset', '-q', '--hard', w.two);
  w.repo.git('stash', 'apply', '-q', r.undo.worktreeSnapshot);
  assert.equal(read(w.repo.dir, 'f.txt'), 'discarded\n');
  w.repo.git('reset', '-q', '--hard', w.two);
  const clean = await w.op('head.reset', { to: w.base, mode: 'hard', expect: w.two });
  assert.equal(clean.undo.worktreeSnapshot, null);
  const soft = await w.op('head.reset', { to: w.two, mode: 'soft', expect: w.base });
  assert.equal(soft.undo.worktreeSnapshot, null);
  assert.equal(w.argvs().filter((a) => a[0] === 'stash').length, 2, 'only the hard resets snapshot');
});

test('reset: a stale expect → REF_MOVED, an unborn HEAD → NO_HEAD, a non-commit → REV_UNKNOWN; nothing moves', async (t) => {
  const w = await resetWorld(t);
  await assert.rejects(w.op('head.reset', { to: w.base, mode: 'hard', expect: w.base }), refused('REF_MOVED'));
  await assert.rejects(w.op('head.reset', { to: w.oid('HEAD^{tree}'), mode: 'soft', expect: w.two }), refused('REV_UNKNOWN'));
  assert.equal(w.oid('HEAD'), w.two);
  assert.deepEqual(w.writes(), []);
  w.repo.git('checkout', '-q', '--orphan', 'empty');
  await assert.rejects(w.op('head.reset', { to: w.base, mode: 'soft', expect: w.base }), refused('NO_HEAD'));
});

test('on a code-conductor/* HEAD each reset mode refuses without ccOwned and changes nothing (no stash create, no reset), then runs with it', async (t) => {
  for (const mode of ['soft', 'mixed', 'hard']) {
    const w = await refsWorld(t);
    const wt = w.worktree('wt', 'code-conductor/wt');
    const tip = w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD');
    w.repo.write('../wt/f.txt', 'agent work\n');
    w.repo.git('-C', wt.dir, 'add', 'f.txt');
    w.repo.write('../wt/new.txt', 'n\n');
    w.repo.git('-C', wt.dir, 'add', 'new.txt');
    w.repo.git('-C', wt.dir, 'commit', '-q', '-m', 'agent');
    const agent = w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD');
    w.repo.write('../wt/f.txt', 'uncommitted\n');
    const before = status(w, wt.dir);
    await assert.rejects(w.op('head.reset', { to: tip, mode, expect: agent }, 'wt'), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/wt'], head: true }), mode);
    assert.deepEqual(w.writes(), [], mode);
    assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD'), agent);
    assert.equal(status(w, wt.dir), before);
    await w.op('head.reset', { to: tip, mode, expect: agent, ccOwned: true }, 'wt');
    assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD'), tip, mode);
  }
});

test('revert and cherry-pick on a code-conductor/* HEAD need no ccOwned', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '-b', 'side');
  const s = w.repo.commit({ 's.txt': 's\n' }, 's');
  w.repo.git('checkout', '-q', 'main');
  const wt = w.worktree('wt', 'code-conductor/wt');
  const picked = await w.op('head.cherryPick', { oid: s }, 'wt');
  assert.equal(read(wt.dir, 's.txt'), 's\n');
  await w.op('head.revert', { oid: picked.oid }, 'wt');
  assert.equal(fs.existsSync(path.join(wt.dir, 's.txt')), false);
});

test('revert clean makes a new commit; a conflicting revert stops with {conflicts, files} and head.abort restores HEAD', async (t) => {
  const w = await refsWorld(t);
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  const r = await w.op('head.revert', { oid: two });
  assert.equal(r.conflicts, false);
  assert.equal(r.oid, w.oid('HEAD'));
  assert.equal(w.repo.git('log', '-1', '--format=%P'), two);
  assert.equal(read(w.repo.dir, 'f.txt'), 'base\n');
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/main', old: two, new: r.oid }]);
  endOfOptionsBefore(w.argvs().find((a) => a[0] === 'revert'), two);
  // Reverting `two` again now conflicts with the revert.
  const three = w.repo.commit({ 'f.txt': 'three\n' }, 'three');
  const c = await w.op('head.revert', { oid: two });
  assert.deepEqual([c.conflicts, c.files, c.oid], [true, ['f.txt'], null]);
  assert.equal(inProgress(w, 'REVERT_HEAD'), true);
  const a = await w.op('head.abort', { which: 'revert' });
  assert.equal(inProgress(w, 'REVERT_HEAD'), false);
  assert.equal(w.oid('HEAD'), three);
  assert.equal(read(w.repo.dir, 'f.txt'), 'three\n');
  assert.deepEqual(a.undo.head.new, { branch: 'refs/heads/main', oid: three });
});

test('cherry-pick clean; a conflicting pick stops with its files; a local change git would overwrite → CHECKOUT_CONFLICT', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '-b', 'side');
  const s = w.repo.commit({ 's.txt': 's\n' }, 's');
  const sf = w.repo.commit({ 'f.txt': 'side\n' }, 'sf');
  w.repo.git('checkout', '-q', 'main');
  const main2 = w.repo.commit({ 'f.txt': 'main\n' }, 'main2');
  const r = await w.op('head.cherryPick', { oid: s });
  assert.equal(r.conflicts, false);
  assert.equal(read(w.repo.dir, 's.txt'), 's\n');
  assert.equal(w.repo.git('log', '-1', '--format=%P'), main2);
  w.repo.write('f.txt', 'dirty\n');
  await assert.rejects(w.op('head.cherryPick', { oid: sf }), refused('CHECKOUT_CONFLICT', { files: ['f.txt'] }));
  assert.equal(inProgress(w, 'CHERRY_PICK_HEAD'), false);
  w.repo.git('checkout', '-q', 'f.txt');
  const c = await w.op('head.cherryPick', { oid: sf });
  assert.deepEqual([c.conflicts, c.files], [true, ['f.txt']]);
  await w.op('head.abort', { which: 'cherry-pick' });
  assert.equal(w.oid('HEAD'), r.oid);
});

test('an empty cherry-pick (or revert) → PICK_EMPTY, with no operation left in progress', async (t) => {
  const w = await refsWorld(t);
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  w.repo.git('checkout', '-q', '-b', 'dup', w.base);
  w.repo.commit({ 'f.txt': 'two\n' }, 'same change');
  await assert.rejects(w.op('head.cherryPick', { oid: two }), refused('PICK_EMPTY'));
  assert.equal(inProgress(w, 'CHERRY_PICK_HEAD'), false);
  assert.equal(status(w), '');
  w.repo.git('checkout', '-q', 'main');
  await w.op('head.revert', { oid: two });
  await assert.rejects(w.op('head.revert', { oid: two }), refused('PICK_EMPTY'));
  assert.equal(inProgress(w, 'REVERT_HEAD'), false);
});

test('a merge commit needs mainline: without it git refuses, with mainline 1 it reverts against the first parent', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '-b', 'side');
  w.repo.commit({ 's.txt': 's\n' }, 's');
  w.repo.git('checkout', '-q', 'main');
  w.repo.commit({ 'm.txt': 'm\n' }, 'm');
  w.repo.git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const merge = w.oid('HEAD');
  await assert.rejects(w.op('head.revert', { oid: merge }), refused('GIT_FAILED'));
  assert.equal(w.oid('HEAD'), merge);
  const r = await w.op('head.revert', { oid: merge, mainline: 1 });
  assert.equal(r.conflicts, false);
  assert.equal(fs.existsSync(path.join(w.repo.dir, 's.txt')), false);
  assert.ok(w.argvs().find((a) => a[0] === 'revert' && a.includes('-m')).join(' ').includes('-m 1 --end-of-options'));
});

test('head.abort with nothing in progress → NOTHING_IN_PROGRESS; revert on an unborn HEAD → NO_HEAD', async (t) => {
  const w = await refsWorld(t);
  await assert.rejects(w.op('head.abort', { which: 'revert' }), refused('NOTHING_IN_PROGRESS'));
  await assert.rejects(w.op('head.abort', { which: 'cherry-pick' }), refused('NOTHING_IN_PROGRESS'));
  w.repo.git('checkout', '-q', '--orphan', 'empty');
  await assert.rejects(w.op('head.revert', { oid: w.base }), refused('NO_HEAD'));
});

test('reset hard\'s snapshot, applied with --index after resetting back, restores the exact staged/unstaged split', async (t) => {
  const w = await resetWorld(t);
  w.repo.write('f.txt', 'staged\n');
  w.repo.git('add', 'f.txt');
  w.repo.write('new.txt', 'added\n');
  w.repo.git('add', 'new.txt');
  w.repo.write('g.txt', 'g\nunstaged\n');
  const split = () => [w.repo.git('diff', '--cached', '--name-status'), w.repo.git('diff', '--name-status')];
  const before = split();
  assert.deepEqual(before, ['M\tf.txt\nA\tnew.txt', 'M\tg.txt']);
  const r = await w.op('head.reset', { to: w.base, mode: 'hard', expect: w.two });
  assert.deepEqual(split(), ['', '']);
  w.repo.git('reset', '-q', '--hard', r.undo.head.old.oid);
  w.repo.git('stash', 'apply', '-q', '--index', r.undo.worktreeSnapshot);
  assert.deepEqual(split(), before);
  assert.equal(read(w.repo.dir, 'f.txt'), 'staged\n');
  assert.equal(read(w.repo.dir, 'g.txt'), 'g\nunstaged\n');
  assert.equal(w.repo.git('show', ':new.txt'), 'added');
});
