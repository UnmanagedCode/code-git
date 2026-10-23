import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv, makeRepo } from './_git.js';

// The git behaviours the undo steps rest on (src/git/undo/steps/), pinned with git run directly.

function world(t) {
  const repo = makeRepo(t);
  const env = hermeticEnv(repo.home);
  const run = (args, input) => spawnSync('git', ['-C', repo.dir, ...args], { env, input, encoding: 'utf8' });
  return { repo, run };
}

// Invariant: reset --keep refuses (exit 128) a move over a local change to a file the move rewrites, naming it in the
// "Entry '<path>' not uptodate. Cannot merge." line the keep step parses; and over an untracked file in the way, on one
// "Untracked working tree file '<path>' would be overwritten by merge." line (no indented list for parseConflictFiles).
test('probe: reset --keep refuses over a local change ("not uptodate") and over an untracked file in the way', (t) => {
  const { repo, run } = world(t);
  const one = repo.commit({ 'f.txt': 'one\n' }, 'one');
  repo.commit({ 'f.txt': 'two\n' }, 'two');
  repo.write('f.txt', 'local\n');
  const r = run(['reset', '--keep', one]);
  assert.equal(r.status, 128);
  assert.match(r.stderr, /^error: Entry 'f\.txt' not uptodate\. Cannot merge\.$/m);
  repo.git('checkout', '-q', 'f.txt');
  repo.commit({ 'g.txt': 'g\n' }, 'three');
  repo.git('reset', '-q', '--keep', one);
  repo.write('g.txt', 'untracked in the way\n');
  const back = run(['reset', '--keep', 'HEAD@{1}']);
  assert.notEqual(back.status, 0);
  assert.match(back.stderr, /^error: Untracked working tree file 'g\.txt' would be overwritten by merge\.$/m);
  assert.equal(fs.readFileSync(path.join(repo.dir, 'g.txt'), 'utf8'), 'untracked in the way\n');
});

// Invariant: an `update-ref --stdin -z` transaction whose compare-and-swap misses writes nothing and says one of the
// phrases CAS_RE (src/git/undo/steps/refs.js) matches.
test('probe: a transaction CAS miss writes nothing; its wording is "but expected" / "reference already exists" / "unable to resolve reference"', (t) => {
  const { repo, run } = world(t);
  const a = repo.commit({ 'f.txt': 'a\n' }, 'a');
  const b = repo.commit({ 'f.txt': 'b\n' }, 'b');
  repo.git('branch', 'x', a);
  const tx = (lines) => run(['update-ref', '--no-deref', '--stdin', '-z'], `${['start', ...lines, 'prepare', 'commit'].join('\0')}\0`);
  const moved = tx(['create refs/heads/new', b, 'update refs/heads/x', b, b]);
  assert.equal(moved.status, 128);
  assert.match(moved.stderr, /but expected/);
  assert.throws(() => repo.git('rev-parse', '--verify', '-q', 'refs/heads/new'), 'nothing of the transaction was written');
  assert.match(tx(['create refs/heads/x', b]).stderr, /reference already exists/);
  assert.match(tx(['delete refs/heads/missing', a]).stderr, /unable to resolve reference/);
});

