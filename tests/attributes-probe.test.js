import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { consultsAttributes } from '../src/git/attributes.js';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';
import { LIMITS } from '../src/git/limits.js';
import { createLocks } from '../src/git/locks.js';
import { LOG_SAFE } from '../src/git/ops/graph.js';
import { BASE_ARGS, runGit } from '../src/git/runner.js';
import { ctxFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { lockFree, mkfifo, rejection, shortProbe, tempDir } from './_git.js';
import { LFS_SKIP, lfsAvailable, lfsWorld, runsLfs } from './_lfs.js';
import { opWorld } from './_ops.js';
import { afterBase, subWorld } from './_submodules.js';

// git opens its attribute files (the system file, core.attributesFile or its XDG default, the root .gitattributes,
// .git/info/attributes) inside unrelated commands, with no O_NONBLOCK: a FIFO there blocks the command until the
// kind's timeout. runGit probes them with one bounded `check-attr` per op run and target, before the first command
// that consults attributes (src/git/attributes.js), and refuses ATTRIBUTES_TIMEOUT.

const HAVE_LFS = lfsAvailable();
const FIFO_TEST = { timeout: 10_000 };
/** Well under the read (60 s) and write (300 s) timeouts a blocked command would otherwise wait out. */
const PROMPT_MS = 5000;
const PROBE = ['check-attr', '-z', 'filter', '--', '.gitattributes'];
const isProbe = (a) => a.includes('check-attr');
/** Every exec's argv after BASE_ARGS (a submodule target's `-C <sub> --git-dir=.git` kept). */
const argvsOf = (cc) => cc.state.execCalls.map((b) => afterBase(b.argv));

/** A committed repo whose tracked files are stat-dirty: git would hash them, consulting their attributes. */
async function world(t) {
  const w = await opWorld(t);
  w.repo.commit({ 'a.txt': 'a\n', 'sub/b.txt': 'b\n' }, 'base');
  w.statDirty = (...rels) => {
    const later = Date.now() / 1000 + 10;
    for (const rel of rels.length ? rels : ['a.txt', 'sub/b.txt']) fs.utimesSync(path.join(w.repo.dir, rel), later, later);
  };
  w.statDirty();
  w.argvs = () => argvsOf(w.cc);
  return w;
}

/** `p` refuses ATTRIBUTES_TIMEOUT {timeoutMs} within PROMPT_MS. */
async function refusesPromptly(p, label) {
  const { e, ms } = await rejection(p);
  assert.equal(e.code, 'ATTRIBUTES_TIMEOUT', `${label}: ${e.message}`);
  assert.deepEqual(e.extra, { timeoutMs: DIFF_LIMITS.probeTimeoutMs }, label);
  assert.ok(ms < PROMPT_MS, `${label} refused after ${ms} ms`);
}

/** The fake cc killed every command it spawned: no blocked git is left behind. */
async function noneLeft(cc) {
  await cc.idle();
  assert.equal(cc.state.children.size, 0, 'no blocked git left');
}

// Invariant: a FIFO root .gitattributes refuses each op promptly with the honest code; a write never reaches its own
// command, and the project lock is free afterwards.
test('a FIFO root .gitattributes: repo.summary, diff.files, diff.file and stage.files refuse ATTRIBUTES_TIMEOUT {timeoutMs} promptly; stage.files never runs `add` and leaves the lock free', FIFO_TEST, async (t) => {
  shortProbe(t);
  const w = await world(t);
  mkfifo(path.join(w.repo.dir, '.gitattributes'));
  const locks = createLocks();
  await refusesPromptly(w.op('repo.summary', {}), 'repo.summary');
  await refusesPromptly(w.op('diff.files', { source: { kind: 'unstaged' } }), 'diff.files');
  await refusesPromptly(w.op('diff.file', { source: { kind: 'unstaged' }, path: 'a.txt' }), 'diff.file');
  await refusesPromptly(w.op('stage.files', { all: true }, { locks }), 'stage.files');
  assert.equal(w.argvs().some((a) => a[0] === 'add'), false, '`add` never ran');
  assert.equal(await lockFree(locks, 'repo'), true, 'the project lock is released');
  await noneLeft(w.cc);
});

// Invariant: the LFS commands git-lfs runs (which open .gitattributes) are probed too: git-lfs never runs.
test('a FIFO root .gitattributes: lfs.files and lfs.prune refuse ATTRIBUTES_TIMEOUT promptly; git-lfs never runs `ls-files` or `prune`, and the lock is free', { ...FIFO_TEST, skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  shortProbe(t);
  const w = await lfsWorld(t);
  const attrs = path.join(w.repo.dir, '.gitattributes');
  fs.rmSync(attrs);
  mkfifo(attrs);
  const locks = createLocks();
  for (const name of ['lfs.files', 'lfs.prune']) await refusesPromptly(w.op(name, {}, { locks }), name);
  assert.equal(w.argvs().some((a) => runsLfs(a, 'ls-files') || runsLfs(a, 'prune')), false, 'git-lfs never listed or pruned');
  assert.equal(await lockFree(locks, 'repo'), true, 'the project lock is released');
  await noneLeft(w.cc);
});

// Invariant: the probe covers the attribute files outside the worktree, followed through links, devices included —
// not just a hard-coded `.gitattributes` path.
test('the other attribute files: a FIFO .git/info/attributes, a FIFO core.attributesFile, a FIFO at the XDG default, and core.attributesFile → /dev/zero each refuse ATTRIBUTES_TIMEOUT promptly', FIFO_TEST, async (t) => {
  shortProbe(t);
  const w = await world(t);
  const outside = tempDir(t, 'cg-attrs-');
  const info = path.join(w.repo.dir, '.git', 'info', 'attributes');
  const xdg = path.join(w.repo.home, '.config', 'git', 'attributes');
  const layouts = {
    'info/attributes': {
      make() { fs.mkdirSync(path.dirname(info), { recursive: true }); mkfifo(info); },
      undo() { fs.rmSync(info); },
      ops: ['repo.summary', 'stage.files'],
    },
    'core.attributesFile → a FIFO': {
      make() { mkfifo(path.join(outside, 'pipe')); w.repo.git('config', 'core.attributesFile', path.join(outside, 'pipe')); },
      undo() { w.repo.git('config', '--unset', 'core.attributesFile'); },
      ops: ['repo.summary'],
    },
    'the XDG default (no core.attributesFile)': {
      make() { fs.mkdirSync(path.dirname(xdg), { recursive: true }); mkfifo(xdg); },
      undo() { fs.rmSync(xdg); },
      ops: ['repo.summary'],
    },
    'core.attributesFile → a link to /dev/zero': {
      make() { fs.symlinkSync('/dev/zero', path.join(outside, 'zero')); w.repo.git('config', 'core.attributesFile', path.join(outside, 'zero')); },
      undo() { w.repo.git('config', '--unset', 'core.attributesFile'); },
      ops: ['repo.summary'],
    },
  };
  const locks = createLocks();
  for (const [layout, { make, undo, ops }] of Object.entries(layouts)) {
    make();
    for (const name of ops) await refusesPromptly(w.op(name, name === 'stage.files' ? { all: true } : {}, { locks }), `${layout} ${name}`);
    undo();
  }
  assert.equal(w.argvs().some((a) => a[0] === 'add'), false, '`add` never ran');
  assert.equal(await lockFree(locks, 'repo'), true, 'the project lock is released');
  await noneLeft(w.cc);
  await w.op('repo.summary', {}); // every layout undone: the op succeeds again
});

// Invariant: the probe is a read: it never holds the project lock, even inside a write op, and it runs bounded by
// DIFF_LIMITS.probeTimeoutMs (read at call time) under the read env.
test('the probe of a write op holds no lock while it runs, is bounded by DIFF_LIMITS.probeTimeoutMs and runs under the read env', async (t) => {
  shortProbe(t, 4321);
  const w = await world(t);
  w.cc.state.execHook = (body) => (isProbe(afterBase(body.argv)) ? 'hold' : undefined);
  const locks = createLocks();
  const p = w.op('stage.files', { all: true }, { locks });
  const held = await w.cc.nextHeld();
  assert.equal(await lockFree(locks, 'repo'), true, 'no lock is held during the probe');
  assert.deepEqual(afterBase(held.body.argv), PROBE);
  assert.equal(held.body.timeoutMs, 4321);
  assert.equal(held.body.env.GIT_OPTIONAL_LOCKS, '0', 'the read env');
  w.cc.state.execHook = null;
  held.release();
  await p;
  assert.ok(w.argvs().some((a) => a[0] === 'add'), 'the op ran after the probe');
});

// Invariant: a submodule target is probed in its own repository (`-C <sub> --git-dir=.git`), through the route's ctx.
test("a submodule target: a FIFO at the submodule's root .gitattributes refuses repo.summary there ATTRIBUTES_TIMEOUT; the probe runs in the submodule", FIFO_TEST, async (t) => {
  shortProbe(t);
  const w = await subWorld(t, { nested: false });
  mkfifo(path.join(w.repo.dir, 'libA', '.gitattributes'));
  const t0 = performance.now();
  const r = await w.op('repo.summary', undefined, ['libA']);
  assert.ok(performance.now() - t0 < PROMPT_MS);
  assert.equal(r.status, 504);
  assert.equal(r.body.code, 'ATTRIBUTES_TIMEOUT', r.body.error);
  assert.deepEqual(w.execArgv().map(afterBase).filter(isProbe), [['-C', 'libA', '--git-dir=.git', ...PROBE]]);
  await noneLeft(w.cc);
});

// Invariant: one probe per op run and target: memoised on the run's ctx (shared by its spreads), keyed by target.
test('once per op run and target: one ctx probes the checkout and a submodule once each, before their first consulting command; a FIFO in the submodule refuses only there', FIFO_TEST, async (t) => {
  shortProbe(t);
  const w = await subWorld(t, { nested: false });
  const root = { project: 'repo', worktree: null };
  const sub = { ...root, sub: ['libA'] };
  const ctx = ctxFor(root, 'read');
  const at = (target) => ({ ...ctx, target });
  for (let i = 0; i < 2; i++) {
    await runGit(at(root), ['status', '--porcelain']);
    await runGit(at(sub), ['diff', '--quiet'], { okExit: [0, 1] });
  }
  assert.deepEqual(w.execArgv().map(afterBase), [
    PROBE, ['status', '--porcelain'], ['-C', 'libA', '--git-dir=.git', ...PROBE], ['-C', 'libA', '--git-dir=.git', 'diff', '--quiet'],
    ['status', '--porcelain'], ['-C', 'libA', '--git-dir=.git', 'diff', '--quiet'],
  ]);
  // The checkout probed clean in this run; the submodule is still probed, and refuses.
  const other = ctxFor(root, 'read');
  await runGit({ ...other, target: root }, ['status', '--porcelain']);
  mkfifo(path.join(w.repo.dir, 'libA', '.gitattributes'));
  await refusesPromptly(runGit({ ...other, target: sub }, ['diff', '--quiet'], { okExit: [0, 1] }), 'submodule after a clean checkout probe');
  // The rejection is memoised: the next consulting command of that run refuses the same way, with no second probe.
  const probes = w.execArgv().filter((a) => a.includes('check-attr')).length;
  await refusesPromptly(runGit({ ...other, target: sub }, ['status']), 'memoised');
  assert.equal(w.execArgv().filter((a) => a.includes('check-attr')).length, probes);
  await noneLeft(w.cc);
});

// Invariant: an op run with several consulting commands probes once, before the first of them.
test('stage.discardFiles (several consulting commands) runs exactly one probe, and every command before it is attribute-free', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'changed\n');
  await w.op('stage.discardFiles', { tracked: ['a.txt'] });
  const argvs = w.argvs();
  const at = argvs.findIndex(isProbe);
  assert.equal(argvs.filter(isProbe).length, 1, 'one probe');
  assert.ok(at >= 0);
  assert.ok(argvs.slice(0, at).every((a) => !consultsAttributes(a)), `before the probe: ${JSON.stringify(argvs.slice(0, at))}`);
  assert.ok(argvs.slice(at + 1).some((a) => consultsAttributes(a)), 'a consulting command follows');
});

