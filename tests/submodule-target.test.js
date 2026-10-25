import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createActivityLog } from '../src/activity/log.js';
import { createLocks } from '../src/git/locks.js';
import { buildRegistry, OPS } from '../src/git/ops/index.js';
import { PROBE_ARGS } from '../src/git/attributes.js';
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

test('the preflight: checkout and submodule top levels, then per chain level its git dir and its parent\'s .gitmodules names, under the op run, before the op', async (t) => {
  const w = await subWorld(t, { ops: TEST_OPS });
  await w.ok('test.write', undefined, ['libA', 'libB']);
  const C = (p) => ['-C', p, '--git-dir=.git'];
  const GM = ['config', '-f', '.gitmodules', '-z', '--get-regexp', '^submodule\\..*\\.(path|url|branch)$'];
  assert.deepEqual(w.execArgv().map(afterBase), [
    ['rev-parse', '--show-toplevel'], [...C('libA/libB'), 'rev-parse', '--show-toplevel'], ['rev-parse', '--absolute-git-dir'],
    [...C('libA'), 'rev-parse', '--absolute-git-dir'], GM,
    [...C('libA/libB'), 'rev-parse', '--absolute-git-dir'], [...C('libA'), ...GM],
    [...C('libA/libB'), ...PROBE_ARGS], [...C('libA/libB'), 'add', '-A'],
  ]);
  const entries = await w.activity();
  assert.equal(new Set(entries.map((e) => e.opRunId)).size, 1);
  assert.deepEqual(entries.map((e) => e.kind), [...Array(8).fill('read'), 'write']);
  for (const i of [0, 2, 4]) assert.equal('sub' in entries[i].target, false, 'the checkout reads run at the root');
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
  assert.deepEqual(afterBase(w.execArgv().at(-3)), ['-C', 'libA/libB', '--git-dir=.git', 'rev-parse', '--absolute-git-dir']);
});

test('activity entries carry sub (a copy), root entries none', async (t) => {
  const w = await subWorld(t, { ops: TEST_OPS });
  await w.ok('test.read', undefined, ['libA', 'libB']);
  const entries = await w.activity();
  const [rootRead, subTop, , levelA] = entries;
  const op = entries.at(-1);
  assert.deepEqual(rootRead.target, { project: PROJECT, worktree: null });
  assert.deepEqual(subTop.target, { project: PROJECT, worktree: null, sub: ['libA', 'libB'] });
  assert.deepEqual(levelA.target, { project: PROJECT, worktree: null, sub: ['libA'] });
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
  const tagged = (target, kind, tag) => runGit(ctxFor(target, kind, { activity, locks }), ['rev-parse', 'HEAD'], { env: { CG_TAG: tag } });
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
  // Per op run: the checkout's top level, its git dir, and its .gitmodules (libA's name).
  assert.equal(rootReads.length, 3 * new Set(entries.map((e) => e.opRunId)).size);
  assert.ok(rootReads.every((a) => /^rev-parse --(show-toplevel|absolute-git-dir)$|^config -f \.gitmodules /.test(afterBase(a).join(' '))));
});

/** A declared, cloned-looking submodule `evil` whose `.git` gitfile names `gitdir`. */
function craftedGitfile(w, gitdir, name = 'evil') {
  w.repo.git('config', '-f', '.gitmodules', `submodule.${name}.path`, name);
  w.repo.git('config', '-f', '.gitmodules', `submodule.${name}.url`, w.urls.libA);
  fs.mkdirSync(w.file(name), { recursive: true });
  fs.writeFileSync(w.file(`${name}/.git`), `gitdir: ${gitdir}\n`);
}

test('a crafted gitfile (another submodule\'s git dir, the parent\'s .git, a repo outside the project) is refused SUBMODULE_UNSAFE gitdir before the op; the list shows it blocked', async (t) => {
  for (const [what, gitdir] of [['sibling', (w) => w.file('.git/modules/libA')], ['parent', (w) => w.file('.git')], ['outside', (w) => path.join(w.root, 'libA-work', '.git')]]) {
    const w = await subWorld(t, { nested: false, ops: TEST_OPS });
    craftedGitfile(w, gitdir(w));
    const victimIndex = () => fs.readFileSync(path.join(gitdir(w), 'index'));
    const before = victimIndex();
    RAN.length = 0;
    const r = await w.op('test.write', undefined, ['evil']);
    assert.equal(r.status, 409, what);
    assert.deepEqual([r.body.code, r.body.reason, r.body.path], ['SUBMODULE_UNSAFE', 'gitdir', 'evil'], what);
    assert.deepEqual(RAN, [], what);
    assert.equal(w.execArgv().some((a) => a.includes('add')), false, what);
    assert.deepEqual(victimIndex(), before, what);
    const e = (await w.ok('submodule.list')).submodules.find((x) => x.path === 'evil');
    assert.deepEqual([e.blocked, e.populated], ['escapes', false], what);
    assert.equal((await w.op('submodule.update', { paths: ['evil'] })).body.reason, 'escapes', what);
  }
});

