import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv } from './_git.js';
import { parseConflictFiles } from '../src/git/stash/branch.js';
import { noViolations, refused } from './_ops.js';
import { blob, exists, outsideLink, read, runs, stashList, stashWorld } from './_stash.js';

// stash.apply, stash.pop, stash.applyFile and stash.branch against real git under the hostile config.

async function saved(w, edits, params = {}) {
  for (const [p, c] of Object.entries(edits)) w.repo.write(p, c);
  return (await w.op('stash.push', params)).oid;
}
const noGitApply = (w) => assert.deepEqual([...runs(w, 'stash', 'apply'), ...runs(w, 'apply'), ...runs(w, 'switch')], []);

/** A stash adding tracked `link/n.txt`, then `link` untracked in HEAD and replaced by a symlink to an outside directory. */
async function beyondLink(t, extra = {}) {
  const w = await stashWorld(t, { 'a.txt': 'a\n', 'link/x.txt': 'x\n' });
  w.repo.write('link/n.txt', 'n\n');
  w.repo.git('add', 'link/n.txt');
  const oid = await saved(w, extra, { includeUntracked: Object.keys(extra).length > 0 });
  w.repo.git('rm', '-rq', '--cached', 'link');
  w.repo.git('commit', '-qm', 'rm link');
  fs.rmSync(path.join(w.repo.dir, 'link'), { recursive: true });
  const outside = outsideLink(w, 'link');
  w.cc.state.execCalls.length = 0;
  return { ...w, oid, outside };
}

test('apply / pop / branch / applyFile with a stash path beyond an untracked symlink → PATH_BLOCKED, nothing written inside or outside', async (t) => {
  const w = await beyondLink(t);
  const before = stashList(w);
  for (const [op, params] of [
    ['stash.apply', { oid: w.oid }], ['stash.pop', { oid: w.oid }], ['stash.branch', { oid: w.oid, name: 'nb' }],
    ['stash.applyFile', { oid: w.oid, path: 'link/n.txt' }],
  ]) {
    await assert.rejects(w.op(op, params), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths[0] === 'link', op);
  }
  assert.deepEqual(fs.readdirSync(w.outside), []);
  assert.equal(fs.lstatSync(path.join(w.repo.dir, 'link')).isSymbolicLink(), true);
  assert.deepEqual(stashList(w), before);
  assert.equal(w.repo.git('branch', '--list', 'nb'), '');
  noGitApply(w);
});

test('the untracked part is guarded too: a stash file u/y with u now an untracked symlink → PATH_BLOCKED', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'u/y.txt': 'y\n' }, { includeUntracked: true });
  const outside = outsideLink(w, 'u');
  w.cc.state.execCalls.length = 0;
  await assert.rejects(w.op('stash.apply', { oid }), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths[0] === 'u');
  assert.deepEqual(fs.readdirSync(outside), []);
  noGitApply(w);
});

test('apply over local changes to the same file → CHECKOUT_CONFLICT, worktree bytes unchanged', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'stashed\n' });
  w.repo.write('a.txt', 'local edit\n');
  for (const op of ['stash.apply', 'stash.pop']) {
    await assert.rejects(w.op(op, { oid }), (e) => e.code === 'CHECKOUT_CONFLICT' && e.extra.files.includes('a.txt'), op);
  }
  assert.equal(read(w, 'a.txt'), 'local edit\n');
  assert.deepEqual(stashList(w).map((s) => s.oid), [oid]);
});

test('apply where an untracked stash file already exists → CHECKOUT_CONFLICT before git runs', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'a2\n', 'u.txt': 'stashed u\n' }, { includeUntracked: true });
  w.repo.write('u.txt', 'mine\n');
  w.cc.state.execCalls.length = 0;
  await assert.rejects(w.op('stash.apply', { oid }), (e) => e.code === 'CHECKOUT_CONFLICT' && e.extra.files.join() === 'u.txt');
  assert.equal(read(w, 'u.txt'), 'mine\n');
  assert.equal(read(w, 'a.txt'), 'a\n');
  noGitApply(w);
  // An ignored file in the way counts as well.
  fs.rmSync(path.join(w.repo.dir, 'u.txt'));
  fs.appendFileSync(path.join(w.repo.dir, '.git', 'info', 'exclude'), 'u.txt\n');
  w.repo.write('u.txt', 'ignored\n');
  await assert.rejects(w.op('stash.apply', { oid }), refused('CHECKOUT_CONFLICT'));
});

