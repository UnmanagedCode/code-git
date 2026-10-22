import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { STAGE_LIMITS } from '../src/git/stage/limits.js';
import { hostile, noViolations, opWorld, refused } from './_ops.js';

/** a.txt, b.txt, `*.txt`, `-rf` and gone.txt committed; then hostile config. */
async function world(t) {
  const w = await opWorld(t);
  w.repo.commit({ 'a.txt': 'a\n', 'b.txt': 'b\n', '*.txt': 'star\n', '-rf': 'dash\n', 'gone.txt': 'gone\n' });
  hostile(w.repo);
  return w;
}
const read = (w, p) => fs.readFileSync(path.join(w.repo.dir, p), 'utf8');
const exists = (w, p) => fs.existsSync(path.join(w.repo.dir, p));

test('stage.files stages exactly the named modified, deleted and untracked paths', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('b.txt', 'b2\n');
  fs.rmSync(path.join(w.repo.dir, 'gone.txt'));
  w.repo.write('new.txt', 'new\n');
  await w.op('stage.files', { paths: ['a.txt', 'gone.txt', 'new.txt'] });
  assert.deepEqual(w.status(), { 'a.txt': 'M ', 'b.txt': ' M', 'gone.txt': 'D ', 'new.txt': 'A ' });
  assert.equal(w.indexBlob('a.txt').toString(), 'a2\n');
  noViolations(w.cc);
});

test('stage.files {all} stages every change; unstageFiles {all} unstages every one', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'a2\n');
  fs.rmSync(path.join(w.repo.dir, 'gone.txt'));
  w.repo.write('new.txt', 'new\n');
  await w.op('stage.files', { all: true });
  assert.deepEqual(w.status(), { 'a.txt': 'M ', 'gone.txt': 'D ', 'new.txt': 'A ' });
  await w.op('stage.unstageFiles', { all: true });
  assert.deepEqual(w.status(), { 'a.txt': ' M', 'gone.txt': ' D', 'new.txt': '??' });
});

test('stage.unstageFiles resets only the named paths to HEAD, keeping the worktree', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('b.txt', 'b2\n');
  w.repo.git('add', '-A');
  await w.op('stage.unstageFiles', { paths: ['a.txt'] });
  assert.deepEqual(w.status(), { 'a.txt': ' M', 'b.txt': 'M ' });
  assert.equal(read(w, 'a.txt'), 'a2\n');
});

test('a staged rename is unstaged by sending both of its paths', async (t) => {
  const w = await world(t);
  w.repo.git('mv', 'a.txt', 'moved.txt');
  await w.op('stage.unstageFiles', { paths: ['a.txt', 'moved.txt'] });
  assert.deepEqual(w.status(), { 'a.txt': ' D', 'moved.txt': '??' });
});

test('on an unborn HEAD, unstaging removes the entries from the index (one path, then all)', async (t) => {
  const w = await opWorld(t);
  w.repo.write('x.txt', 'x\n');
  w.repo.write('y.txt', 'y\n');
  w.repo.git('add', '-A');
  await w.op('stage.unstageFiles', { paths: ['x.txt'] });
  assert.deepEqual(w.status(), { 'x.txt': '??', 'y.txt': 'A ' });
  await w.op('stage.unstageFiles', { all: true });
  assert.deepEqual(w.status(), { 'x.txt': '??', 'y.txt': '??' });
  // Nothing staged at all: unstage all is still not an error.
  await w.op('stage.unstageFiles', { all: true });
});

test('pathspecs are literal: `*.txt` and `-rf` name only those files, in stage, unstage and discard', async (t) => {
  const w = await world(t);
  for (const p of ['a.txt', '*.txt', '-rf']) w.repo.write(p, `${p} changed\n`);
  await w.op('stage.files', { paths: ['*.txt', '-rf'] });
  assert.deepEqual(w.status(), { '*.txt': 'M ', '-rf': 'M ', 'a.txt': ' M' });
  await w.op('stage.unstageFiles', { paths: ['*.txt'] });
  assert.deepEqual(w.status(), { '*.txt': ' M', '-rf': 'M ', 'a.txt': ' M' });
  await w.op('stage.discardFiles', { tracked: ['*.txt'] });
  assert.equal(read(w, '*.txt'), 'star\n');
  assert.equal(read(w, 'a.txt'), 'a.txt changed\n');
});

