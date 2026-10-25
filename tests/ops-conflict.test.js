import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';
import { createLocks } from '../src/git/locks.js';
import { getOp, OPS } from '../src/git/ops/index.js';
import { CONFLICT_LIMITS } from '../src/git/sequence/limits.js';
import { fifoBeforeRead, hashRead, hermeticEnv, lockFree, rejection, shortRead } from './_git.js';
import { refsWorld, refused } from './_refsWorld.js';

// conflict.read / save / take against real merge conflicts of every kind.

const b64 = (s) => Buffer.from(s).toString('base64');
const text = (b) => (b === null ? null : Buffer.from(b, 'base64').toString('utf8'));
const LARGE = 'x'.repeat(CONFLICT_LIMITS.sideMaxBytes + 1);

/**
 * base → ours (main) and theirs (branch `theirs`), merged so every path below conflicts:
 * text.txt bothModified · run.sh bothModified, 100755 · bin.dat binary · big.txt one side over the cap · link symlink ·
 * sub gitlink added on both · new.txt bothAdded · gone.txt deletedByThem · kept.txt deletedByUs · r.txt bothDeleted
 * (renamed apart) · d/x.txt bothModified under a directory · d/y.txt deletedByUs under it.
 */
async function world(t) {
  const w = await refsWorld(t);
  const r = w.repo;
  const gitIn = (...args) => r.git(...args);
  r.write('text.txt', 'a\nbase\nz\n');
  r.write('run.sh', '#!/bin/sh\necho base\n');
  fs.chmodSync(path.join(r.dir, 'run.sh'), 0o755);
  r.write('bin.dat', Buffer.from([0, 1, 2, 3]));
  r.write('big.txt', 'big base\n');
  r.write('gone.txt', 'gone\n');
  r.write('kept.txt', 'kept\n');
  r.write('r.txt', 'renamed apart\n');
  r.write('d/x.txt', 'dx base\n');
  r.write('d/y.txt', 'dy base\n');
  fs.symlinkSync('base-target', path.join(r.dir, 'link'));
  const base = r.commit({}, 'conflict base');
  const sides = { ours: 'main', theirs: 'theirs' };
  r.git('branch', 'theirs');
  for (const [side, branch] of Object.entries(sides)) {
    r.checkout(branch);
    r.write('text.txt', `a\n${side}\nz\n`);
    r.write('run.sh', `#!/bin/sh\necho ${side}\n`);
    r.write('bin.dat', Buffer.from([0, side.length, 9]));
    r.write('big.txt', side === 'ours' ? LARGE : 'big theirs\n');
    r.write('new.txt', `new ${side}\n`);
    r.write('d/x.txt', `dx ${side}\n`);
    fs.rmSync(path.join(r.dir, 'link'));
    fs.symlinkSync(`${side}-target`, path.join(r.dir, 'link'));
    if (side === 'ours') { r.write('gone.txt', 'gone, edited\n'); fs.rmSync(path.join(r.dir, 'kept.txt')); fs.rmSync(path.join(r.dir, 'd/y.txt')); }
    else { fs.rmSync(path.join(r.dir, 'gone.txt')); r.write('kept.txt', 'kept, edited\n'); r.write('d/y.txt', 'dy theirs\n'); }
    gitIn('mv', 'r.txt', `r-${side}.txt`);
    gitIn('add', '-A');
    gitIn('update-index', '--add', '--cacheinfo', `160000,${side === 'ours' ? base : w.base},sub`);
    gitIn('commit', '-q', '-m', side);
  }
  r.checkout('main');
  const merge = spawnSync('git', ['-C', r.dir, 'merge', '--no-edit', 'theirs'], { env: hermeticEnv(r.home), encoding: 'utf8' });
  assert.equal(merge.status, 1, merge.stderr);
  const read = (p) => w.op('conflict.read', { path: p });
  const disk = (p) => fs.readFileSync(path.join(r.dir, p), 'utf8');
  const unmerged = () => r.git('ls-files', '-u');
  const hash = (p) => r.git('hash-object', '--no-filters', '--', p);
  return { ...w, base, read, disk, unmerged, hash };
}

