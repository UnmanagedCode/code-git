import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { STAGE_LIMITS } from '../src/git/stage/limits.js';
import { hostile, noViolations, opWorld, refused } from './_ops.js';

async function world(t) {
  const w = await opWorld(t);
  const first = w.repo.commit({ 'a.txt': 'a v1\n', 'b.txt': 'b\n', 'dir/c.txt': 'c\n' }, 'first');
  w.repo.commit({ 'a.txt': 'a v2\n' }, 'second');
  hostile(w.repo);
  return { ...w, first };
}
const read = (w, p) => fs.readFileSync(path.join(w.repo.dir, p), 'utf8');
const exists = (w, p) => fs.existsSync(path.join(w.repo.dir, p));
const b64 = (s) => Buffer.from(s).toString('base64');
const newFile = (p, body = 'evil') => `diff --git a/${p} b/${p}\nnew file mode 100644\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1 @@\n+${body}\n`;
const edit = (p, from, to) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-${from}\n+${to}\n`;

test('files.restore puts the commit\'s version in the index and the worktree, over uncommitted work', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'staged\n');
  w.repo.git('add', 'a.txt');
  w.repo.write('a.txt', 'unstaged\n');
  assert.deepEqual(await w.op('files.restore', { oid: w.first, path: 'a.txt' }), { oid: w.first, path: 'a.txt' });
  assert.equal(read(w, 'a.txt'), 'a v1\n');
  assert.equal(w.indexBlob('a.txt').toString(), 'a v1\n');
  assert.deepEqual(w.status(), { 'a.txt': 'M ' });
  noViolations(w.cc);
});

test('files.restore refuses PATH_NOT_IN_COMMIT for an absent path or a directory, REV_UNKNOWN for a non-commit', async (t) => {
  const w = await world(t);
  await assert.rejects(w.op('files.restore', { oid: w.first, path: 'nope.txt' }), refused('PATH_NOT_IN_COMMIT'));
  await assert.rejects(w.op('files.restore', { oid: w.first, path: 'dir' }), refused('PATH_NOT_IN_COMMIT'));
  const blob = w.repo.git('rev-parse', `${w.first}:a.txt`);
  await assert.rejects(w.op('files.restore', { oid: blob, path: 'a.txt' }), refused('REV_UNKNOWN'));
  await assert.rejects(w.op('files.restore', { oid: 'f'.repeat(40), path: 'a.txt' }), refused('REV_UNKNOWN'));
  for (const p of [{ oid: 'HEAD', path: 'a.txt' }, { oid: w.first.slice(0, 10), path: 'a.txt' }, { oid: w.first }]) {
    await assert.rejects(w.op('files.restore', p), (e) => ['BAD_PARAMS', 'BAD_PATH'].includes(e.code));
  }
  assert.equal(read(w, 'a.txt'), 'a v2\n');
});

test('files.restore through an untracked symlinked directory writes inside the repo, never through the link', async (t) => {
  const w = await world(t);
  const withDir = w.repo.commit({ 'link/t.txt': 'v1\n' }, 'dir');
  w.repo.git('rm', '-rq', '--cached', 'link');
  fs.rmSync(path.join(w.repo.dir, 'link'), { recursive: true });
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.repo.dir, 'link'));
  w.repo.git('commit', '-q', '-m', 'rm dir');
  await w.op('files.restore', { oid: withDir, path: 'link/t.txt' });
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.lstatSync(path.join(w.repo.dir, 'link')).isDirectory(), true);
  assert.equal(read(w, 'link/t.txt'), 'v1\n');
});

test('files.restore refuses a path that does not name one file: `.`, a trailing slash, an empty or `.` segment', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'changed\n');
  for (const p of ['.', 'a.txt/', 'dir/', './a.txt', 'dir//c.txt', 'dir/./c.txt']) {
    await assert.rejects(w.op('files.restore', { oid: w.first, path: p }), refused('BAD_PATH'), p);
  }
  await assert.rejects(w.op('files.restore', { oid: w.first, path: 'dir' }), refused('PATH_NOT_IN_COMMIT'));
  assert.equal(read(w, 'a.txt'), 'changed\n');
  assert.equal(w.cc.state.execCalls.filter((b) => b.argv.includes('restore')).length, 0);
});

test('patch.check reports numstat and changes nothing', async (t) => {
  const w = await world(t);
  const patch = edit('a.txt', 'a v2', 'a v3') + newFile('new.txt', 'n');
  const r = await w.op('patch.check', { patchB64: b64(patch) });
  assert.deepEqual(r.files, [{ path: 'a.txt', added: 1, deleted: 1 }, { path: 'new.txt', added: 1, deleted: 0 }]);
  assert.equal(read(w, 'a.txt'), 'a v2\n');
  assert.equal(exists(w, 'new.txt'), false);
  const argv = w.execArgv().find((a) => a.includes('apply'));
  assert.ok(argv.includes('--check'));
});

test('patch.apply to the worktree or the index only', async (t) => {
  const w = await world(t);
  await w.op('patch.apply', { patchB64: b64(edit('a.txt', 'a v2', 'wt')), apply: 'worktree' });
  assert.deepEqual(w.status(), { 'a.txt': ' M' });
  assert.equal(read(w, 'a.txt'), 'wt\n');
  await w.op('patch.apply', { patchB64: b64(edit('b.txt', 'b', 'idx')), apply: 'index' });
  assert.equal(w.indexBlob('b.txt').toString(), 'idx\n');
  assert.equal(read(w, 'b.txt'), 'b\n');
});

test('a mailbox patch (format-patch) applies: git skips the mail header', async (t) => {
  const w = await world(t);
  const mbox = `From ${'0'.repeat(40)} Mon Sep 17 00:00:00 2001\nFrom: T <t@example.com>\nDate: Mon, 1 Jan 2024 00:00:00 +0000\nSubject: [PATCH] edit\n\n---\n a.txt | 2 +-\n\n${edit('a.txt', 'a v2', 'mailed')}--\n2.0\n\n`;
  await w.op('patch.apply', { patchB64: b64(mbox) });
  assert.equal(read(w, 'a.txt'), 'mailed\n');
});

test('atomic: a multi-file patch whose second file fails changes nothing (PATCH_DOES_NOT_APPLY with stderr)', async (t) => {
  const w = await world(t);
  const patch = edit('a.txt', 'a v2', 'changed') + edit('b.txt', 'not b', 'x');
  for (const name of ['patch.check', 'patch.apply']) {
    await assert.rejects(w.op(name, { patchB64: b64(patch) }), (e) => e.code === 'PATCH_DOES_NOT_APPLY' && /b\.txt/.test(e.extra.stderr));
  }
  assert.equal(read(w, 'a.txt'), 'a v2\n');
  // Not a patch at all: git exits 128 "No valid patches in input".
  await assert.rejects(w.op('patch.apply', { patchB64: b64('hello\n') }), (e) => e.code === 'PATCH_DOES_NOT_APPLY' && e.extra.exitCode === 128);
});

test('worktree mode refuses .., .git/, absolute paths and a path through an untracked dir symlink, writing nothing', async (t) => {
  const w = await world(t);
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.repo.dir, 'link'));
  for (const p of ['../escaped.txt', '.git/hooks/post-commit', '/tmp/abs-escape.txt', 'link/through.txt']) {
    for (const name of ['patch.check', 'patch.apply']) {
      await assert.rejects(w.op(name, { patchB64: b64(newFile(p)) }), refused('PATCH_DOES_NOT_APPLY'), `${name} ${p}`);
    }
  }
  assert.equal(fs.existsSync(path.join(w.repo.root, 'escaped.txt')), false);
  assert.equal(fs.existsSync('/tmp/abs-escape.txt'), false);
  assert.equal(fs.existsSync(path.join(w.repo.dir, '.git', 'hooks', 'post-commit')), false);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('index mode writes nothing on disk, even for a path through an untracked dir symlink; .., .git/ and absolute stay refused', async (t) => {
  const w = await world(t);
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.repo.dir, 'link'));
  for (const p of ['../escaped.txt', '.git/hooks/post-commit', '/tmp/abs-escape.txt']) {
    await assert.rejects(w.op('patch.apply', { patchB64: b64(newFile(p)), apply: 'index' }), refused('PATCH_DOES_NOT_APPLY'), p);
  }
  // git accepts this one into the index only (it never checks the worktree with --cached): nothing reaches the disk.
  await w.op('patch.apply', { patchB64: b64(newFile('link/through.txt')), apply: 'index' });
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(w.repo.root, 'escaped.txt')), false);
});

test("apply 'both' (git apply --index) is refused BAD_PARAMS: --index writes through an untracked symlink", async (t) => {
  const w = await world(t);
  for (const name of ['patch.check', 'patch.apply']) {
    await assert.rejects(w.op(name, { patchB64: b64(edit('a.txt', 'a v2', 'x')), apply: 'both' }), refused('BAD_PARAMS'));
  }
  assert.equal(w.cc.state.execCalls.length, 0);
  assert.equal(read(w, 'a.txt'), 'a v2\n');
});

test('params: strict base64, 1…applyPatchMaxBytes, a known target', async (t) => {
  const w = await world(t);
  const big = Buffer.alloc(STAGE_LIMITS.applyPatchMaxBytes + 1, 'a').toString('base64');
  for (const p of [{}, { patchB64: '' }, { patchB64: 'not base64!' }, { patchB64: 'YQ' }, { patchB64: big }, { patchB64: b64('x'), apply: 'remote' }, { patchB64: b64('x'), extra: 1 }]) {
    for (const name of ['patch.check', 'patch.apply']) await assert.rejects(w.op(name, p), refused('BAD_PARAMS'), `${name} ${JSON.stringify(p).slice(0, 60)}`);
  }
  assert.equal(w.cc.state.execCalls.length, 0);
});