// Invariant: an op run made only of allow-listed commands never probes, and those commands do not block on a FIFO.
test('allow-listed runs never probe, and run past a FIFO root .gitattributes: graph.refs, graph.page, graph.search, history.file, branch.rename', FIFO_TEST, async (t) => {
  const w = await world(t);
  mkfifo(path.join(w.repo.dir, '.gitattributes'));
  const tips = [w.repo.git('rev-parse', 'HEAD')];
  await w.op('graph.refs', {});
  await w.op('graph.page', { tips, skip: 0, limit: 10 });
  await w.op('graph.search', { mode: 'commits', query: 'base', tips });
  await w.op('graph.search', { mode: 'path', query: 'a.txt', tips });
  await w.op('history.file', { rev: tips[0], path: 'a.txt', skip: 0, limit: 10 });
  await w.op('branch.rename', { name: 'main', newName: 'trunk' });
  assert.deepEqual(w.argvs().filter(isProbe), []);
  await noneLeft(w.cc);
});

// Invariant: the allow-list fails toward probing: an unknown subcommand, or an unmeasured form of a listed one, probes.
test('consultsAttributes: unlisted subcommands and unmeasured forms consult; the measured forms do not', () => {
  const consults = [
    ['frobnicate'], ['status'], ['add', '-A'], ['push', 'origin', 'main'], ['diff', '--cached', '--name-only'], ['read-tree', '--empty'], ['lfs', 'version'],
    ['log', '--shortstat'], ['log', '-p'], ['log', '--unknown-flag'], ['log', '--no-walk=unsorted', '--stdin', ...LOG_SAFE, '--root', '--format=%H', '--shortstat'],
    ['log', '--stat'], ['log', '-S', 'x'], ['log', '--patch'],
    ['stash', 'apply', '-q', 'abc'], ['stash', 'push'], ['stash', 'create'], ['stash', 'show', '-p'], ['stash'], ['stash', 'list', '-p'], ['stash', 'list', '--stat'],
    ['worktree', 'add', 'x'], ['worktree', 'remove', 'x'], ['worktree'],
    ['ls-files', '--eol'], ['ls-files', '-z', '--eol', '--', 'a'], ['ls-files', '--eo'],
    // `--textconv` and `--filters` run the attribute's conversion; git accepts unique prefixes (`--t`; `--fi`, `--f` on a
    // git without `--filter`).
    ['cat-file', '--textconv', 'HEAD:a'], ['cat-file', '--filters', 'HEAD:a'], ['cat-file', '--t', 'HEAD:a'], ['cat-file', '--textc', 'HEAD:a'],
    ['cat-file', '--fi', 'HEAD:a'], ['cat-file', '--f', 'HEAD:a'], ['cat-file', '--filter', 'HEAD:a'], ['cat-file', '--batch', '--filters'],
    ['cat-file', '--batch-check', '--buffer', '--textconv'],
  ];
  const free = [
    ['rev-parse', 'HEAD'], ['for-each-ref'], ['branch', '-m', 'a', 'b'], ['update-ref', '--stdin'], ['config', '--get', 'x.y'], ['cat-file', '--batch-check'],
    ['cat-file', '-p', 'HEAD:a'], ['cat-file', '-t', 'abc'], ['cat-file', '-e', 'abc'], ['cat-file', '--batch-check=%(objectname) %(objecttype)', '--buffer'],
    ['cat-file', '--batch', '-Z'], ['cat-file', '--batch-all-objects', '--batch-check', '--unordered', '--filter=blob:none'],
    ['fetch', 'origin'], ['ls-remote', 'origin'], ['commit-tree', 'abc'],
    ['log', '--stdin', '--topo-order', ...LOG_SAFE, '--format=%H', '--skip=0', '--max-count=11'],
    ['log', '--stdin', '--topo-order', ...LOG_SAFE, '--format=%H', '--max-count=11', '-i', '-F', '--grep=x', '--author=y'],
    ['log', '--stdin', '--topo-order', ...LOG_SAFE, '--format=%H', '--max-count=11', '--', 'a.txt'],
    ['log', '--follow', '-M', '--name-status', '-z', ...LOG_SAFE, '--format=%H', '--max-count=5', '--end-of-options', 'HEAD', '--', 'a.txt'],
    ['log', '-g', '-z', '--date=unix', ...LOG_SAFE, '--format=%H', '--skip=0', '--max-count=5', '--end-of-options', 'main', '--'],
    ['log', '-1', '--no-walk', ...LOG_SAFE, '--format=%H', 'abc'],
    ['log', '--no-walk=unsorted', '-z', '--no-show-signature', '--format=%H', '--stdin'],
    ['log', '-z', '--reverse', '--no-show-signature', '--format=%B', '--end-of-options', 'a..b'],
    ['log', '-1', '--no-show-signature', '--date=raw', '--format=%an', '--end-of-options', '-p'],
    ['stash', 'list', ...LOG_SAFE, '--format=%H'], ['stash', 'store', '--message=m', 'abc'], ['stash', 'drop', 'stash@{0}'],
    ['worktree', 'list', '--porcelain', '-z'],
    ['ls-files', '-z'], ['ls-files', '-u', '-z'], ['ls-files', '--others', '--exclude-standard', '-z', '--', '--eol'], ['ls-files', '-s', '-z', '--', 'p'],
  ];
  for (const args of consults) assert.equal(consultsAttributes(args), true, JSON.stringify(args));
  for (const args of free) assert.equal(consultsAttributes(args), false, JSON.stringify(args));
});