test('read: a text conflict — its kind, the three sides\' bytes and modes, the worktree file with its no-filter oid', async (t) => {
  const w = await world(t);
  const c = await w.read('text.txt');
  assert.deepEqual([c.kind, c.content], ['bothModified', 'text']);
  assert.deepEqual([text(c.base.b64), text(c.ours.b64), text(c.theirs.b64)], ['a\nbase\nz\n', 'a\nours\nz\n', 'a\ntheirs\nz\n']);
  assert.equal(c.ours.mode, '100644');
  assert.match(text(c.worktree.b64), /^a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> theirs\nz\n$/);
  assert.equal(c.worktree.oid, w.hash('text.txt'));
  const added = await w.read('new.txt');
  assert.deepEqual([added.kind, added.content, added.base], ['bothAdded', 'text', null]);
});

test('read: binary, large, symlink (targets as text), submodule (oids only), one-sided, none — no bytes but a symlink\'s', async (t) => {
  const w = await world(t);
  const cases = {
    'bin.dat': ['bothModified', 'binary'], 'big.txt': ['bothModified', 'large'], link: ['bothModified', 'symlink'], sub: ['bothAdded', 'submodule'],
    'gone.txt': ['deletedByThem', 'oneSided'], 'kept.txt': ['deletedByUs', 'oneSided'], 'r.txt': ['bothDeleted', 'none'],
  };
  for (const [p, [kind, content]] of Object.entries(cases)) {
    const c = await w.read(p);
    assert.deepEqual([c.kind, c.content], [kind, content], p);
    if (content !== 'symlink') for (const s of [c.base, c.ours, c.theirs]) assert.equal(s?.b64 ?? null, null, `${p}: no bytes`);
  }
  const link = await w.read('link');
  assert.deepEqual([text(link.ours.b64), text(link.theirs.b64), link.ours.mode], ['ours-target', 'theirs-target', '120000']);
  assert.equal((await w.read('sub')).ours.mode, '160000');
  assert.equal((await w.read('r.txt')).worktree, null);
});

test('read refuses NOT_CONFLICTED for a clean path and BAD_PATH for a path outside', async (t) => {
  const w = await world(t);
  await assert.rejects(w.read('f.txt'), refused('NOT_CONFLICTED'));
  assert.throws(() => getOp(OPS, 'conflict.read').params({ path: '../x' }), refused('BAD_PATH'));
});

test('save writes the worktree only: the stages stay, the index is unchanged; it answers the new worktree oid', async (t) => {
  const w = await world(t);
  const c = await w.read('text.txt');
  const index = w.repo.git('ls-files', '-s');
  const r = await w.op('conflict.save', { path: 'text.txt', contentB64: b64('a\nresolved\nz\n'), expect: c.worktree.oid });
  assert.equal(w.disk('text.txt'), 'a\nresolved\nz\n');
  assert.equal(w.repo.git('ls-files', '-s'), index, 'the index (stages included) is untouched');
  assert.equal(r.oid, w.hash('text.txt'));
  // stage.files then resolves it with the saved content.
  await w.op('stage.files', { paths: ['text.txt'] });
  assert.equal(w.repo.git('ls-files', '-u', '--', 'text.txt'), '');
  assert.equal(w.repo.git('show', ':text.txt'), 'a\nresolved\nz');
  assert.ok(!w.argvs().some((a) => a.includes('apply') && a.includes('--index')), 'never apply --index');
});

test('save keeps the executable bit and writes a path under a directory', async (t) => {
  const w = await world(t);
  for (const p of ['run.sh', 'd/x.txt']) {
    const c = await w.read(p);
    await w.op('conflict.save', { path: p, contentB64: b64('saved\n'), expect: c.worktree.oid });
    assert.equal(w.disk(p), 'saved\n', p);
  }
  assert.equal(fs.statSync(path.join(w.repo.dir, 'run.sh')).mode & 0o111, 0o111);
});

