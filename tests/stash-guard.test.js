import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { assertFileTarget, assertNotBlocked, leadingDirs } from '../src/git/stash/guard.js';
import { STAGE_LIMITS } from '../src/git/stage/limits.js';
import { ctxFor, gitFor } from './_ctx.js';
import { refused } from './_ops.js';
import { outsideLink, runs, stashWorld } from './_stash.js';

test('prefix set: every proper leading directory, once', () => {
  assert.deepEqual(leadingDirs(['a/b/c']), ['a', 'a/b']);
  assert.deepEqual(leadingDirs(['a/b/c', 'a/d', 'top']), ['a', 'a/b']);
  assert.deepEqual(leadingDirs(['x']), []);
});

async function guardWorld(t) {
  const w = await stashWorld(t, { 'tracked/f.txt': 'f\n', 'a.txt': 'a\n' });
  const git = gitFor(ctxFor(w.target, 'write'));
  return { ...w, guard: (paths) => assertNotBlocked(git, paths) };
}

test('an untracked file or symlink at a prefix is blocked; a tracked or untracked dir is not; an ignored symlink is blocked', async (t) => {
  const w = await guardWorld(t);
  outsideLink(w, 'link');
  w.repo.write('file', 'not a dir\n');
  w.repo.write('untracked-dir/u.txt', 'u\n');
  await assert.rejects(w.guard(['link/x']), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === 'link');
  await assert.rejects(w.guard(['file/x']), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === 'file');
  await w.guard(['tracked/f.txt', 'tracked/new/x', 'untracked-dir/u.txt', 'absent/deep/x', 'a.txt']);
  outsideLink(w, 'ignored-link');
  fs.appendFileSync(path.join(w.repo.dir, '.git', 'info', 'exclude'), 'ignored-link\n');
  await assert.rejects(w.guard(['ignored-link/y']), refused('PATH_BLOCKED'));
  // A link deeper down is found through its own prefix.
  outsideLink(w, 'tracked/inner');
  await assert.rejects(w.guard(['tracked/inner/z']), (e) => e.extra.paths.join() === 'tracked/inner');
});

test('the guard chunks its argv (STAGE_LIMITS.argvChunkBytes)', async (t) => {
  const w = await guardWorld(t);
  const dirs = Array.from({ length: Math.ceil((STAGE_LIMITS.argvChunkBytes * 2) / 60) }, (_, i) => `${'d'.repeat(50)}${i}/f`);
  outsideLink(w, `${'d'.repeat(50)}${dirs.length - 1}`);
  await assert.rejects(w.guard(dirs), refused('PATH_BLOCKED'));
  const lsCalls = runs(w, 'ls-files', '--others', '--directory');
  assert.ok(lsCalls.length >= 2);
  for (const a of lsCalls) assert.ok(Buffer.byteLength(a.slice(a.indexOf('--') + 1).join('\0')) <= STAGE_LIMITS.argvChunkBytes);
});

test('with core.ignorecase the guard folds case: a symlink `Link` blocks `link/x` (the parent is listed); without it, it does not', async (t) => {
  const w = await guardWorld(t);
  outsideLink(w, 'Link');
  outsideLink(w, 'tracked/Inner');
  await w.guard(['link/x', 'tracked/inner/y']);
  w.repo.git('config', 'core.ignorecase', 'true');
  await assert.rejects(w.guard(['link/x']), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === 'Link');
  await assert.rejects(w.guard(['tracked/inner/y']), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === 'tracked/Inner');
  await w.guard(['LINKS/x', 'tracked/f.txt']);
});

test('assertFileTarget: a directory or a link to one at the path is blocked; a file, a symlink to a file or nothing is not', async (t) => {
  const w = await guardWorld(t);
  const git = gitFor(ctxFor(w.target, 'write'));
  outsideLink(w, 'dirlink');
  fs.symlinkSync('a.txt', path.join(w.repo.dir, 'filelink'));
  fs.mkdirSync(path.join(w.repo.dir, 'adir'));
  for (const p of ['dirlink', 'adir']) await assert.rejects(assertFileTarget(git, p), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === p, p);
  for (const p of ['a.txt', 'absent.txt', 'filelink']) await assertFileTarget(git, p);
});

test('a non-boolean core.ignorecase (auto) reads as false: the failure is git\'s own on the listing, with its message', async (t) => {
  const w = await guardWorld(t);
  w.repo.git('config', 'core.ignorecase', 'auto');
  // git refuses the value for every command (status, rev-parse, stash list…); the guard's config read is not where it fails.
  await assert.rejects(w.guard(['link/x']), (e) => e.code === 'GIT_FAILED' && e.message === 'git ls-files exited with 128' && /bad boolean config value 'auto'/.test(e.extra.stderr));
  assert.equal(runs(w, 'config', '--type=bool', '--get', 'core.ignorecase').length, 1);
});

test('with core.ignorecase a link inside a fully untracked directory (u/s) is still found: the directories are queried too', async (t) => {
  const w = await guardWorld(t);
  fs.mkdirSync(path.join(w.repo.dir, 'u'));
  outsideLink(w, 'u/s');
  w.repo.git('config', 'core.ignorecase', 'true');
  await assert.rejects(w.guard(['u/s/x']), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === 'u/s');
});