// Invariant: runGit finds the subcommand past leading `-c k=v` pairs and `--no-literal-pathspecs` before deciding.
test('runGit decides on the subcommand past leading -c pairs and --no-literal-pathspecs', async (t) => {
  const w = await world(t);
  const run = (args) => runGit(ctxFor(w.target, 'read'), args, { okExit: [0, 1, 128] });
  await run(['-c', 'core.abbrev=12', 'status']);
  await run(['-c', 'core.abbrev=12', 'rev-parse', 'HEAD']);
  await run(['--no-literal-pathspecs', 'status']);
  await run(['--no-literal-pathspecs', 'ls-files', '-z']);
  assert.deepEqual(w.argvs().map((a) => (isProbe(a) ? 'probe' : a.find((x) => ['status', 'rev-parse', 'ls-files'].includes(x)))),
    ['probe', 'status', 'rev-parse', 'probe', 'status', 'ls-files']);
});

// Invariant: an args-level `-C` / `--git-dir` (which the probe, keyed by ctx.target, would not follow) before a
// consulting subcommand is a code-git bug: runGit throws before anything runs. Before an allow-listed subcommand the
// command runs, unprobed.
test('an args-level -C or --git-dir before a consulting subcommand throws before any exec; before an allow-listed one it runs unprobed', async (t) => {
  const w = await subWorld(t, { nested: false });
  const ctx = ctxFor(w.target(), 'read');
  const throwing = [
    ['-C', 'libA', '--git-dir=.git', 'status'], ['-C', 'libA', 'diff', '--quiet'], ['--git-dir=.git', 'status'], ['--git-dir', '.git', 'add', '-A'],
    ['-c', 'a.b=1', '-C', 'libA', '--git-dir=.git', 'status'], ['-C', 'libA', '--git-dir=.git', 'log', '--shortstat'],
  ];
  for (const args of throwing) {
    await assert.rejects(runGit(ctx, args), (e) => e.code === undefined && /target\.sub/.test(e.message), JSON.stringify(args));
  }
  assert.deepEqual(w.execArgv(), [], 'nothing ran');
  await runGit(ctx, ['-C', 'libA', '--git-dir=.git', 'rev-parse', 'HEAD']);
  await runGit(ctx, ['-C', 'libA', '--git-dir', '.git', 'symbolic-ref', '-q', 'HEAD'], { okExit: [0, 1] });
  assert.deepEqual(w.execArgv().map(afterBase), [
    ['-C', 'libA', '--git-dir=.git', 'rev-parse', 'HEAD'], ['-C', 'libA', '--git-dir', '.git', 'symbolic-ref', '-q', 'HEAD'],
  ]);
});