// Invariant: a temporary index built with `update-index --add --remove -z --stdin` records worktree content, the exec
// bit and symlinks, and leaves a missing path out; `restore --source=<commit> --worktree` then writes an untracked path
// back and deletes a tracked path the source lacks.
test('probe: the discard snapshot keeps modes and symlinks; restore --source writes untracked paths and deletes what the source lacks', (t) => {
  const { repo, run } = world(t);
  repo.commit({ 'f.txt': 'f\n', 'run.sh': 'echo\n', 'gone.txt': 'gone\n' }, 'base');
  fs.chmodSync(path.join(repo.dir, 'run.sh'), 0o755);
  fs.rmSync(path.join(repo.dir, 'gone.txt'));
  fs.symlinkSync('f.txt', path.join(repo.dir, 'link'));
  const index = path.join(repo.dir, '.git', 'probe-index');
  const env = { ...hermeticEnv(repo.home), GIT_INDEX_FILE: index };
  const tmp = (args, input) => execFileSync('git', ['-C', repo.dir, ...args], { env, input, encoding: 'utf8' }).trim();
  tmp(['read-tree', '--empty']);
  tmp(['update-index', '--add', '--remove', '-z', '--stdin'], 'run.sh\0gone.txt\0link\0');
  const tree = tmp(['write-tree']);
  assert.deepEqual(repo.git('ls-tree', tree).split('\n').map((l) => l.split(/\s/)[0] + ' ' + l.split('\t')[1]), ['120000 link', '100755 run.sh']);
  const snap = repo.git('commit-tree', '-m', 's', tree);
  repo.git('checkout', '-q', '--', 'gone.txt', 'run.sh');
  fs.rmSync(path.join(repo.dir, 'link'));
  const r = run(['restore', `--source=${snap}`, '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'], 'run.sh\0gone.txt\0link\0');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readlinkSync(path.join(repo.dir, 'link')), 'f.txt');
  assert.equal(fs.existsSync(path.join(repo.dir, 'gone.txt')), false);
  assert.equal(fs.statSync(path.join(repo.dir, 'run.sh')).mode & 0o111, 0o111);
});

// Invariant: `rev-list --stdin --not --remotes` lists the stdin range minus everything any remote-tracking ref reaches.
test('probe: rev-list --stdin with --not --remotes after it subtracts only the remote-tracking refs', (t) => {
  const { repo, run } = world(t);
  const a = repo.commit({ 'f.txt': 'a\n' }, 'a');
  const b = repo.commit({ 'f.txt': 'b\n' }, 'b');
  const c = repo.commit({ 'f.txt': 'c\n' }, 'c');
  repo.git('update-ref', 'refs/remotes/somewhere/x', b);
  const stdin = `${c}\n^${a}\n`;
  assert.deepEqual(run(['rev-list', '--stdin'], stdin).stdout.trim().split('\n'), [c, b]);
  assert.deepEqual(run(['rev-list', '--stdin', '--not', '--remotes'], stdin).stdout.trim().split('\n'), [c]);
});

// Invariant: the commands the steps run accept --end-of-options before their values (update-ref, symbolic-ref,
// read-tree, diff-index, diff-tree, stash apply), and `config --remove-section` of a missing section exits 128.
test('probe: --end-of-options is accepted where the steps pass it; a missing config section is exit 128', (t) => {
  const { repo, run } = world(t);
  const a = repo.commit({ 'f.txt': 'a\n' }, 'a');
  const tree = repo.git('rev-parse', `${a}^{tree}`);
  for (const args of [
    ['update-ref', '--no-deref', '-m', 'm', '--end-of-options', 'refs/heads/e', a, ''],
    ['update-ref', '--no-deref', '-m', 'm', '-d', '--end-of-options', 'refs/heads/e', a],
    ['symbolic-ref', '-m', 'm', '--end-of-options', 'refs/heads/s', 'refs/heads/main'],
    ['symbolic-ref', '--delete', '--end-of-options', 'refs/heads/s'],
    ['read-tree', '--end-of-options', tree],
    ['diff-index', '--cached', '--quiet', '--end-of-options', tree, '--'],
    ['diff-tree', '-r', '--name-only', '--end-of-options', a, a],
  ]) assert.equal(run(args).status, 0, args.join(' '));
  repo.write('f.txt', 'changed\n');
  const snap = repo.git('stash', 'create');
  repo.git('checkout', '-q', 'f.txt');
  assert.equal(run(['stash', 'apply', '-q', '--index', '--end-of-options', snap]).status, 0);
  assert.equal(run(['config', '--remove-section', 'branch.none']).status, 128);
});
