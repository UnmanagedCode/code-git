import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createActivityLog } from '../src/activity/log.js';
import { createLocks } from '../src/git/locks.js';
import { buildRegistry, OPS } from '../src/git/ops/index.js';
import { BASE_ARGS, runGit } from '../src/git/runner.js';
import { assertTarget } from '../src/git/validate.js';
import { ctxFor } from './_ctx.js';
import { afterBase, PROJECT, subWorld } from './_submodules.js';

// A target naming a submodule chain: validated with the target, turned into `-C <path> --git-dir=.git` by the runner
// alone (cc only ever sees {project, worktree}), and checked to be a cloned submodule inside the checkout before the op.

const refusedTarget = (t) => assert.throws(() => assertTarget(t), (e) => e.code === 'BAD_TARGET', JSON.stringify(t));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Test ops beside the real ones: a read and a write that record that they ran. */
const RAN = [];
const TEST_OPS = buildRegistry([[...OPS.values()], [
  { name: 'test.read', kind: 'read', params: () => ({}), async run(git) { RAN.push('read'); return (await git(['rev-parse', 'HEAD'])).stdout.toString().trim(); } },
  { name: 'test.write', kind: 'write', params: () => ({}), async run(git) { RAN.push('write'); await git(['add', '-A']); return true; } },
]]);

test('assertTarget accepts sub chains and refuses non-arrays, empty, depth > 8, leading -, .., absolute, .git aliases (.GIT, .git., git~1, HFS-ignorable)', () => {
  assert.deepEqual(assertTarget({ project: 'p', sub: ['libs/a'] }), { project: 'p', worktree: null, sub: ['libs/a'] });
  assert.deepEqual(assertTarget({ project: 'p', worktree: 'w', sub: ['a', 'b c', 'x/-y'] }), { project: 'p', worktree: 'w', sub: ['a', 'b c', 'x/-y'] });
  assert.deepEqual(assertTarget({ project: 'p', sub: Array(8).fill('a') }).sub.length, 8);
  assert.equal('sub' in assertTarget({ project: 'p' }), false, 'a root target has no sub key');
  for (const sub of [null, 'a', {}, [], Array(9).fill('a'), [''], ['-a'], ['a/../b'], ['..'], ['/abs'], ['a/'], ['a//b'], ['./a'], ['a\\b'], ['a\0b'], [7],
    ['.git'], ['.GIT'], ['a/.git'], ['.git.'], ['.git '], ['git~1'], ['GIT~12'], ['.g‌it'], ['.gi﻿t']]) {
    refusedTarget({ project: 'p', sub });
  }
  // Names close to the aliases are paths like any other.
  for (const ok of ['.github', 'git', 'git~x', '.gitmodules', 'x.git']) assert.deepEqual(assertTarget({ project: 'p', sub: [ok] }).sub, [ok]);
});

test('exec body never carries sub (form A only, no violations)', async (t) => {
  const w = await subWorld(t);
  assert.equal((await w.op('repo.summary', undefined, ['libA', 'libB'])).status, 200);
  assert.ok(w.execCalls().length >= 3);
  for (const b of w.execCalls()) {
    assert.deepEqual(Object.keys(b).filter((k) => !['argv', 'env', 'encoding', 'timeoutMs', 'maxOutputBytes', 'stdinB64'].includes(k)), ['project']);
    assert.equal(b.project, PROJECT);
  }
  assert.deepEqual(w.cc.state.violations, []);
});

test('argv is BASE_ARGS, -C <joined>, --git-dir=.git, op args', async (t) => {
  const w = await subWorld(t, { ops: TEST_OPS });
  assert.equal(await w.ok('test.read', undefined, ['libA']), w.repo.git('-C', 'libA', 'rev-parse', 'HEAD'));
  const argv = w.execArgv().at(-1);
  assert.deepEqual(argv, ['git', ...BASE_ARGS, '-C', 'libA', '--git-dir=.git', 'rev-parse', 'HEAD']);
  // A root target has no prefix.
  await w.ok('test.read');
  assert.deepEqual(w.execArgv().at(-1), ['git', ...BASE_ARGS, 'rev-parse', 'HEAD']);
});