// Invariant: a leading `-c core.attributesFile=…` (git config keys are case-insensitive), which the probe — run without
// the command's `-c` pairs — would not open, before a consulting subcommand is a code-git bug: runGit throws before
// anything runs. Before an allow-listed subcommand the command runs, unprobed.
test('a leading -c core.attributesFile (any case) before a consulting subcommand throws before any exec; before an allow-listed one it runs unprobed', async (t) => {
  const w = await world(t);
  const ctx = ctxFor(w.target, 'read');
  const throwing = [
    ['-c', 'core.attributesFile=/x', 'status'], ['-c', 'core.attributesfile=/x', 'status'], ['-c', 'CORE.ATTRIBUTESFILE=/x', 'add', '-A'],
    ['-c', 'Core.AttributesFile=/x', 'diff', '--quiet'], ['-c', 'a.b=1', '-c', 'core.attributesFile=/x', 'log', '--shortstat'],
    ['-c', 'core.attributesFile', 'status'],
  ];
  for (const args of throwing) {
    await assert.rejects(runGit(ctx, args), (e) => e.code === undefined && /core\.attributesFile/.test(e.message), JSON.stringify(args));
  }
  assert.deepEqual(w.argvs(), [], 'nothing ran');
  await runGit(ctx, ['-c', 'Core.AttributesFile=/x', 'rev-parse', 'HEAD']);
  await runGit(ctx, ['-c', 'core.attributesfile=/x', 'ls-files', '-z']);
  // Another key is no redirection: probed as usual.
  await runGit(ctx, ['-c', 'core.attributes=/x', 'status']);
  assert.deepEqual(w.argvs(), [
    ['-c', 'Core.AttributesFile=/x', 'rev-parse', 'HEAD'], ['-c', 'core.attributesfile=/x', 'ls-files', '-z'], PROBE, ['-c', 'core.attributes=/x', 'status'],
  ]);
});