test('apply conflicting with HEAD → {conflicts}, markers written; pop keeps the stash (dropped:false)', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'stashed\n' });
  w.repo.commit({ 'a.txt': 'committed\n' }, 'moves a');
  const r = await w.op('stash.pop', { oid });
  assert.deepEqual(r.conflicts, ['a.txt']);
  assert.equal(r.dropped, false);
  assert.deepEqual(r.undo.stashes, []);
  assert.match(read(w, 'a.txt'), /^<<<<<<< [^\n]*\ncommitted\n=======\nstashed\n>>>>>>> /);
  assert.deepEqual(stashList(w).map((s) => s.oid), [oid]);
  // A second apply refuses while the index is unmerged.
  await assert.rejects(w.op('stash.apply', { oid }), refused('CONFLICTED'));
  w.repo.git('checkout', '-q', '-f', 'HEAD', '--', 'a.txt');
  const a = await w.op('stash.apply', { oid });
  assert.deepEqual(a.conflicts, ['a.txt']);
  assert.deepEqual(a.undo, { refs: [], remoteRefs: [], head: null, worktreeSnapshot: null, stashes: [], worktreePatch: null });
});

test('apply index:true restores the staged part; without it the staged change lands unstaged', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  const oid = await saved(w, { 'a.txt': 'a2\n' });
  const r = await w.op('stash.apply', { oid, index: true });
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(w.status(), { 'a.txt': ' M', 'b.txt': 'M ' });
  assert.ok(runs(w, 'stash', 'apply').at(-1).includes('--index'));
  // Nothing was staged: no index snapshot is taken.
  assert.deepEqual(runs(w, 'write-tree'), []);
  w.repo.git('reset', '-q', '--hard');
  await w.op('stash.apply', { oid });
  assert.deepEqual(w.status(), { 'a.txt': ' M', 'b.txt': ' M' });
  assert.deepEqual(stashList(w).map((s) => s.oid), [oid]);
});

test('apply restores the untracked part and leaves the stash; the oid, never a selector, reaches git', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'a2\n', 'u.txt': 'u\n' }, { includeUntracked: true });
  await w.op('stash.apply', { oid });
  assert.equal(read(w, 'u.txt'), 'u\n');
  assert.equal(read(w, 'a.txt'), 'a2\n');
  assert.equal(runs(w, 'stash', 'apply').at(-1).at(-1), oid);
  assert.deepEqual(stashList(w).map((s) => s.oid), [oid]);
  noViolations(w.cc);
});

test('pop clean drops exactly that oid; undo record restore:\'store\'', async (t) => {
  const w = await stashWorld(t);
  const older = await saved(w, { 'a.txt': 'a2\n' }, { message: 'older' });
  const newer = await saved(w, { 'b.txt': 'b2\n' }, { message: 'newer' });
  const r = await w.op('stash.pop', { oid: older });
  assert.deepEqual({ conflicts: r.conflicts, dropped: r.dropped }, { conflicts: [], dropped: true });
  assert.deepEqual(r.undo.stashes, [{ oid: older, old: { message: 'On main: older' }, new: null, restore: 'store' }]);
  assert.deepEqual(stashList(w).map((s) => s.oid), [newer]);
  assert.equal(read(w, 'a.txt'), 'a2\n');
});

test('pop whose drop races another session reports dropError STASH_MOVED and keeps every stash', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'a2\n' });
  w.cc.state.execHook = (body) => (body.argv.includes('drop') ? 'hold' : undefined);
  const popping = w.op('stash.pop', { oid });
  const held = await w.cc.nextHeld();
  w.repo.write('b.txt', 'b2\n');
  w.repo.git('stash', 'push', '-q', '-m', 'raced', '--', 'b.txt');
  const raced = stashList(w)[0].oid;
  w.cc.state.execHook = null;
  held.release();
  const r = await popping;
  assert.deepEqual({ dropped: r.dropped, dropError: r.dropError, stashes: r.undo.stashes }, { dropped: false, dropError: 'STASH_MOVED', stashes: [] });
  assert.deepEqual(new Set(stashList(w).map((s) => s.oid)), new Set([oid, raced]));
});