test('an undeclared path, or a gitfile naming modules/<another name>, is refused; an embedded .git directory is accepted', async (t) => {
  const w = await subWorld(t, { nested: false, ops: TEST_OPS });
  // Not in .gitmodules: no name to match.
  fs.mkdirSync(w.file('stray'));
  fs.writeFileSync(w.file('stray/.git'), `gitdir: ${w.file('.git/modules/libA')}\n`);
  assert.equal((await w.op('test.read', undefined, ['stray'])).body.reason, 'gitdir');
  // Declared as "other", pointing at libA's modules dir.
  craftedGitfile(w, w.file('.git/modules/libA'), 'other');
  assert.equal((await w.op('test.read', undefined, ['other'])).body.reason, 'gitdir');
  // A repository cloned in place (its own .git directory) is its own: accepted, and listed populated.
  w.fx('.', 'clone', '-q', w.urls.libA, 'emb');
  assert.equal(await w.ok('test.read', undefined, ['emb']), w.repo.git('-C', 'emb', 'rev-parse', 'HEAD'));
});

test('nested chains: each level must be <its parent\'s git dir>/modules/<name>; a nested gitfile naming its parent\'s git dir or a top-level modules dir is refused', async (t) => {
  const w = await subWorld(t, { ops: TEST_OPS });
  // The real layout passes: libB's git dir is libA's git dir + /modules/libB.
  assert.equal(await w.ok('test.read', undefined, ['libA', 'libB']), w.repo.git('-C', 'libA/libB', 'rev-parse', 'HEAD'));
  const realLibB = fs.readFileSync(w.file('libA/libB/.git'), 'utf8');
  for (const gitdir of [w.file('.git/modules/libA'), w.file('.git')]) {
    fs.writeFileSync(w.file('libA/libB/.git'), `gitdir: ${gitdir}\n`);
    const r = await w.op('test.read', undefined, ['libA', 'libB']);
    assert.deepEqual([r.body.code, r.body.reason, r.body.path], ['SUBMODULE_UNSAFE', 'gitdir', 'libA/libB'], gitdir);
  }
  // A top-level modules dir that exists for a submodule named libB: under the checkout's modules, not under libA's.
  w.fx('.', 'clone', '-q', '--bare', w.urls.libB, w.file('.git/modules/libB'));
  fs.writeFileSync(w.file('libA/libB/.git'), `gitdir: ${w.file('.git/modules/libB')}\n`);
  assert.equal((await w.op('test.read', undefined, ['libA', 'libB'])).body.reason, 'gitdir');
  fs.writeFileSync(w.file('libA/libB/.git'), realLibB);
  assert.equal((await w.op('test.read', undefined, ['libA', 'libB'])).status, 200);
});

test("a cc worktree's submodule (git dir under the worktree's own git dir, not the common dir) passes the preflight", async (t) => {
  const w = await subWorld(t, { nested: false, ops: TEST_OPS });
  const wt = w.repo.worktreeAdd(path.join(w.root, 'wt'), 'wtb');
  w.fx(wt.dir, 'submodule', 'update', '-q', '--init');
  assert.match(fs.readFileSync(path.join(wt.dir, 'libA/.git'), 'utf8'), /worktrees\/wt\/modules\/libA/);
  w.cc.state.projects[PROJECT].worktrees = { wt: wt.dir };
  const r = await w.app.call('POST', '/api/ops/test.read', { target: { project: PROJECT, worktree: 'wt', sub: ['libA'] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result, wt.git('-C', 'libA', 'rev-parse', 'HEAD'));
  const list = await w.app.call('POST', '/api/ops/submodule.list', { target: { project: PROJECT, worktree: 'wt' } });
  assert.deepEqual([list.body.result.submodules[0].blocked, list.body.result.submodules[0].populated], [null, true]);
});

test("a second [submodule \"libA\"] at path evil whose gitfile borrows libA's git dir is refused duplicate before any op; libA's repo is untouched; both rows listed blocked", async (t) => {
  const w = await subWorld(t, { nested: false, ops: TEST_OPS });
  fs.appendFileSync(w.file('.gitmodules'), '[submodule "libA"]\n\tpath = evil\n');
  fs.mkdirSync(w.file('evil'));
  fs.writeFileSync(w.file('evil/.git'), 'gitdir: ../.git/modules/libA\n');
  const libAgit = w.file('.git/modules/libA');
  const snap = () => [fs.readFileSync(path.join(libAgit, 'config')), fs.readFileSync(path.join(libAgit, 'index')), fs.existsSync(path.join(libAgit, 'modules'))];
  const before = snap();
  RAN.length = 0;
  for (const [name, params] of [['test.write', undefined], ['submodule.add', { url: w.urls.libA, path: 'x' }], ['submodule.list', undefined]]) {
    const r = await w.op(name, params, ['evil']);
    assert.deepEqual([r.status, r.body.code, r.body.reason, r.body.path], [409, 'SUBMODULE_UNSAFE', 'duplicate', 'evil'], name);
  }
  assert.deepEqual(RAN, []);
  assert.deepEqual(snap(), before);
  const rows = (await w.ok('submodule.list')).submodules.map((e) => [e.name, e.path, e.blocked]);
  assert.deepEqual(rows, [['libA', 'evil', 'duplicate'], ['libA', 'libA', 'duplicate']]);
  assert.equal((await w.op('submodule.update', { paths: ['libA'] })).body.reason, 'duplicate');
});
