import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fakeCc } from './_fakeCc.js';
import { hermeticEnv, tempDir } from './_git.js';
import { ELSEWHERE_FILES, elsewhereOf, elsewhereSnapshot, hostile, opWorld, refused } from './_ops.js';
import { getOp, OPS } from '../src/git/ops/index.js';
import { ctxFor, gitFor } from './_ctx.js';

// BASE_ARGS pins --work-tree=.: a repo's core.worktree cannot point code-git at another directory, and a bare
// repository is refused rather than treated as a working tree of its own files.

test('core.worktree pointing elsewhere: diff, stage, discard, restore and line staging read and change only the checkout', async (t) => {
  const w = await opWorld(t);
  const first = w.repo.commit({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  hostile(w.repo);
  const before = elsewhereSnapshot(w.repo);
  assert.deepEqual(before, ELSEWHERE_FILES);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('new.txt', 'new\n');

  const list = await w.op('diff.files', { source: { kind: 'unstaged' } });
  assert.deepEqual(list.files.map((f) => [f.path, f.status]), [['a.txt', 'M'], ['new.txt', '?']]);
  const fd = await w.op('diff.file', { source: { kind: 'unstaged' }, path: 'a.txt', whitespace: 'none' });
  assert.deepEqual(fd.hunks.flatMap((h) => h.lines.map((l) => l.text)), ['a', 'a2']);
  assert.deepEqual((await w.op('repo.summary')).counts, { staged: 0, unstaged: 1, untracked: 1, conflicted: 0 });

  await w.op('stage.files', { all: true });
  assert.deepEqual(w.status(), { 'a.txt': 'M ', 'new.txt': 'A ' });
  await w.op('stage.unstageFiles', { all: true });
  await w.op('stage.stageLines', { path: 'a.txt', context: 3, hunks: [{ header: fd.hunks[0].header, lines: [{ index: 0, text: 'a' }, { index: 1, text: 'a2' }] }] });
  assert.equal(w.indexBlob('a.txt').toString(), 'a2\n');
  await w.op('stage.unstageFiles', { all: true });
  await w.op('stage.discardFiles', { tracked: ['a.txt'], untracked: ['new.txt'] });
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'a.txt'), 'utf8'), 'a\n');
  assert.equal(fs.existsSync(path.join(w.repo.dir, 'new.txt')), false);
  w.repo.write('b.txt', 'b2\n');
  await w.op('files.restore', { oid: first, path: 'b.txt' });
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'b.txt'), 'utf8'), 'b\n');
  await w.op('ignore.add', { kind: 'path', value: 'x.log' });
  assert.equal(fs.readFileSync(path.join(w.repo.dir, '.gitignore'), 'utf8'), '/x.log\n');

  // Nothing under the other directory was read into an answer, changed or deleted.
  assert.deepEqual(elsewhereSnapshot(w.repo), before);
  assert.ok(!JSON.stringify([list, fd]).includes('ELSEWHERE'));
});

/** A bare repository registered as a cc project. */
async function bareWorld(t) {
  const root = tempDir(t, 'cg-bare-');
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const dir = path.join(root, 'bare.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', dir], { env: hermeticEnv(home) });
  const cc = await fakeCc({ projects: { bare: { dir } }, home });
  t.after(() => cc.close());
  const target = { project: 'bare', worktree: null };
  const op = (name, params) => {
    const def = getOp(OPS, name);
    return def.run(gitFor(ctxFor(target, def.kind, { op: name })), def.params(params), { target });
  };
  return { dir, op };
}

test('a bare repository is refused BARE_REPO by repo.summary, never listed as a working tree of its own files', async (t) => {
  const b = await bareWorld(t);
  await assert.rejects(b.op('repo.summary'), refused('BARE_REPO'));
});

test('working-tree writes refuse a bare repository before touching it: its HEAD and config survive', async (t) => {
  const b = await bareWorld(t);
  const head = fs.readFileSync(path.join(b.dir, 'HEAD'), 'utf8');
  for (const [name, params] of [
    ['stage.discardFiles', { untracked: ['HEAD', 'config'] }],
    ['stage.files', { all: true }],
    ['ignore.add', { kind: 'path', value: 'HEAD', stopTracking: true }],
    ['files.restore', { oid: 'a'.repeat(40), path: 'HEAD' }],
    ['patch.apply', { patchB64: Buffer.from('diff --git a/HEAD b/HEAD\n--- a/HEAD\n+++ b/HEAD\n@@ -1 +1 @@\n-x\n+y\n').toString('base64') }],
    ['stage.stageLines', { path: 'HEAD', hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }] }],
  ]) await assert.rejects(b.op(name, params), refused('BARE_REPO'), name);
  assert.equal(fs.readFileSync(path.join(b.dir, 'HEAD'), 'utf8'), head);
  assert.ok(fs.existsSync(path.join(b.dir, 'config')));
  assert.equal(fs.existsSync(path.join(b.dir, '.gitignore')), false);
});