test('the preflight: the checkout top level, then the submodule top level, under the op run, before the op', async (t) => {
  const w = await subWorld(t, { ops: TEST_OPS });
  await w.ok('test.write', undefined, ['libA']);
  assert.deepEqual(w.execArgv().map(afterBase), [
    ['rev-parse', '--show-toplevel'], ['-C', 'libA', '--git-dir=.git', 'rev-parse', '--show-toplevel'], ['-C', 'libA', '--git-dir=.git', 'add', '-A'],
  ]);
  const entries = await w.activity();
  assert.equal(new Set(entries.map((e) => e.opRunId)).size, 1);
  assert.deepEqual(entries.map((e) => e.kind), ['read', 'read', 'write']);
  assert.equal('sub' in entries[0].target, false, 'the checkout read runs at the root');
});

test('a symlinked submodule path is refused SUBMODULE_UNSAFE escapes before the op runs', async (t) => {
  const w = await subWorld(t, { nested: false, ops: TEST_OPS });
  // A clone of libA outside the checkout, reached through a symlink inside it.
  const outside = path.join(w.root, 'outside');
  w.fx(w.root, 'clone', '-q', w.urls.libA, outside);
  fs.symlinkSync(outside, w.file('link'));
  RAN.length = 0;
  const r1 = await w.op('test.write', undefined, ['link']);
  assert.equal(r1.status, 409);
  assert.equal(r1.body.code, 'SUBMODULE_UNSAFE');
  assert.equal(r1.body.reason, 'escapes');
  assert.deepEqual(RAN, []);
  assert.equal(w.execArgv().some((a) => a.includes('add')), false);
  // A symlinked directory above a real repository: the fixture's own clone of libA, reached as alias/libA-work.
  fs.symlinkSync(w.root, w.file('alias'));
  const r2 = await w.op('test.read', undefined, ['alias/libA-work']);
  assert.equal(r2.body.code, 'SUBMODULE_UNSAFE');
  assert.equal(r2.body.reason, 'escapes');
  assert.deepEqual(RAN, []);
});

test('an unpopulated sub refuses SUBMODULE_NOT_POPULATED and never writes the parent index', async (t) => {
  const w = await subWorld(t, { nested: false, populated: false, ops: TEST_OPS });
  w.repo.write('libA/x.txt', 'x\n');
  const index = () => fs.readFileSync(w.file('.git/index'));
  const before = index();
  RAN.length = 0;
  for (const sub of [['libA'], ['no-such-dir']]) {
    const r = await w.op('test.write', undefined, sub);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SUBMODULE_NOT_POPULATED');
    assert.equal(r.body.path, sub[0]);
  }
  assert.deepEqual(RAN, []);
  assert.deepEqual(index(), before);
});

test('nested chain [libA, libB] runs -C libA/libB', async (t) => {
  const w = await subWorld(t, { ops: TEST_OPS });
  assert.equal(await w.ok('test.read', undefined, ['libA', 'libB']), w.repo.git('-C', 'libA/libB', 'rev-parse', 'HEAD'));
  assert.deepEqual(afterBase(w.execArgv().at(-1)), ['-C', 'libA/libB', '--git-dir=.git', 'rev-parse', 'HEAD']);
  assert.equal(w.execArgv().at(-2).at(-1), '--show-toplevel');
});

test('activity entries carry sub (a copy), root entries none', async (t) => {
  const w = await subWorld(t, { ops: TEST_OPS });
  await w.ok('test.read', undefined, ['libA', 'libB']);
  const [rootRead, subTop, op] = await w.activity();
  assert.deepEqual(rootRead.target, { project: PROJECT, worktree: null });
  assert.deepEqual(subTop.target, { project: PROJECT, worktree: null, sub: ['libA', 'libB'] });
  assert.deepEqual(op.target, { project: PROJECT, worktree: null, sub: ['libA', 'libB'] });
  const log = createActivityLog();
  const sub = ['a'];
  log.open({ opRunId: 'r', op: 'o', kind: 'read', target: { project: 'p', sub }, argv: ['git'] });
  sub.push('b');
  assert.deepEqual(log.list()[0].target.sub, ['a']);
});