test('an untracked file named `*.txt` is discarded alone: its untracked siblings stay', async (t) => {
  const w = await opWorld(t);
  w.repo.commit({ 'keep.md': 'k\n' });
  w.repo.write('u/*.txt', 'star\n');
  w.repo.write('u/one.txt', 'one\n');
  await w.op('stage.discardFiles', { untracked: ['u/*.txt'] });
  assert.equal(exists(w, 'u/*.txt'), false);
  assert.equal(exists(w, 'u/one.txt'), true);
});

test('discardFiles restores tracked M, D and T files from the index, leaving their staged changes', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'a staged\n');
  w.repo.git('add', 'a.txt');
  w.repo.write('a.txt', 'a staged\nand unstaged\n');
  fs.rmSync(path.join(w.repo.dir, 'gone.txt'));
  fs.rmSync(path.join(w.repo.dir, 'b.txt'));
  fs.symlinkSync('a.txt', path.join(w.repo.dir, 'b.txt'));
  const r = await w.op('stage.discardFiles', { tracked: ['a.txt', 'gone.txt', 'b.txt'] });
  assert.deepEqual(r, { tracked: ['a.txt', 'gone.txt', 'b.txt'], untracked: [] });
  assert.deepEqual(w.status(), { 'a.txt': 'M ' });
  assert.equal(read(w, 'a.txt'), 'a staged\n');
  assert.equal(read(w, 'gone.txt'), 'gone\n');
  assert.equal(fs.lstatSync(path.join(w.repo.dir, 'b.txt')).isSymbolicLink(), false);
});

test('discard all (unstaged + untracked lists) leaves staged changes and ignored files intact', async (t) => {
  const w = await world(t);
  w.repo.commit({ '.gitignore': '*.log\n' });
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('new.txt', 'new\n');
  w.repo.write('keep.log', 'ignored\n');
  await w.op('stage.discardFiles', { tracked: ['a.txt'], untracked: ['new.txt'] });
  assert.deepEqual(w.status(), { 'b.txt': 'M ' });
  assert.equal(read(w, 'b.txt'), 'b staged\n');
  assert.equal(read(w, 'keep.log'), 'ignored\n');
  // The argv never carries -x or -d.
  const clean = w.execArgv().find((a) => a.includes('clean'));
  assert.ok(!clean.includes('-x') && !clean.includes('-d') && !clean.includes('-fd'));
});

test('tracked discard paths must each name one file in the index: `.`, a directory, a trailing slash or `.` segment discard nothing', async (t) => {
  const w = await world(t);
  w.repo.commit({ 'dir/c.txt': 'c\n' });
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('dir/c.txt', 'c2\n');
  for (const bad of ['.', 'dir', 'dir/', 'a.txt/', './a.txt', 'dir/./c.txt', 'gone-never.txt']) {
    await assert.rejects(w.op('stage.discardFiles', { tracked: ['a.txt', bad] }), refused('BAD_PATH'), bad);
  }
  assert.equal(read(w, 'a.txt'), 'a2\n');
  assert.equal(read(w, 'dir/c.txt'), 'c2\n');
  assert.equal(w.execArgv().filter((a) => a.includes('restore')).length, 0);
  // A file deleted from the worktree is still a file in the index.
  fs.rmSync(path.join(w.repo.dir, 'b.txt'));
  await w.op('stage.discardFiles', { tracked: ['b.txt'] });
  assert.equal(read(w, 'b.txt'), 'b\n');
});

test('a conflicted path is refused CONFLICTED and nothing is discarded', async (t) => {
  const w = await world(t);
  w.repo.branch('other');
  w.repo.commit({ 'a.txt': 'theirs\n' });
  w.repo.checkout('main');
  w.repo.commit({ 'a.txt': 'ours\n' });
  assert.throws(() => w.repo.git('merge', '-q', 'other'));
  const before = read(w, 'a.txt');
  w.repo.write('b.txt', 'b2\n');
  await assert.rejects(w.op('stage.discardFiles', { tracked: ['b.txt', 'a.txt'] }), refused('CONFLICTED'));
  assert.equal(read(w, 'a.txt'), before);
  assert.equal(read(w, 'b.txt'), 'b2\n');
});

