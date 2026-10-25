import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';
import { readNoIndex, worktreeEntry } from '../src/git/diff/noIndex.js';
import { LIMITS } from '../src/git/limits.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { fifoBeforeRead, makeRepo, mkfifo, rejection, shortProbe, shortRead } from './_git.js';

// The stat-only probe behind worktreeEntry / readNoIndex / assertNoIndexReadsItself is bounded by
// DIFF_LIMITS.probeTimeoutMs, and readNoIndex's content read by DIFF_LIMITS.contentReadTimeoutMs: git opens a FIFO named on
// its command line, and neither may wait out the kind's timeout.

/** Well under the read (60 s) and write (300 s) timeouts a blocked read would otherwise wait out. */
const PROMPT_MS = 5000;
const FIFO_TEST = { timeout: 10_000 };

async function world(t) {
  const repo = makeRepo(t);
  repo.commit({ 'f.txt': 'f\n' }, 'base');
  const cc = await fakeCc({ projects: { repo: { dir: repo.dir } }, home: repo.home });
  t.after(() => cc.close());
  return { repo, cc, git: gitFor(ctxFor({ project: 'repo' })) };
}

const probeTimeout = (e, p, ms) => {
  assert.equal(e.code, 'PROBE_TIMEOUT', e.message);
  assert.deepEqual(e.extra, { path: p, timeoutMs: DIFF_LIMITS.probeTimeoutMs });
  assert.ok(ms < PROMPT_MS, `refused after ${ms} ms`);
};

test('a FIFO at a relative path: worktreeEntry and readNoIndex refuse PROBE_TIMEOUT {path, timeoutMs} promptly, the blocked git killed', FIFO_TEST, async (t) => {
  shortProbe(t);
  const w = await world(t);
  mkfifo(path.join(w.repo.dir, 'pipe'));
  for (const read of [() => worktreeEntry(w.git, 'pipe'), () => readNoIndex(w.git, 'pipe', { maxBytes: 1024 })]) {
    const { e, ms } = await rejection(read());
    probeTimeout(e, 'pipe', ms);
  }
  await w.cc.idle();
  assert.equal(w.cc.state.children.size, 0);
});

test('a FIFO at an absolute path outside the repo (a template location): readNoIndex refuses PROBE_TIMEOUT', FIFO_TEST, async (t) => {
  shortProbe(t);
  const w = await world(t);
  const fifo = path.join(w.repo.root, 'outside-pipe');
  mkfifo(fifo);
  const { e, ms } = await rejection(readNoIndex(w.git, fifo, { maxBytes: 1024 }));
  probeTimeout(e, fifo, ms);
});

test('under a short bound a regular file, a symlink, a directory and an absent path still probe as file / symlink / other / absent', async (t) => {
  shortProbe(t, 2000);
  const w = await world(t);
  fs.symlinkSync('f.txt', path.join(w.repo.dir, 'link'));
  fs.mkdirSync(path.join(w.repo.dir, 'dir'));
  assert.equal((await worktreeEntry(w.git, 'f.txt')).kind, 'file');
  assert.equal((await worktreeEntry(w.git, 'link')).kind, 'symlink');
  assert.equal((await worktreeEntry(w.git, 'dir')).kind, 'other');
  assert.equal((await worktreeEntry(w.git, 'nope')).kind, 'absent');
  const r = await readNoIndex(w.git, 'f.txt', { maxBytes: 1024 });
  assert.equal(r.kind, 'file');
  assert.equal(r.bytes.toString(), 'f\n');
  assert.equal((await readNoIndex(w.git, 'link', { maxBytes: 1024 })).linkTarget, 'f.txt');
});

test("the probe's exec carries DIFF_LIMITS.probeTimeoutMs and the content read DIFF_LIMITS.contentReadTimeoutMs, each read at call time", async (t) => {
  shortProbe(t, 4321);
  shortRead(t, 5432);
  const w = await world(t);
  await readNoIndex(w.git, 'f.txt', { maxBytes: 1024 });
  const diffs = w.cc.state.execCalls.filter((b) => b.argv.includes('--no-index'));
  assert.equal(diffs.length, 2);
  const [probe, content] = diffs;
  assert.ok(probe.argv.includes('--raw'), 'the probe runs first');
  assert.equal(probe.timeoutMs, 4321);
  assert.ok(!content.argv.includes('--raw'));
  assert.equal(content.timeoutMs, 5432);
  assert.notEqual(content.timeoutMs, LIMITS.read.timeoutMs);
});

test('a file swapped for a FIFO between the probe and the content read: readNoIndex refuses READ_TIMEOUT {path, timeoutMs} promptly, the blocked git killed', FIFO_TEST, async (t) => {
  shortRead(t);
  const w = await world(t);
  const swap = fifoBeforeRead(w.cc, w.repo.dir, 'f.txt');
  const { e, ms } = await rejection(readNoIndex(w.git, 'f.txt', { maxBytes: 1024 }));
  assert.equal(swap.done, true, 'the probe saw a regular file; the read met a FIFO');
  assert.equal(e.code, 'READ_TIMEOUT', e.message);
  assert.deepEqual(e.extra, { path: 'f.txt', timeoutMs: DIFF_LIMITS.contentReadTimeoutMs });
  assert.ok(ms < PROMPT_MS, `refused after ${ms} ms`);
  await w.cc.idle();
  assert.equal(w.cc.state.children.size, 0);
});
