import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SUBMODULE_LIMITS } from '../src/git/submodule/limits.js';
import { parseSubmoduleConfig } from '../src/git/submodule/list.js';
import { opWorld } from './_ops.js';
import { afterBase, subWorld } from './_submodules.js';

// submodule.list: what .gitmodules declares, joined with the repo's config, index, HEAD, status and a probe per entry.

const byPath = (list) => Object.fromEntries(list.submodules.map((e) => [e.path, e]));
const FLAGS = ['initialized', 'populated', 'outOfSync', 'modified', 'untracked', 'added', 'conflicted'];
const flags = (e) => Object.fromEntries(FLAGS.map((k) => [k, e[k]]));
const clean = { initialized: true, populated: true, outOfSync: false, modified: false, untracked: false, added: false, conflicted: false };

test('status flags: uninitialised (no local url), not populated, out of sync (head ≠ recorded), modified, untracked, added (not in HEAD), conflicted', async (t) => {
  const w = await subWorld(t, { nested: false });
  const headA = w.repo.git('-C', 'libA', 'rev-parse', 'HEAD');
  let a = byPath(await w.ok('submodule.list')).libA;
  assert.deepEqual(a, {
    name: 'libA', path: 'libA', url: w.urls.libA, resolvedUrl: w.urls.libA, branch: null, ...clean,
    recorded: headA, committed: headA, head: headA, typeChanged: false, blocked: null, urlProblem: null,
  });
  w.repo.write('libA/a.txt', 'changed\n');
  assert.deepEqual(flags(byPath(await w.ok('submodule.list')).libA), { ...clean, modified: true });
  w.repo.write('libA/new.txt', 'n\n');
  assert.deepEqual(flags(byPath(await w.ok('submodule.list')).libA), { ...clean, modified: true, untracked: true });
  w.fx('libA', 'commit', '-qam', 'moved');
  fs.rmSync(w.file('libA/new.txt'));
  a = byPath(await w.ok('submodule.list')).libA;
  assert.deepEqual(flags(a), { ...clean, outOfSync: true });
  assert.notEqual(a.head, a.recorded);
  assert.equal(a.recorded, headA);
  // Added: staged in the parent, not in HEAD.
  w.fx('.', 'submodule', 'add', '-q', w.urls.libA, 'libs/c');
  const c = byPath(await w.ok('submodule.list'))['libs/c'];
  assert.deepEqual(flags(c), { ...clean, added: true });
  assert.equal(c.committed, null);
  // Uninitialised and not populated.
  w.fx('.', 'submodule', 'deinit', '-q', '-f', 'libs/c');
  assert.deepEqual(flags(byPath(await w.ok('submodule.list'))['libs/c']), { ...clean, initialized: false, populated: false, added: true });
  // Initialised, not cloned.
  w.fx('.', 'submodule', 'init', '-q', '--', 'libs/c');
  const ci = byPath(await w.ok('submodule.list'))['libs/c'];
  assert.deepEqual(flags(ci), { ...clean, populated: false, added: true });
  assert.equal(ci.resolvedUrl, w.urls.libA);
  assert.equal(ci.head, null);
  // Conflicted: the gitlink at stages 1-3, none at 0.
  w.repo.git('update-index', '--force-remove', 'libA');
  const stages = [1, 2, 3].map((n) => `160000 ${headA} ${n}\tlibA\n`).join('');
  execFileSync('git', ['-C', w.repo.dir, 'update-index', '--index-info'], { input: stages, env: w.env });
  const x = byPath(await w.ok('submodule.list')).libA;
  assert.equal(x.conflicted, true);
  assert.equal(x.recorded, null);
});

test('blocked: ..-name, .git-alias path, symlink escape (probe); no blocked path reaches argv', async (t) => {
  const w = await subWorld(t, { nested: false });
  const gm = (...a) => w.repo.git('config', '-f', '.gitmodules', ...a);
  gm('submodule.../evil.path', 'evil');
  gm('submodule.alias.path', 'x/.GIT');
  gm('submodule.dash.path', '-oops');
  gm('submodule.dup.path', 'libA');
  // A bad name and a bad path: reported as the path, which never reaches argv.
  gm('submodule.../both.path', '-both');
  gm('submodule.../abs.path', '/abs/x');
  fs.symlinkSync(path.join(w.root, 'libA-work'), w.file('sym'));
  gm('submodule.sym.path', 'sym');
  gm('submodule.sym.url', w.urls.libA);
  const list = await w.ok('submodule.list');
  const by = Object.fromEntries(list.submodules.map((e) => [e.name, e]));
  assert.equal(by['../evil'].blocked, 'name');
  assert.equal(by.alias.blocked, 'path');
  assert.equal(by.dash.blocked, 'path');
  assert.equal(by.sym.blocked, 'escapes');
  assert.equal(by.sym.populated, false);
  // Two entries declaring libA: neither can be told apart, both blocked.
  assert.equal(by.dup.blocked, 'path');
  assert.equal(by.libA.blocked, 'path');
  assert.equal(by['../both'].blocked, 'path');
  assert.equal(by['../abs'].blocked, 'path');
  const blockedPaths = list.submodules.filter((e) => e.blocked === 'path' && e.path !== 'libA').map((e) => e.path);
  assert.deepEqual(blockedPaths.sort(), ['-both', '-oops', '/abs/x', 'x/.GIT']);
  for (const a of w.execArgv()) for (const bad of blockedPaths) assert.equal(a.some((x) => x === bad || x.includes(bad)), false, `${bad} in ${a}`);
});