test('staging a conflicted path marks it resolved', async (t) => {
  const w = await world(t);
  w.repo.branch('other');
  w.repo.commit({ 'a.txt': 'theirs\n' });
  w.repo.checkout('main');
  w.repo.commit({ 'a.txt': 'ours\n' });
  assert.throws(() => w.repo.git('merge', '-q', 'other'));
  w.repo.write('a.txt', 'merged\n');
  await w.op('stage.files', { paths: ['a.txt'] });
  assert.deepEqual(w.status(), { 'a.txt': 'M ' });
});

test('untracked discard refuses an ignored file, a tracked file, a directory and `dir/`, deleting nothing', async (t) => {
  const w = await world(t);
  w.repo.commit({ '.gitignore': '*.log\n' });
  w.repo.write('keep.log', 'ignored\n');
  w.repo.write('new.txt', 'new\n');
  w.repo.write('dir/inner.txt', 'inner\n');
  for (const bad of ['keep.log', 'a.txt', 'dir', 'dir/', 'missing.txt']) {
    await assert.rejects(w.op('stage.discardFiles', { untracked: ['new.txt', bad] }), refused('BAD_PATH'), bad);
  }
  for (const p of ['keep.log', 'a.txt', 'new.txt', 'dir/inner.txt']) assert.equal(exists(w, p), true, p);
});

test('a path through a symlinked directory is never discarded', async (t) => {
  const w = await world(t);
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'victim\n');
  fs.symlinkSync(outside, path.join(w.repo.dir, 'link'));
  await assert.rejects(w.op('stage.discardFiles', { untracked: ['link/victim.txt'] }), refused('BAD_PATH'));
  assert.equal(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8'), 'victim\n');
});

test('a request longer than one argv chunk is checked in full: a bad path in the last chunk refuses all of it', async (t) => {
  const w = await opWorld(t);
  w.repo.commit({ 'tracked.txt': 't\n' });
  // Each name is ~200 bytes, so the list spans several chunks of STAGE_LIMITS.argvChunkBytes.
  const n = Math.ceil((STAGE_LIMITS.argvChunkBytes * 2.5) / 200);
  const names = Array.from({ length: n }, (_, i) => `${String(i).padStart(5, '0')}-${'x'.repeat(190)}.txt`);
  for (const p of names) w.repo.write(p, `${p}\n`);
  await assert.rejects(w.op('stage.discardFiles', { untracked: [...names, 'tracked.txt'] }), refused('BAD_PATH'));
  assert.ok(names.every((p) => exists(w, p)));
  const lsBefore = w.execArgv().filter((a) => a.includes('ls-files')).length;
  assert.ok(lsBefore >= 3, `${lsBefore} ls-files commands`);
  await w.op('stage.discardFiles', { untracked: names });
  assert.ok(names.every((p) => !exists(w, p)));
  assert.ok(w.execArgv().filter((a) => a.includes('clean')).length >= 3);
  assert.equal(exists(w, 'tracked.txt'), true);
});

test('params: exactly one of paths/all; 1…maxPaths valid paths; discard needs a path', async (t) => {
  const w = await world(t);
  for (const name of ['stage.files', 'stage.unstageFiles']) {
    for (const p of [{}, { all: true, paths: ['a.txt'] }, { all: false }, { paths: [] }, { paths: 'a.txt' }, { paths: ['a.txt'], x: 1 }, null]) {
      await assert.rejects(w.op(name, p), refused('BAD_PARAMS'), `${name} ${JSON.stringify(p)}`);
    }
    await assert.rejects(w.op(name, { paths: Array.from({ length: STAGE_LIMITS.maxPaths + 1 }, (_, i) => `f${i}`) }), refused('BAD_PARAMS'));
    for (const p of ['../x', '/etc/passwd', 'a\\b', '']) await assert.rejects(w.op(name, { paths: [p] }), refused('BAD_PATH'), p);
  }
  for (const p of [{}, { tracked: [], untracked: [] }, { tracked: 'a.txt' }, { other: [] }]) {
    await assert.rejects(w.op('stage.discardFiles', p), refused('BAD_PARAMS'), JSON.stringify(p));
  }
  assert.equal(w.cc.state.execCalls.length, 0);
});