test('save refuses FILE_CHANGED when the file moved since the read (nothing written), and for a missing file unless expect is null', async (t) => {
  const w = await world(t);
  const c = await w.read('text.txt');
  w.repo.write('text.txt', 'edited elsewhere\n');
  await assert.rejects(w.op('conflict.save', { path: 'text.txt', contentB64: b64('mine\n'), expect: c.worktree.oid }), refused('FILE_CHANGED'));
  assert.equal(w.disk('text.txt'), 'edited elsewhere\n');
  fs.rmSync(path.join(w.repo.dir, 'text.txt'));
  await assert.rejects(w.op('conflict.save', { path: 'text.txt', contentB64: b64('mine\n'), expect: c.worktree.oid }), refused('FILE_CHANGED'));
  await w.op('conflict.save', { path: 'text.txt', contentB64: b64('mine\n'), expect: null });
  assert.equal(w.disk('text.txt'), 'mine\n');
});

test('save refuses NOT_TEXT_CONFLICT for a symlink, a submodule or a both-deleted path; NOT_CONFLICTED for a clean one; BAD_PARAMS over the cap', async (t) => {
  const w = await world(t);
  for (const p of ['link', 'sub', 'r.txt']) await assert.rejects(w.op('conflict.save', { path: p, contentB64: b64('x\n'), expect: null }), refused('NOT_TEXT_CONFLICT'), p);
  await assert.rejects(w.op('conflict.save', { path: 'f.txt', contentB64: b64('x\n'), expect: null }), refused('NOT_CONFLICTED'));
  const p = getOp(OPS, 'conflict.save').params;
  assert.throws(() => p({ path: 'text.txt', contentB64: b64('x'.repeat(CONFLICT_LIMITS.saveMaxBytes + 1)), expect: null }), refused('BAD_PARAMS'));
  assert.throws(() => p({ path: 'text.txt', contentB64: 'not base64!', expect: null }), refused('BAD_PARAMS'));
});

test('save refuses PATH_BLOCKED when a leading directory became an untracked symlink to outside: nothing is written there', async (t) => {
  const w = await world(t);
  const c = await w.read('d/x.txt');
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.rmSync(path.join(w.repo.dir, 'd'), { recursive: true });
  fs.symlinkSync(outside, path.join(w.repo.dir, 'd'));
  await assert.rejects(w.op('conflict.save', { path: 'd/x.txt', contentB64: b64('escape\n'), expect: c.worktree.oid }), refused('PATH_BLOCKED'));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('save round-trips core.autocrlf: CRLF text sent is CRLF on disk (clean on the way in, smudge on the way out)', async (t) => {
  const w = await world(t);
  w.repo.git('config', 'core.autocrlf', 'true');
  const c = await w.read('new.txt');
  await w.op('conflict.save', { path: 'new.txt', contentB64: b64('one\r\ntwo\r\n'), expect: c.worktree.oid });
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'new.txt'), 'latin1'), 'one\r\ntwo\r\n');
});

test('take ours / theirs resolves a text conflict (the file and a stage-0 entry are that side); NOT_CONFLICTED lists clean paths', async (t) => {
  const w = await world(t);
  const r = await w.op('conflict.take', { paths: ['text.txt', 'run.sh'], side: 'theirs' });
  assert.deepEqual(r, { resolved: ['text.txt', 'run.sh'], deleted: [] });
  assert.deepEqual([w.disk('text.txt'), w.repo.git('show', ':text.txt')], ['a\ntheirs\nz\n', 'a\ntheirs\nz']);
  assert.equal(w.repo.git('ls-files', '-u', '--', 'text.txt', 'run.sh'), '');
  await w.op('conflict.take', { paths: ['new.txt'], side: 'ours' });
  assert.equal(w.disk('new.txt'), 'new ours\n');
  await assert.rejects(w.op('conflict.take', { paths: ['bin.dat', 'f.txt'], side: 'ours' }), refused('NOT_CONFLICTED', { paths: ['f.txt'] }));
  assert.notEqual(w.repo.git('ls-files', '-u', '--', 'bin.dat'), '', 'nothing taken when one path is not conflicted');
});

test('take the side that deleted the file deletes it (listed as deleted); the side that kept it keeps it', async (t) => {
  const w = await world(t);
  const r = await w.op('conflict.take', { paths: ['gone.txt', 'kept.txt'], side: 'theirs' });
  assert.deepEqual(r, { resolved: ['kept.txt'], deleted: ['gone.txt'] });
  assert.equal(fs.existsSync(path.join(w.repo.dir, 'gone.txt')), false);
  assert.equal(w.disk('kept.txt'), 'kept, edited\n');
  assert.equal(w.repo.git('ls-files', '-u', '--', 'gone.txt', 'kept.txt'), '');
  assert.equal(w.repo.git('ls-files', '--', 'gone.txt'), '');
});