test('a write in a sub tab holds the project lock', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.cc.state.execHook = () => 'hold';
  const activity = createActivityLog();
  const locks = createLocks();
  const tagged = (target, kind, tag) => runGit(ctxFor(target, kind, { activity, locks }), ['status'], { env: { CG_TAG: tag } });
  const a = tagged({ project: PROJECT, sub: ['libA'] }, 'write', 'sub');
  const heldA = await w.cc.nextHeld();
  const b = tagged({ project: PROJECT }, 'write', 'root');
  const c = tagged({ project: PROJECT, sub: ['libA'] }, 'read', 'read');
  const heldC = await w.cc.nextHeld();
  assert.equal(heldC.body.env.CG_TAG, 'read');
  await tick(50);
  assert.equal(w.execCalls().length, 2, 'the root write waits for the submodule write');
  w.cc.state.execHook = null;
  heldC.release();
  heldA.release();
  await Promise.all([a, b, c]);
  assert.deepEqual(w.execCalls().map((x) => x.env.CG_TAG), ['sub', 'read', 'root']);
});

test('system: docker project: every exec is form A with -C in argv', async (t) => {
  const w = await subWorld(t, { systemRemote: true, ops: TEST_OPS });
  await w.ok('repo.summary', undefined, ['libA']);
  await w.ok('test.write', undefined, ['libA', 'libB']);
  assert.deepEqual(w.cc.state.violations, []);
  for (const b of w.execCalls()) {
    assert.equal(b.project, PROJECT);
    for (const k of ['system', 'remoteId', 'cwd', 'shell', 'worktree']) assert.equal(k in b, false, k);
  }
  const subCalls = w.execArgv().filter((a) => a.includes('-C'));
  assert.ok(subCalls.length >= 4);
  assert.ok(subCalls.every((a) => ['libA', 'libA/libB'].includes(a[a.indexOf('-C') + 1]) && a[a.indexOf('-C') + 2] === '--git-dir=.git'));
});

test('system: docker project: every submodule op, nested included, is form A with -C in argv', async (t) => {
  const w = await subWorld(t, { systemRemote: true });
  const inA = ['libA'];
  await w.ok('submodule.list', undefined, inA);
  await w.ok('submodule.init', { paths: ['libB'] }, inA);
  await w.ok('submodule.update', { paths: ['libB'] }, inA);
  await w.ok('submodule.sync', { paths: ['libB'] }, inA);
  await w.ok('submodule.setUrl', { path: 'libB', url: w.urls.libB }, inA);
  w.fx('libA/libB', 'commit', '-q', '--allow-empty', '-m', 'moved');
  await w.ok('submodule.commitPointer', { path: 'libB', expect: w.repo.git('-C', 'libA/libB', 'rev-parse', 'HEAD'), summary: 's' }, inA);
  await w.ok('submodule.add', { url: w.urls.libB, path: 'libC' }, inA);
  await w.ok('submodule.remove', { path: 'libC', discard: true }, inA);
  await w.ok('repo.summary', undefined, ['libA', 'libB']);
  assert.deepEqual(w.cc.state.violations, []);
  const entries = await w.activity();
  assert.ok(new Set(entries.map((e) => e.op)).size >= 9);
  for (const b of w.execCalls()) {
    assert.equal(b.project, PROJECT);
    for (const k of ['system', 'remoteId', 'cwd', 'shell', 'worktree']) assert.equal(k in b, false, k);
  }
  // Every command but each op run's checkout read runs under the submodule prefix.
  const rootReads = w.execArgv().filter((a) => !a.includes('-C'));
  assert.equal(rootReads.length, new Set(entries.map((e) => e.opRunId)).size);
  assert.ok(rootReads.every((a) => afterBase(a).join(' ') === 'rev-parse --show-toplevel'));
});