test('applyFile tracked: worktree only, index unchanged, no --index/--3way in argv; the undo patch reversed restores', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'a2\n', 'b.txt': 'b2\n' });
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  const r = await w.op('stash.applyFile', { oid, path: 'a.txt' });
  assert.deepEqual({ oid: r.oid, path: r.path, part: r.part }, { oid, path: 'a.txt', part: 'tracked' });
  assert.equal(read(w, 'a.txt'), 'a2\n');
  assert.equal(w.indexBlob('a.txt').toString(), 'a\n');
  assert.deepEqual(w.status(), { 'a.txt': ' M', 'b.txt': 'M ' });
  for (const a of runs(w, 'apply')) assert.ok(!a.includes('--index') && !a.includes('--3way') && !a.includes('--cached'), a.join(' '));
  assert.deepEqual(stashList(w).map((s) => s.oid), [oid]);
  execFileSync('git', ['-C', w.repo.dir, '--work-tree=.', 'apply', '-R', '-'], { input: Buffer.from(r.undo.worktreePatch, 'base64'), env: hermeticEnv(w.repo.home) });
  assert.equal(read(w, 'a.txt'), 'a\n');
});

test('applyFile untracked part creates the file; an existing file → PATCH_DOES_NOT_APPLY; a binary tracked file applies', async (t) => {
  const w = await stashWorld(t, { 'a.txt': 'a\n', 'bin.dat': Buffer.from([0, 1, 2, 0]) });
  const oid = await saved(w, { 'u.txt': 'u\n', 'bin.dat': Buffer.from([0, 9, 9, 0, 7]) }, { includeUntracked: true });
  const r = await w.op('stash.applyFile', { oid, path: 'u.txt' });
  assert.equal(r.part, 'untracked');
  assert.equal(read(w, 'u.txt'), 'u\n');
  assert.deepEqual(w.status(), { 'u.txt': '??' });
  await assert.rejects(w.op('stash.applyFile', { oid, path: 'u.txt' }), refused('PATCH_DOES_NOT_APPLY'));
  assert.equal(read(w, 'u.txt'), 'u\n');
  await w.op('stash.applyFile', { oid, path: 'bin.dat' });
  assert.deepEqual([...fs.readFileSync(path.join(w.repo.dir, 'bin.dat'))], [0, 9, 9, 0, 7]);
  // A local edit to a tracked file: refused, never overwritten.
  const oid2 = await saved(w, { 'a.txt': 'a stashed\n' });
  w.repo.write('a.txt', 'local\n');
  await assert.rejects(w.op('stash.applyFile', { oid: oid2, path: 'a.txt' }), refused('PATCH_DOES_NOT_APPLY'));
  assert.equal(read(w, 'a.txt'), 'local\n');
});

test('applyFile path not in stash → PATH_NOT_IN_COMMIT (an unchanged file, a directory, an absent path)', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'dir/c.txt': 'c2\n' });
  for (const p of ['a.txt', 'dir', 'nope.txt']) await assert.rejects(w.op('stash.applyFile', { oid, path: p }), refused('PATH_NOT_IN_COMMIT'), p);
  for (const p of ['dir/', '../x', './a.txt']) await assert.rejects(w.op('stash.applyFile', { oid, path: p }), refused('BAD_PATH'), p);
  assert.equal(exists(w, 'dir/c.txt') && read(w, 'dir/c.txt'), 'c\n');
});

test('applyFile of a deleted file deletes it from the worktree', async (t) => {
  const w = await stashWorld(t);
  fs.rmSync(path.join(w.repo.dir, 'b.txt'));
  const oid = await saved(w, {});
  assert.equal(read(w, 'b.txt'), 'b\n');
  await w.op('stash.applyFile', { oid, path: 'b.txt' });
  assert.equal(exists(w, 'b.txt'), false);
});