test('take a submodule side writes a stage-0 gitlink and leaves the submodule\'s directory alone; a symlink side writes the link', async (t) => {
  const w = await world(t);
  w.repo.write('sub/inner.txt', 'mine\n');
  await w.op('conflict.take', { paths: ['sub', 'link'], side: 'ours' });
  // Ours added the gitlink at the conflict base commit (theirs at the refs world's first commit).
  assert.equal(w.repo.git('ls-files', '-s', '--', 'sub'), `160000 ${w.base} 0\tsub`);
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'sub', 'inner.txt'), 'utf8'), 'mine\n');
  assert.equal(fs.readlinkSync(path.join(w.repo.dir, 'link')), 'ours-target');
  assert.equal(w.unmerged().includes('\tsub') || w.unmerged().includes('\tlink'), false);
});

test('take params: side ours/theirs, 1…takeMax paths', () => {
  const p = getOp(OPS, 'conflict.take').params;
  assert.throws(() => p({ paths: ['a'], side: 'base' }), refused('BAD_PARAMS'));
  assert.throws(() => p({ paths: [], side: 'ours' }), refused('BAD_PARAMS'));
  assert.throws(() => p({ paths: Array.from({ length: CONFLICT_LIMITS.takeMax + 1 }, (_, i) => `f${i}`), side: 'ours' }), refused('BAD_PARAMS'));
});

/** d replaced by an untracked symlink to a directory outside holding y.txt and x.txt. → that directory. */
function linkDOutside(w) {
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'y.txt'), 'outside y\n');
  fs.writeFileSync(path.join(outside, 'x.txt'), 'outside x\n');
  fs.rmSync(path.join(w.repo.dir, 'd'), { recursive: true });
  fs.symlinkSync(outside, path.join(w.repo.dir, 'd'));
  return outside;
}
const snapshot = (w) => [w.repo.git('ls-files', '-s'), w.repo.git('status', '--porcelain', '-z', '--untracked-files=all')];

test('take refuses PATH_BLOCKED when the side that deleted the path would rm it through an untracked symlinked leading directory: the outside file stays', async (t) => {
  const w = await world(t);
  assert.equal((await w.read('d/y.txt')).kind, 'deletedByUs');
  const outside = linkDOutside(w);
  const before = snapshot(w);
  await assert.rejects(w.op('conflict.take', { paths: ['d/y.txt'], side: 'ours' }), refused('PATH_BLOCKED'));
  assert.equal(fs.readFileSync(path.join(outside, 'y.txt'), 'utf8'), 'outside y\n');
  assert.deepEqual(snapshot(w), before, 'index and worktree unchanged');
  assert.ok(!w.argvs().some((a) => a[0] === 'rm' || a[0] === 'checkout' || a[0] === 'update-index'), 'no write ran');
});

test('a mixed take (a gitlink and a blocked path) refuses before anything: the gitlink keeps its stages', async (t) => {
  const w = await world(t);
  const outside = linkDOutside(w);
  const before = snapshot(w);
  await assert.rejects(w.op('conflict.take', { paths: ['sub', 'd/x.txt'], side: 'ours' }), refused('PATH_BLOCKED'));
  assert.equal(w.repo.git('ls-files', '-u', '--', 'sub').split('\n').length, 2, 'the gitlink is still unmerged');
  assert.deepEqual(snapshot(w), before);
  assert.equal(fs.readFileSync(path.join(outside, 'x.txt'), 'utf8'), 'outside x\n');
});

test('take refuses PATH_BLOCKED when the path itself is now a directory (a file target only)', async (t) => {
  const w = await world(t);
  fs.rmSync(path.join(w.repo.dir, 'gone.txt'), { force: true });
  fs.mkdirSync(path.join(w.repo.dir, 'gone.txt'));
  fs.writeFileSync(path.join(w.repo.dir, 'gone.txt', 'inner'), 'keep\n');
  await assert.rejects(w.op('conflict.take', { paths: ['gone.txt'], side: 'theirs' }), refused('PATH_BLOCKED'));
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'gone.txt', 'inner'), 'utf8'), 'keep\n');
});