test('.gitmodules absent → [] with one exec beyond toplevel', async (t) => {
  const w = await opWorld(t);
  w.repo.commit({ 'a.txt': 'a\n' });
  assert.deepEqual(await w.op('submodule.list'), { submodules: [], truncated: false });
  assert.deepEqual(w.execArgv().map(afterBase), [['rev-parse', '--show-toplevel'], ['config', '-f', '.gitmodules', '-z', '--get-regexp', '^submodule\\..*\\.(path|url|branch)$']]);
});

test('names with dots and spaces parse; key split at first \\n only', async (t) => {
  assert.deepEqual(parseSubmoduleConfig('submodule.a.b c.path\nd/e\nf\0submodule.x.url\0other.k\nv\0'), [
    { name: 'a.b c', key: 'path', value: 'd/e\nf' }, { name: 'x', key: 'url', value: null },
  ]);
  const w = await subWorld(t, { nested: false });
  w.repo.git('config', '-f', '.gitmodules', 'submodule.v1.2 beta.path', 'vendor/v 1.2');
  w.repo.git('config', '-f', '.gitmodules', 'submodule.v1.2 beta.url', 'https://h/r.git');
  w.repo.git('config', '-f', '.gitmodules', 'submodule.v1.2 beta.branch', 'stable');
  const e = byPath(await w.ok('submodule.list'))['vendor/v 1.2'];
  assert.deepEqual([e.name, e.url, e.branch, e.blocked, e.populated], ['v1.2 beta', 'https://h/r.git', 'stable', null, false]);
});

test('urlProblem: the refusal for a url git would clone; none for a relative one not resolved yet', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('config', '-f', '.gitmodules', 'submodule.rel.path', 'rel');
  w.repo.git('config', '-f', '.gitmodules', 'submodule.rel.url', '../rel.git');
  w.repo.git('config', 'submodule.libA.url', 'ext::sh -c touch% x');
  const by = byPath(await w.ok('submodule.list'));
  assert.equal(by.rel.urlProblem, null);
  assert.match(by.libA.urlProblem, /^invalid remote url/);
  assert.equal(by.libA.resolvedUrl, 'ext::sh -c touch% x');
});

test('truncated past maxListed: no probe past the cap', async (t) => {
  const w = await subWorld(t, { nested: false });
  const n = SUBMODULE_LIMITS.maxListed + 1;
  fs.appendFileSync(w.file('.gitmodules'), Array.from({ length: n }, (_, i) => `[submodule "m${i}"]\n\tpath = z/m${String(i).padStart(4, '0')}\n`).join(''));
  const list = await w.ok('submodule.list');
  assert.equal(list.truncated, true);
  assert.equal(list.submodules.length, SUBMODULE_LIMITS.maxListed);
  assert.equal(list.submodules[0].path, 'libA');
  const probes = w.execArgv().filter((a) => afterBase(a)[0] === '-C');
  assert.equal(probes.length, SUBMODULE_LIMITS.maxListed);
  assert.equal(probes.some((a) => a.includes(`z/m${String(n - 1).padStart(4, '0')}`)), false);
});

test('read ops never write (index mtime unchanged); every command is a read', async (t) => {
  const w = await subWorld(t);
  w.repo.write('libA/a.txt', 'dirty\n');
  w.repo.write('libA/libB/b.txt', 'dirty\n');
  const indexes = [w.file('.git/index'), w.file('.git/modules/libA/index'), w.file('.git/modules/libA/modules/libB/index')];
  const stamp = () => indexes.map((f) => fs.statSync(f).mtimeMs);
  const before = stamp();
  await w.ok('submodule.list');
  await w.ok('submodule.list', undefined, ['libA']);
  assert.deepEqual(stamp(), before);
  assert.ok(w.execCalls().every((b) => b.env.GIT_OPTIONAL_LOCKS === '0'));
});

test('nested list in a sub tab', async (t) => {
  const w = await subWorld(t);
  const list = await w.ok('submodule.list', undefined, ['libA']);
  assert.deepEqual(list.submodules.map((e) => [e.name, e.path, e.populated, e.url]), [['libB', 'libB', true, w.urls.libB]]);
  assert.equal(list.submodules[0].head, w.repo.git('-C', 'libA/libB', 'rev-parse', 'HEAD'));
  assert.ok(w.execArgv().some((a) => afterBase(a).join(' ') === '-C libA --git-dir=.git -C libB --git-dir=.git rev-parse --show-toplevel --absolute-git-dir HEAD'));
  assert.deepEqual((await w.ok('submodule.list', undefined, ['libA', 'libB'])).submodules, []);
});

test("core.fsmonitor in a submodule's config does not run", async (t) => {
  const w = await subWorld(t);
  for (const dir of ['libA', 'libA/libB']) w.repo.git('-C', dir, 'config', 'core.fsmonitor', w.markerScript(dir.replace('/', '-')));
  w.repo.write('libA/a.txt', 'dirty\n');
  w.repo.write('libA/libB/b.txt', 'dirty\n');
  assert.equal(byPath(await w.ok('submodule.list')).libA.modified, true);
  assert.equal(byPath(await w.ok('submodule.list', undefined, ['libA'])).libB.modified, true);
  assert.deepEqual(w.markers(), []);
});

test('an unborn submodule HEAD is populated with head null', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.fx('libA', 'checkout', '-q', '--orphan', 'empty');
  const a = byPath(await w.ok('submodule.list')).libA;
  assert.equal(a.populated, true);
  assert.equal(a.head, null);
  assert.equal(a.outOfSync, false);
});