test('branch: switch -c at the base, apply --index, drop; undo has refs + head + stashes', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  const oid = await saved(w, { 'a.txt': 'a2\n' }, { message: 'for branch' });
  const moved = w.repo.commit({ 'c.txt': 'later\n' }, 'later');
  const r = await w.op('stash.branch', { oid, name: 'from-stash' });
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/from-stash');
  assert.equal(w.repo.git('rev-parse', 'HEAD'), w.base);
  assert.deepEqual(w.status(), { 'a.txt': ' M', 'b.txt': 'M ' });
  assert.deepEqual(stashList(w), []);
  assert.deepEqual({ ref: r.ref, base: r.base, conflicts: r.conflicts, dropped: r.dropped }, { ref: 'refs/heads/from-stash', base: w.base, conflicts: [], dropped: true });
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/from-stash', old: null, new: w.base }]);
  assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/main', oid: moved }, new: { branch: 'refs/heads/from-stash', oid: w.base } });
  assert.deepEqual(r.undo.stashes, [{ oid, old: { message: 'On main: for branch' }, new: null, restore: 'store' }]);
  const sw = runs(w, 'switch');
  assert.deepEqual(sw.at(-1).slice(sw.at(-1).indexOf('switch')), ['switch', '--no-guess', '--no-track', '-c', 'from-stash', '--end-of-options', w.base]);
});

test('branch refusals: REF_EXISTS; "-x" → BAD_REF; code-conductor/* HEAD without ccOwned → CC_OWNED_BRANCH, with it → done', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'a2\n' });
  w.repo.git('branch', 'taken');
  w.cc.state.execCalls.length = 0;
  await assert.rejects(w.op('stash.branch', { oid, name: 'taken' }), refused('REF_EXISTS'));
  for (const name of ['-x', 'HEAD', 'refs/heads/x', 'a..b', '']) await assert.rejects(w.op('stash.branch', { oid, name }), refused('BAD_REF'), name);
  w.repo.git('checkout', '-q', '-b', 'code-conductor/wt');
  await assert.rejects(w.op('stash.branch', { oid, name: 'nb' }), (e) => e.code === 'CC_OWNED_BRANCH' && e.extra.head === true && e.extra.branches.join() === 'code-conductor/wt');
  noGitApply(w);
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/code-conductor/wt');
  const r = await w.op('stash.branch', { oid, name: 'nb', ccOwned: true });
  assert.equal(r.dropped, true);
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/nb');
});

test('branch over a local change the switch would overwrite → CHECKOUT_CONFLICT, no branch created', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'b.txt': 'b2\n' });
  w.repo.commit({ 'a.txt': 'a moved\n' }, 'moves a');
  w.repo.write('a.txt', 'local\n');
  await assert.rejects(w.op('stash.branch', { oid, name: 'nb' }), (e) => e.code === 'CHECKOUT_CONFLICT' && e.extra.files.includes('a.txt'));
  assert.equal(w.repo.git('branch', '--list', 'nb'), '');
  assert.equal(read(w, 'a.txt'), 'local\n');
  assert.deepEqual(stashList(w).map((s) => s.oid), [oid]);
});

test('apply / pop / applyFile / branch of an unknown oid → STASH_UNKNOWN', async (t) => {
  const w = await stashWorld(t);
  for (const [op, extra] of [['stash.apply', {}], ['stash.pop', {}], ['stash.applyFile', { path: 'a.txt' }], ['stash.branch', { name: 'x' }]]) {
    await assert.rejects(w.op(op, { oid: w.base, ...extra }), refused('STASH_UNKNOWN'), op);
  }
});

test('parseConflictFiles reads both of git\'s lists: tab-indented, and the two-space one of stash apply --index', () => {
  assert.deepEqual(parseConflictFiles('error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n\tb c.txt\nPlease commit\n'), ['a.txt', 'b c.txt']);
  assert.deepEqual(parseConflictFiles('error: Your local changes to the following files would be overwritten by merge:\n  dir/c.txt\nIndex was not unstashed.\n'), ['dir/c.txt']);
  assert.deepEqual(parseConflictFiles('  indented but no list header\n'), []);
});

/** The round-1 repro: a stash of a staged b.txt and a changed a.txt, then dir/c.txt changed and staged. */
async function stagedElsewhere(t) {
  const w = await stashWorld(t);
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  const oid = await saved(w, { 'a.txt': 'a2\n' });
  w.repo.write('dir/c.txt', 'c2\n');
  w.repo.git('add', 'dir/c.txt');
  return { ...w, oid };
}

test('Apply with staged changes over a newly staged file → CHECKOUT_CONFLICT {files} (git\'s two-space list); the staging git reset is put back', async (t) => {
  const w = await stagedElsewhere(t);
  await assert.rejects(w.op('stash.apply', { oid: w.oid, index: true }), (e) => {
    assert.equal(e.code, 'CHECKOUT_CONFLICT');
    assert.deepEqual(e.extra.files, ['dir/c.txt']);
    return true;
  });
  assert.deepEqual(w.status(), { 'dir/c.txt': 'M ' });
  assert.equal(read(w, 'dir/c.txt'), 'c2\n');
  assert.equal(w.indexBlob('dir/c.txt').toString(), 'c2\n');
  assert.deepEqual(stashList(w).map((s) => s.oid), [w.oid]);
});