// Invariant: the route builds each op run's ctx with the attributeChecks memo: a real /api/ops run with several
// consulting commands probes exactly once.
test('through /api/ops: stage.discardFiles (several consulting commands) runs exactly one probe', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.write('p.txt', 'changed\n');
  const r = await w.op('stage.discardFiles', { tracked: ['p.txt'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const argvs = w.execArgv().map(afterBase);
  assert.equal(argvs.filter(isProbe).length, 1, 'one probe');
  assert.ok(argvs.filter((a) => !isProbe(a) && consultsAttributes(a)).length >= 2, `several consulting commands: ${JSON.stringify(argvs)}`);
});

// Invariant: a probe that exits non-zero is not a refusal: the op's own command answers (here: not a repository).
test("a probe that fails (not a repository) is swallowed: the op's own command runs and answers", async (t) => {
  const dir = tempDir(t);
  const cc = await fakeCc({ projects: { plain: { dir } } });
  t.after(() => cc.close());
  const r = await runGit(ctxFor({ project: 'plain' }, 'read'), ['status'], { okExit: [0, 128] });
  assert.equal(r.exitCode, 128);
  assert.deepEqual(cc.state.execCalls.map((b) => afterBase(b.argv)), [PROBE, ['status']]);
});

// Invariant: under a short bound, a clean repo's probe is not mistaken for a timeout: the named ops succeed.
test('no false refusal: with no special file and a short probe bound, the probed ops succeed', async (t) => {
  shortProbe(t, 2000);
  const w = await world(t);
  await w.op('repo.summary', {});
  await w.op('diff.files', { source: { kind: 'unstaged' } });
  await w.op('diff.file', { source: { kind: 'unstaged' }, path: 'a.txt' });
  await w.op('stage.files', { all: true });
  assert.ok(w.argvs().filter(isProbe).length >= 4);
});

// Invariant (residual, pinned): a nested .gitattributes is not probed. A FIFO there still blocks a consulting command
// until the kind's timeout, refused GIT_TIMEOUT — a claim of coverage without a nested sweep fails here.
test('residual: a FIFO nested .gitattributes under a stat-dirty directory is not probed: repo.summary waits out the read timeout, GIT_TIMEOUT', FIFO_TEST, async (t) => {
  const prev = LIMITS.read.timeoutMs;
  LIMITS.read.timeoutMs = 800;
  t.after(() => { LIMITS.read.timeoutMs = prev; });
  const w = await world(t);
  mkfifo(path.join(w.repo.dir, 'sub', '.gitattributes'));
  w.statDirty('sub/b.txt');
  const { e } = await rejection(w.op('repo.summary', {}));
  assert.equal(e.code, 'GIT_TIMEOUT', e.message);
  assert.equal(w.argvs().filter(isProbe).length, 1, 'the root probe ran and passed');
  await noneLeft(w.cc);
});

// Invariant (residual, pinned): the attribute files of a child repository git works in on the op's behalf are not
// probed: the parent's probe passes, and the parent `status` that submodule.update runs (git runs `status` inside the
// stat-dirty child) blocks on the child's FIFO .gitattributes until the write timeout, refused GIT_TIMEOUT — a claim of
// per-child coverage fails here.
test("residual: a FIFO at a submodule child's .gitattributes is not probed by a parent-target submodule.update: it waits out the write timeout, GIT_TIMEOUT", FIFO_TEST, async (t) => {
  const prev = LIMITS.write.timeoutMs;
  LIMITS.write.timeoutMs = 800;
  t.after(() => { LIMITS.write.timeoutMs = prev; });
  const w = await subWorld(t, { nested: false });
  mkfifo(path.join(w.repo.dir, 'libA', '.gitattributes'));
  const later = Date.now() / 1000 + 10;
  fs.utimesSync(path.join(w.repo.dir, 'libA', 'a.txt'), later, later);
  const r = await w.op('submodule.update', { paths: ['libA'] });
  assert.equal(r.body.code, 'GIT_TIMEOUT', r.body.error);
  const argvs = w.execArgv().map(afterBase);
  assert.deepEqual(argvs.filter(isProbe), [PROBE], 'one probe, in the parent: it passed');
  assert.equal(argvs.at(-1)[0], 'status', `the parent status blocked in the child: ${JSON.stringify(argvs.at(-1))}`);
  await noneLeft(w.cc);
});

// Invariant: the probe runs through the runner's own argv (BASE_ARGS: the pinned work tree, the overrides).
test('BASE_ARGS precede every probe', async (t) => {
  const w = await world(t);
  await w.op('repo.summary', {});
  const probe = w.cc.state.execCalls.find((b) => b.argv.includes('check-attr'));
  assert.deepEqual(probe.argv, ['git', ...BASE_ARGS, ...PROBE]);
});
