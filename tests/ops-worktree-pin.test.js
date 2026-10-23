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

/**
 * A bare repository registered as a cc project, its core.bare as `bare` says: 'true', 'false', 'unset' or 'include-false';
 * 'newline-path' is core.bare false at a path holding a newline (`evil\nmirror.git`), which a split on `\n` would misread.
 */
async function bareWorld(t, bare = 'true') {
  const root = tempDir(t, 'cg-bare-');
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const dir = path.join(root, bare === 'newline-path' ? 'evil\nmirror.git' : 'bare.git');
  const env = hermeticEnv(home);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { env });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', dir], { env });
  fs.writeFileSync(path.join(dir, 'config'), `${fs.readFileSync(path.join(dir, 'config'), 'utf8')}[secret]\n\ttoken = TOKEN-7d1e\n`);
  if (bare === 'false' || bare === 'newline-path') git('config', 'core.bare', 'false');
  if (bare === 'unset') git('config', '--unset', 'core.bare');
  if (bare === 'include-false') {
    const inc = path.join(root, 'inc.cfg');
    fs.writeFileSync(inc, '[core]\n\tbare = false\n');
    git('config', 'include.path', inc);
  }
  const cc = await fakeCc({ projects: { bare: { dir } }, home });
  t.after(() => cc.close());
  const target = { project: 'bare', worktree: null };
  const op = (name, params) => {
    const def = getOp(OPS, name);
    return def.run(gitFor(ctxFor(target, def.kind, { op: name })), def.params(params), { target });
  };
  const snapshot = () => ({
    HEAD: fs.readFileSync(path.join(dir, 'HEAD'), 'utf8'), config: fs.readFileSync(path.join(dir, 'config'), 'utf8'),
    entries: fs.readdirSync(dir).sort(), refs: execFileSync('git', ['-C', dir, 'for-each-ref'], { env }).toString(),
  });
  return { dir, op, snapshot };
}

const WRITES = [
  ['stage.discardFiles', { untracked: ['HEAD', 'config'] }],
  ['stage.files', { all: true }],
  ['stage.unstageFiles', { all: true }],
  ['commit.create', { summary: 'leak', amend: false }],
  ['ignore.add', { kind: 'path', value: 'HEAD', stopTracking: true }],
  ['files.restore', { oid: 'a'.repeat(40), path: 'HEAD' }],
  ['patch.apply', { patchB64: Buffer.from('diff --git a/HEAD b/HEAD\n--- a/HEAD\n+++ b/HEAD\n@@ -1 +1 @@\n-x\n+y\n').toString('base64') }],
  ['stage.stageLines', { path: 'HEAD', hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }] }],
  ['stage.unstageLines', { path: 'HEAD', hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }] }],
  ['stage.discardLines', { path: 'HEAD', hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }] }],
  ['stash.push', {}],
];

for (const bare of ['true', 'false', 'unset', 'include-false', 'newline-path']) {
  test(`a bare repository (core.bare ${bare}) is refused BARE_REPO by repo.summary and by every working-tree write; HEAD, config and refs survive`, async (t) => {
    const b = await bareWorld(t, bare);
    const before = b.snapshot();
    await assert.rejects(b.op('repo.summary'), refused('BARE_REPO'));
    for (const [name, params] of WRITES) await assert.rejects(b.op(name, params), refused('BARE_REPO'), name);
    assert.deepEqual(b.snapshot(), before);
    assert.equal(fs.existsSync(path.join(b.dir, '.gitignore')), false);
  });
}

test('repo.summary decides bareness before git status runs (no walk of a bare objects/)', async (t) => {
  const root = tempDir(t, 'cg-bare-');
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const dir = path.join(root, 'bare.git');
  execFileSync('git', ['init', '-q', '--bare', dir], { env: hermeticEnv(home) });
  const cc = await fakeCc({ projects: { bare: { dir } }, home });
  t.after(() => cc.close());
  const def = getOp(OPS, 'repo.summary');
  await assert.rejects(def.run(gitFor(ctxFor({ project: 'bare' }, 'read')), {}, { target: { project: 'bare' } }), refused('BARE_REPO'));
  assert.ok(!cc.state.execCalls.some((b) => b.argv.includes('status')));
});

test('a normal repo, a linked worktree, a linked worktree of a bare repo and a --separate-git-dir clone are not bare: summary and a write work', async (t) => {
  const w = await opWorld(t);
  w.repo.commit({ 'a.txt': 'a\n' });
  const env = hermeticEnv(w.repo.home);
  const wt = w.repo.worktreeAdd(path.join(w.repo.root, 'wt'), 'feature');
  const sepDir = path.join(w.repo.root, 'sep');
  execFileSync('git', ['init', '-q', '-b', 'main', '--separate-git-dir', path.join(w.repo.root, 'sep-gitdir'), sepDir], { env });
  const bareDir = path.join(w.repo.root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bareDir], { env });
  w.repo.git('push', '-q', bareDir, 'HEAD:main');
  const bareWt = path.join(w.repo.root, 'bare-wt');
  execFileSync('git', ['-C', bareDir, 'worktree', 'add', '-q', bareWt, 'main'], { env });
  const dirs = { repo: w.repo.dir, wt: wt.dir, sep: sepDir, bareWt };
  w.cc.state.projects.wt = { dir: wt.dir };
  w.cc.state.projects.sep = { dir: sepDir };
  w.cc.state.projects.bareWt = { dir: bareWt };
  for (const project of ['repo', 'wt', 'sep', 'bareWt']) {
    const target = { project, worktree: null };
    const run = (name, params) => { const def = getOp(OPS, name); return def.run(gitFor(ctxFor(target, def.kind, { op: name })), def.params(params), { target }); };
    fs.writeFileSync(path.join(dirs[project], 'n.txt'), 'n\n');
    assert.equal((await run('repo.summary')).counts.untracked, 1, project);
    await run('stage.files', { paths: ['n.txt'] });
    assert.equal((await run('repo.summary')).counts.staged, 1, project);
  }
});
