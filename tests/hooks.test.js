import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startApp } from './_app.js';
import { refsWorld, refused } from './_refsWorld.js';

// Hooks are honoured, never skipped (only commit.create's opt-in noVerify skips them), and what they print reaches the
// user: git sends a hook's stdout to stderr, a failing hook's stderr is GIT_FAILED's `stderr`, and a succeeding one's
// is on its activity entry (docs/features.md → Hooks); a pre-push hook's stdout, which git sends to stdout, is shown too.

const LOUD = (exit) => `#!/bin/sh\necho HOOK-OUT\necho HOOK-ERR >&2\nexit ${exit}\n`;
const hasBoth = (e) => {
  assert.match(e.extra.stderr, /HOOK-OUT/, 'the hook stdout');
  assert.match(e.extra.stderr, /HOOK-ERR/, 'the hook stderr');
  return true;
};

test('a failing pre-commit hook: GIT_FAILED with its stdout and stderr, and no commit', async (t) => {
  const w = await refsWorld(t);
  w.repo.write('n.txt', 'n\n');
  w.repo.git('add', 'n.txt');
  w.repo.hook('pre-commit', LOUD(1));
  await assert.rejects(w.op('commit.create', { summary: 'blocked' }), (e) => refused('GIT_FAILED')(e) && hasBoth(e));
  assert.equal(w.oid('HEAD'), w.base);
});

test("a failing pre-push hook: GIT_FAILED with its stdout and stderr (git sends a pre-push hook's stdout to stdout: the push shows it), and the remote unchanged", async (t) => {
  const w = await refsWorld(t);
  const next = w.repo.commit({ 'p.txt': 'p\n' }, 'p');
  w.repo.hook('pre-push', LOUD(1));
  await assert.rejects(w.op('remote.push', { branch: 'main' }), (e) => refused('GIT_FAILED')(e) && hasBoth(e));
  assert.equal(w.origin.git('rev-parse', 'main'), w.base);
  assert.notEqual(next, w.base);
});

test('a hook under core.hooksPath (repo config) runs: hooks are honoured where git looks for them', async (t) => {
  const w = await refsWorld(t);
  const dir = path.join(w.repo.root, 'shared-hooks');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pre-commit'), LOUD(1), { mode: 0o755 });
  w.repo.git('config', 'core.hooksPath', dir);
  w.repo.write('n.txt', 'n\n');
  w.repo.git('add', 'n.txt');
  await assert.rejects(w.op('commit.create', { summary: 'blocked' }), (e) => refused('GIT_FAILED')(e) && hasBoth(e));
  assert.equal(w.oid('HEAD'), w.base);
});

test("a succeeding post-commit hook's output is on the commit's activity entry", async (t) => {
  const w = await refsWorld(t);
  const app = await startApp(t);
  w.repo.write('n.txt', 'n\n');
  w.repo.git('add', 'n.txt');
  w.repo.hook('post-commit', LOUD(0));
  const r = await app.call('POST', '/api/ops/commit.create', { target: { project: 'repo' }, params: { summary: 'ok' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { entries } = (await app.call('GET', '/api/activity')).body;
  const entry = entries.find((e) => e.op === 'commit.create' && e.argv.includes('commit'));
  assert.equal(entry.status, 'ok');
  assert.match(entry.stderr, /HOOK-OUT/);
  assert.match(entry.stderr, /HOOK-ERR/);
});

test('merge.start with a failing pre-merge-commit hook: GIT_FAILED with its output; git leaves the merge in progress (MERGE_HEAD), as commit.state reports', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('checkout', '-q', '-b', 'side');
  const side = w.repo.commit({ 's.txt': 's\n' }, 's');
  w.repo.git('checkout', '-q', 'main');
  const head = w.repo.commit({ 'm.txt': 'm\n' }, 'm');
  w.repo.hook('pre-merge-commit', LOUD(1));
  await assert.rejects(w.op('merge.start', { ref: 'refs/heads/side', oid: side, mode: 'noFf', expect: head }), (e) => refused('GIT_FAILED')(e) && hasBoth(e));
  assert.equal(w.oid('HEAD'), head, 'no merge commit');
  assert.equal(w.oid('MERGE_HEAD'), side);
  const state = await w.op('commit.state', {});
  assert.equal(state.operation?.kind, 'merge');
});

test('branch.checkout with a failing post-checkout hook: GIT_FAILED with its output, and HEAD has moved (the hook runs after the switch)', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'other');
  w.repo.hook('post-checkout', LOUD(1));
  await assert.rejects(w.op('branch.checkout', { ref: 'refs/heads/other' }), (e) => refused('GIT_FAILED')(e) && hasBoth(e));
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/other');
});
