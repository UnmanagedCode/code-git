import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv, makeRepo } from './_git.js';

// Documentation: what git itself does when a stash would write through an untracked symlink to a directory outside the
// repo, run directly (no op, no guard) with code-git's env (LC_ALL=C, GIT_LITERAL_PATHSPECS=1). The ops refuse
// PATH_BLOCKED before git runs whatever these show (ops-stash-apply, ops-stash-push); a change here is a change in git
// that docs/architecture.md → Residual risks records.

function probeWorld(t) {
  const repo = makeRepo(t);
  repo.commit({ 'd/x': 'x\n', 'a.txt': 'a\n' }, 'base');
  const outside = path.join(repo.root, 'outside');
  fs.mkdirSync(outside);
  const env = { ...hermeticEnv(repo.home), GIT_LITERAL_PATHSPECS: '1' };
  const git = (...args) => {
    const r = spawnSync('git', ['-C', repo.dir, ...args], { env, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr };
  };
  const link = (name = 'd') => {
    fs.rmSync(path.join(repo.dir, name), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(repo.dir, name));
  };
  const kind = (name = 'd') => {
    const st = fs.lstatSync(path.join(repo.dir, name));
    return st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file';
  };
  const stashes = () => repo.git('stash', 'list').split('\n').filter(Boolean).length;
  return { repo, outside, git, link, kind, stashes, out: () => fs.readdirSync(outside) };
}

/** A stash adding a tracked `d/n`, then `d` untracked in HEAD and the index, and an untracked symlink at `d`. */
function stashBeyondLink(t) {
  const p = probeWorld(t);
  p.repo.write('d/n', 'n\n');
  p.repo.git('add', 'd/n');
  p.repo.git('stash', 'push', '-q');
  p.repo.git('rm', '-rq', '--cached', 'd');
  p.repo.git('commit', '-qm', 'rm d');
  p.link();
  return p;
}

test('probe: stash push -- d/x, d now an untracked symlink (d/x still in the index): git refuses, nothing outside, no stash', (t) => {
  const p = probeWorld(t);
  p.link();
  const r = p.git('stash', 'push', '-q', '--', 'd/x');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /beyond a symbolic link/);
  assert.deepEqual([p.out(), p.stashes(), p.kind()], [[], 0, 'symlink']);
});

test('probe: stash push -- d/x with d/x gone from the index too: the pathspec matches nothing (exit 1), nothing outside', (t) => {
  const p = probeWorld(t);
  p.repo.git('rm', '-rq', '--cached', 'd');
  p.link();
  const r = p.git('stash', 'push', '-q', '--', 'd/x');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /did not match/);
  assert.deepEqual([p.out(), p.stashes()], [[], 0]);
});

test('probe: stash push --staged with a staged d/x behind the link: git fails after creating the stash, nothing outside', (t) => {
  const p = probeWorld(t);
  p.repo.write('d/x', 'x2\n');
  p.repo.git('add', 'd/x');
  p.link();
  const r = p.git('stash', 'push', '-q', '--staged');
  assert.notEqual(r.status, 0);
  assert.deepEqual([p.out(), p.stashes(), p.kind()], [[], 1, 'symlink']);
});

test('probe: whole stash push with d replaced by the link: git refuses (beyond a symbolic link), nothing outside, no stash', (t) => {
  const p = probeWorld(t);
  p.link();
  const r = p.git('stash', 'push', '-q');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /beyond a symbolic link/);
  assert.deepEqual([p.out(), p.stashes()], [[], 0]);
});

test('probe: stash apply / apply --index / pop of a stash writing d/n through the link: the merge refuses (untracked d would be overwritten)', (t) => {
  for (const args of [['apply', '-q'], ['apply', '-q', '--index'], ['pop', '-q']]) {
    const p = stashBeyondLink(t);
    const r = p.git('stash', ...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /untracked working tree files would be overwritten by merge:\n\td\n/);
    assert.deepEqual([p.out(), p.stashes(), p.kind()], [[], 1, 'symlink']);
  }
});

test('probe: stash apply with d/x still in the index and d replaced by the link: git replaces the link with a real directory', (t) => {
  const p = probeWorld(t);
  p.repo.write('d/x', 'x2\n');
  p.repo.git('stash', 'push', '-q');
  p.link();
  const r = p.git('stash', 'apply', '-q');
  assert.equal(r.status, 0);
  assert.deepEqual([p.out(), p.kind()], [[], 'dir']);
  assert.equal(fs.readFileSync(path.join(p.repo.dir, 'd/x'), 'utf8'), 'x2\n');
});

test('probe: the untracked part u/y with u an untracked symlink: git cannot create u/ and fails after the tracked merge, nothing outside', (t) => {
  const p = probeWorld(t);
  p.repo.write('u/y', 'y\n');
  p.repo.git('stash', 'push', '-q', '-u');
  p.link('u');
  const r = p.git('stash', 'apply', '-q');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /could not restore untracked files from stash/);
  assert.deepEqual([p.out(), p.kind('u')], [[], 'symlink']);
});

test('probe: stash branch of that stash: the checkout refuses (untracked d would be overwritten), nothing outside', (t) => {
  const p = stashBeyondLink(t);
  const r = p.git('stash', 'branch', 'nb');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /would be overwritten by checkout/);
  assert.deepEqual([p.out(), p.stashes(), p.kind()], [[], 1, 'symlink']);
});

test('probe: under GIT_LITERAL_PATHSPECS=1, stash push -u without paths leaves the untracked files (with `.` it removes them); --keep-index fails', (t) => {
  const p = probeWorld(t);
  p.repo.write('u.txt', 'u\n');
  assert.equal(p.git('stash', 'push', '-q', '-u').status, 0);
  assert.equal(fs.existsSync(path.join(p.repo.dir, 'u.txt')), true);
  assert.equal(p.repo.git('show', 'stash@{0}^3:u.txt'), 'u');
  fs.writeFileSync(path.join(p.repo.dir, 'v.txt'), 'v\n');
  fs.rmSync(path.join(p.repo.dir, 'u.txt'));
  assert.equal(p.git('stash', 'push', '-q', '-u', '--', '.').status, 0);
  assert.equal(fs.existsSync(path.join(p.repo.dir, 'v.txt')), false);
  p.repo.write('a.txt', 'a2\n');
  p.repo.git('add', 'a.txt');
  const keep = p.git('stash', 'push', '-q', '--keep-index');
  assert.notEqual(keep.status, 0);
  assert.match(keep.stderr, /pathspec ':\/' did not match/);
});