test('branch whose apply --index meets that staged file → CHECKOUT_CONFLICT with step apply; the stash stays', async (t) => {
  const w = await stagedElsewhere(t);
  await assert.rejects(w.op('stash.branch', { oid: w.oid, name: 'nb' }), (e) => {
    assert.equal(e.code, 'CHECKOUT_CONFLICT');
    assert.deepEqual(e.extra.files, ['dir/c.txt']);
    assert.equal(e.extra.step, 'apply');
    assert.equal(e.extra.ref, 'refs/heads/nb');
    assert.deepEqual(e.extra.undo.refs, [{ ref: 'refs/heads/nb', old: null, new: w.base }]);
    return true;
  });
  assert.deepEqual(stashList(w).map((s) => s.oid), [w.oid]);
  assert.deepEqual(w.status(), { 'dir/c.txt': 'M ' });
});

/** Replaces `p` in the worktree by a symlink to a file outside the repo; returns that file's path. */
function linkedFile(w, p) {
  const outside = path.join(w.repo.root, `outside-${p.replaceAll('/', '-')}`);
  fs.writeFileSync(outside, 'OUTSIDE\n');
  fs.rmSync(path.join(w.repo.dir, p));
  fs.symlinkSync(outside, path.join(w.repo.dir, p));
  return outside;
}

test('applyFile onto a file now a symlink (the final component) → PATH_BLOCKED; the outside file is untouched', async (t) => {
  const w = await stashWorld(t);
  const oid = await saved(w, { 'a.txt': 'a stashed\n' });
  const outside = linkedFile(w, 'a.txt');
  w.cc.state.execCalls.length = 0;
  await assert.rejects(w.op('stash.applyFile', { oid, path: 'a.txt' }), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === 'a.txt');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE\n');
  assert.equal(runs(w, 'apply').length, 0);
  // A directory standing at the path is refused the same way.
  fs.rmSync(path.join(w.repo.dir, 'a.txt'));
  fs.mkdirSync(path.join(w.repo.dir, 'a.txt'));
  await assert.rejects(w.op('stash.applyFile', { oid, path: 'a.txt' }), refused('PATH_BLOCKED'));
});

test('applyFile of a tracked symlink the stash retargets applies (its own version is a symlink)', async (t) => {
  const w = await stashWorld(t);
  fs.symlinkSync('a.txt', path.join(w.repo.dir, 'ln'));
  w.repo.commit({}, 'add ln');
  fs.rmSync(path.join(w.repo.dir, 'ln'));
  fs.symlinkSync('b.txt', path.join(w.repo.dir, 'ln'));
  const oid = await saved(w, {});
  assert.equal(fs.readlinkSync(path.join(w.repo.dir, 'ln')), 'a.txt');
  await w.op('stash.applyFile', { oid, path: 'ln' });
  assert.equal(fs.readlinkSync(path.join(w.repo.dir, 'ln')), 'b.txt');
});

test('applyFile of a submodule (gitlink, mode 160000) → PARTIAL_UNSUPPORTED', async (t) => {
  const w = await stashWorld(t);
  const env = { ...hermeticEnv(w.repo.home), GIT_INDEX_FILE: path.join(w.repo.root, 'tmp-index') };
  const g = (args, input) => execFileSync('git', ['-C', w.repo.dir, '--work-tree=.', ...args], { env, input }).toString().trim();
  g(['read-tree', 'HEAD']);
  g(['update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendor/lib`]);
  const tree = g(['write-tree']);
  const index = g(['commit-tree', '-p', 'HEAD', '-m', 'index on main', 'HEAD^{tree}']);
  const oid = g(['commit-tree', '-p', 'HEAD', '-p', index, '-m', 'On main: gitlink', tree]);
  w.repo.git('stash', 'store', '-m', 'On main: gitlink', oid);
  await assert.rejects(w.op('stash.applyFile', { oid, path: 'vendor/lib' }), refused('PARTIAL_UNSUPPORTED'));
  assert.equal(exists(w, 'vendor/lib'), false);
});
