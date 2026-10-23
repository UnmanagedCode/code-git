import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { BASE_ARGS, BASE_ENV, subArgs } from '../src/git/runner.js';
import { subWorld } from './_submodules.js';

// Documentation: the git behaviours the submodule design rests on (docs/submodules.md), run directly with code-git's
// argv prefix and env and no file-transport opt-in on the command. Each has a control showing the behaviour is not
// vacuous. A failure here is a change in git that the design has to answer, not a test to adjust.

/** git in the parent checkout as runGit runs it, for the chain `sub` (or the parent), with `pre` before the subcommand. */
function codeGit(w, sub, args, { pre = [] } = {}) {
  const r = spawnSync('git', [...BASE_ARGS, ...subArgs({ sub }), ...pre, ...args], { cwd: w.repo.dir, env: { ...w.env, ...BASE_ENV }, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const indexBytes = (w) => fs.readFileSync(path.join(w.repo.dir, '.git', 'index'));
/** Empties libA's directory and forgets its clone: as a fresh clone of the parent would have it. */
function unclone(w, name = 'libA') {
  w.fx('.', 'submodule', 'deinit', '-q', '-f', name);
  fs.rmSync(path.join(w.repo.dir, '.git', 'modules', name), { recursive: true, force: true });
}

test('probe: --work-tree=. resolves after -C (the submodule is the working tree)', async (t) => {
  const w = await subWorld(t, { nested: false });
  const r = codeGit(w, ['libA'], ['ls-files']);
  assert.equal(r.stdout, 'a.txt\n');
  assert.equal(codeGit(w, ['libA'], ['rev-parse', '--show-toplevel']).stdout, `${w.file('libA')}\n`);
});

test('probe: --git-dir=.git after -C does not walk up from an unpopulated submodule (exit 128, parent index untouched)', async (t) => {
  const w = await subWorld(t, { nested: false });
  unclone(w);
  w.repo.write('libA/x.txt', 'x\n');
  const before = indexBytes(w);
  const r = codeGit(w, ['libA'], ['add', '-A']);
  assert.equal(r.status, 128);
  assert.match(r.stderr, /not a git repository/);
  assert.deepEqual(indexBytes(w), before);
  // Control: without --git-dir, git finds the parent and adds libA/x.txt as `x.txt` to the parent's index.
  const walk = spawnSync('git', [...BASE_ARGS, '-C', 'libA', 'add', '-A'], { cwd: w.repo.dir, env: { ...w.env, ...BASE_ENV }, encoding: 'utf8' });
  assert.equal(walk.status, 0);
  assert.match(w.repo.git('ls-files', '-s'), /\tx\.txt$/m);
});

test('probe: --git-dir=.git reads a gitfile (a nested submodule too)', async (t) => {
  const w = await subWorld(t);
  assert.match(fs.readFileSync(w.file('libA/.git'), 'utf8'), /^gitdir: /);
  assert.equal(codeGit(w, ['libA'], ['rev-parse', 'HEAD']).stdout.trim(), w.repo.git('-C', 'libA', 'rev-parse', 'HEAD'));
  assert.equal(codeGit(w, ['libA', 'libB'], ['rev-parse', '--show-toplevel']).stdout, `${w.file('libA/libB')}\n`);
});

test('probe: -c config reaches submodule update children (core.fsmonitor marker absent; control present)', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('-C', 'libA', 'config', 'core.fsmonitor', w.markerScript('fsmonitor'));
  w.repo.write('libA/dirty.txt', 'x\n');
  assert.equal(codeGit(w, undefined, ['submodule', 'update', '--checkout', '--recursive']).status, 0);
  assert.equal(codeGit(w, undefined, ['status', '--porcelain=v2', '--ignore-submodules=none']).status, 0);
  assert.deepEqual(w.markers(), []);
  const ctrl = spawnSync('git', ['status', '--porcelain=v2', '--ignore-submodules=none'], { cwd: w.repo.dir, env: w.env, encoding: 'utf8' });
  assert.equal(ctrl.status, 0);
  assert.deepEqual(w.markers(), ['fsmonitor']);
});

test('probe: update --checkout overrides update=!cmd at top level and under --recursive (control: without it both run)', async (t) => {
  const w = await subWorld(t);
  const arm = () => {
    unclone(w);
    w.fx('.', 'submodule', 'init', '-q');
    w.repo.git('config', 'submodule.libA.update', `!${w.markerScript('top')}`);
  };
  arm();
  // libA is cloned and checked out: `!cmd` would run at the top level; then libB under --recursive.
  const r = codeGit(w, undefined, ['submodule', 'update', '--checkout', '--init', '--recursive']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(w.file('libA/libB/b.txt')));
  // Nested: libB's update=!cmd in libA's own config (deinit drops the section, so it is set after each init).
  const armNested = () => {
    w.fx('libA', 'submodule', 'deinit', '-q', '-f', 'libB');
    w.fx('libA', 'submodule', 'init', '-q');
    w.repo.git('-C', 'libA', 'config', 'submodule.libB.update', `!${w.markerScript('nested')}`);
  };
  armNested();
  assert.equal(codeGit(w, undefined, ['submodule', 'update', '--checkout', '--init', '--recursive']).status, 0);
  assert.ok(fs.existsSync(w.file('libA/libB/b.txt')));
  assert.deepEqual(w.markers(), []);
  // Control: the same without --checkout runs both commands.
  armNested();
  assert.equal(codeGit(w, undefined, ['submodule', 'update', '--init', '--recursive']).status, 0);
  assert.deepEqual(w.markers(), ['nested']);
  arm();
  codeGit(w, undefined, ['submodule', 'update', '--init', '--', 'libA']);
  assert.deepEqual(w.markers().sort(), ['nested', 'top']);
});

test('probe: -c protocol.ext.allow=never reaches the clone child; a parent repo-scope protocol.* does not (control: -c always runs ext)', async (t) => {
  const w = await subWorld(t, { nested: false });
  const extUrl = (m) => `ext::sh -c touch% ${w.marker(m)}`;
  const tryClone = (m, pre) => {
    unclone(w);
    w.fx('.', 'submodule', 'init', '-q');
    w.repo.git('config', 'submodule.libA.url', extUrl(m));
    return codeGit(w, undefined, ['submodule', 'update', '--checkout', '--', 'libA'], { pre });
  };
  w.repo.git('config', 'protocol.ext.allow', 'always');
  const r = tryClone('never', ['-c', 'protocol.ext.allow=never']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /transport 'ext' not allowed/);
  tryClone('local');
  assert.deepEqual(w.markers(), []);
  tryClone('always', ['-c', 'protocol.ext.allow=always']);
  assert.deepEqual(w.markers(), ['always']);
});

test('probe: submodule add/update of a file URL fails without a System opt-in (protocol.file default user)', async (t) => {
  const w = await subWorld(t, { nested: false, allowFile: false });
  unclone(w);
  const up = codeGit(w, undefined, ['submodule', 'update', '--checkout', '--init', '--', 'libA']);
  assert.notEqual(up.status, 0);
  assert.match(up.stderr, /transport 'file' not allowed/);
  const add = codeGit(w, undefined, ['submodule', 'add', '--', w.urls.libA, 'again']);
  assert.notEqual(add.status, 0);
  assert.match(add.stderr, /transport 'file' not allowed/);
  // Control: the System user's global opt-in (hermeticEnv's) lets the same update clone.
  const opted = await subWorld(t, { nested: false });
  unclone(opted);
  assert.equal(codeGit(opted, undefined, ['submodule', 'update', '--checkout', '--init', '--', 'libA']).status, 0);
});

test('probe: config --show-scope -z labels repo entries "local" and the System\'s "global"', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('config', 'protocol.allow', 'always');
  const r = codeGit(w, undefined, ['config', '--show-scope', '-z', '--get-regexp', '^protocol\\.']);
  assert.equal(r.stdout, 'global\0protocol.file.allow\nalways\0local\0protocol.allow\nalways\0');
});