test('read refuses PATH_BLOCKED behind an untracked symlinked leading directory: nothing outside is read or sent', async (t) => {
  const w = await world(t);
  linkDOutside(w);
  const before = w.argvs().length;
  let err;
  await assert.rejects(w.read('d/x.txt'), (e) => { err = e; return refused('PATH_BLOCKED')(e); });
  assert.ok(!JSON.stringify(err.toBody()).includes('outside x'), 'the outside content is not in the answer');
  assert.ok(!w.argvs().slice(before).some((a) => a.includes('hash-object') || (a.includes('--no-index') && a.includes('d/x.txt'))), 'the worktree file was never read');
});

test('take the side that deleted a gitlink (deletedByThem; sub/ a directory) resolves it as git rm does: no PATH_BLOCKED', async (t) => {
  const w = await refsWorld(t);
  const r = w.repo;
  const gitlink = (to) => { r.git('update-index', '--add', '--cacheinfo', `160000,${to},sub`); r.git('commit', '-q', '-m', `sub ${to.slice(0, 7)}`); };
  gitlink(w.base);
  r.git('branch', 'other');
  gitlink(r.commit({ 'y.txt': 'y\n' }, 'y'));
  r.checkout('other');
  r.git('rm', '-q', '--cached', 'sub');
  r.git('commit', '-q', '-m', 'drop sub');
  r.checkout('main');
  r.write('sub/inner.txt', 'checkout\n');
  assert.equal(spawnSync('git', ['-C', r.dir, 'merge', '--no-edit', 'other'], { env: hermeticEnv(r.home) }).status, 1);
  assert.equal((await w.op('conflict.read', { path: 'sub' })).kind, 'deletedByThem');
  // What plain `git rm -q -f -- sub` leaves, in a twin of this state.
  const twin = path.join(r.root, 'twin');
  fs.cpSync(r.dir, twin, { recursive: true });
  spawnSync('git', ['-C', twin, 'rm', '-q', '-f', '--', 'sub'], { env: hermeticEnv(r.home) });
  const res = await w.op('conflict.take', { paths: ['sub'], side: 'theirs' });
  assert.deepEqual(res, { resolved: [], deleted: ['sub'] });
  assert.equal(r.git('ls-files', '-s', '--', 'sub'), '', 'no stage of sub is left');
  assert.equal(fs.existsSync(path.join(r.dir, 'sub', 'inner.txt')), fs.existsSync(path.join(twin, 'sub', 'inner.txt')), 'the directory is left as git rm leaves it');
});

test('a conflicted file swapped for a FIFO between its probe and its hash: read and save refuse READ_TIMEOUT promptly, and the project lock is free again', { timeout: 10_000 }, async (t) => {
  shortRead(t);
  const w = await world(t);
  const c = await w.read('text.txt');
  const readTimeout = (e, ms, what) => {
    assert.equal(e.code, 'READ_TIMEOUT', `${what}: ${e.message}`);
    assert.deepEqual(e.extra, { path: 'text.txt', timeoutMs: DIFF_LIMITS.contentReadTimeoutMs }, what);
    assert.ok(ms < 5000, `${what} refused after ${ms} ms`);
  };
  let swap = fifoBeforeRead(w.cc, w.repo.dir, 'text.txt', hashRead);
  const r = await rejection(w.read('text.txt'));
  assert.equal(swap.done, true, 'read: the probe saw a file; the hash met a FIFO');
  readTimeout(r.e, r.ms, 'read');
  fs.rmSync(path.join(w.repo.dir, 'text.txt'));
  w.repo.write('text.txt', 'a\nours\nz\n');
  swap = fifoBeforeRead(w.cc, w.repo.dir, 'text.txt', hashRead);
  const locks = createLocks();
  const s = await rejection(w.op('conflict.save', { path: 'text.txt', contentB64: b64('a\nresolved\nz\n'), expect: c.worktree.oid }, null, { locks }));
  assert.equal(swap.done, true, 'save: the hash met a FIFO');
  readTimeout(s.e, s.ms, 'save');
  assert.equal(w.argvs().some((a) => a[0] === 'restore'), false, 'nothing written');
  assert.equal(await lockFree(locks, 'repo'), true, 'the project lock is released');
  await w.cc.idle();
});
