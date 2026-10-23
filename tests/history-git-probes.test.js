import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { hermeticEnv, makeRepo } from './_git.js';

// The git behaviours the history ops rest on (src/git/ops/history.js), pinned with git run directly.

/** a.txt → (rename) b.txt → (edit) → (rename) c.txt, then an unrelated commit on top: HEAD. */
function renames(t) {
  const repo = makeRepo(t);
  const env = hermeticEnv(repo.home);
  const run = (args) => spawnSync('git', ['-C', repo.dir, ...args], { env, encoding: 'utf8' });
  repo.commit({ 'a.txt': 'one\ntwo\nthree\n' }, 'one');
  repo.git('mv', 'a.txt', 'b.txt');
  repo.commit({}, 'to b');
  repo.commit({ 'b.txt': 'one\nTWO\nthree\n' }, 'edit b');
  repo.git('mv', 'b.txt', 'c.txt');
  repo.commit({}, 'to c');
  repo.commit({ 'other.txt': 'x\n' }, 'other');
  return { repo, run };
}
const subjects = (r) => r.stdout.split('\n').filter(Boolean);

// Invariant: --follow with --skip skips commits of the unfiltered walk and loses the rename, while --max-count counts
// shown commits — why history.file re-walks with --max-count and slices (the paging convention's one exception).
test('probe: log --follow --skip is broken (skips unfiltered commits, drops the rename); --max-count is not', (t) => {
  const { run } = renames(t);
  const log = (...extra) => subjects(run(['log', '--follow', '--format=%s', ...extra, 'HEAD', '--', 'c.txt']));
  assert.deepEqual(log(), ['to c', 'edit b', 'to b', 'one']);
  assert.deepEqual(log('--skip=1'), ['to c', 'edit b', 'to b', 'one'], 'skip 1 skipped "other", which never touched c.txt');
  assert.deepEqual(log('--skip=2'), [], 'skip 2 skipped the rename to c.txt and lost the file');
  assert.deepEqual(log('--max-count=2'), ['to c', 'edit b']);
});

// Invariant: `-z --name-status` with a NUL format: six NUL-ended fields, then "\n<status>" and one path (two for a
// rename: old, new), each NUL-ended, then the next commit — the layout parseFileHistory reads.
test('probe: the -z record layout of log --follow --name-status', (t) => {
  const { repo, run } = renames(t);
  const out = run(['log', '--follow', '-M', '--name-status', '-z', '--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%s', '--max-count=2', 'HEAD', '--', 'c.txt']).stdout;
  const toC = repo.git('rev-parse', 'HEAD~1');
  const edit = repo.git('rev-parse', 'HEAD~2');
  const t0 = out.split('\0');
  assert.equal(t0[0], toC);
  assert.equal(t0[5], 'to c');
  assert.deepEqual(t0.slice(6, 9), ['\nR100', 'b.txt', 'c.txt']);
  assert.equal(t0[9], edit);
  assert.deepEqual(t0.slice(15, 17), ['\nM', 'b.txt']);
  assert.equal(t0[17], '');
});

// Invariant: under --date=unix, a reflog's %gd is "<ref>@{<unix time>}" (the entry's time, not its index), and
// `log -g --skip` pages the reflog by entries.
test('probe: %gd under --date=unix is the entry time; log -g pages with --skip', (t) => {
  const { run } = renames(t);
  const gd = subjects(run(['log', '-g', '--date=unix', '--format=%gd', '--max-count=2', 'HEAD', '--']));
  for (const s of gd) assert.match(s, /^HEAD@\{\d{9,}\}$/);
  assert.deepEqual(subjects(run(['log', '-g', '--format=%gs', '--skip=1', '--max-count=1', 'HEAD', '--'])), ['commit: to c']);
});

// Invariant: blame porcelain prints a commit's headers once; a later group of the same commit has only its header line.
test('probe: blame --porcelain prints a repeated commit\'s headers once', (t) => {
  const { repo, run } = renames(t);
  repo.commit({ 'p.txt': 'a\nb\nc\n' }, 'p1');
  repo.commit({ 'p.txt': 'a\nB\nc\n' }, 'p2');
  const out = run(['blame', '--porcelain', 'HEAD', '--', 'p.txt']).stdout;
  const p1 = repo.git('rev-parse', 'HEAD~1');
  assert.equal(out.split('\n').filter((l) => l === 'summary p1').length, 1);
  assert.match(out, new RegExp(`^${p1} 3 3( 1)?\\n\\tc$`, 'm'));
});

// Invariant: a configured blame.ignoreRevsFile that is missing kills blame, and `-c blame.ignoreRevsFile=` does not
// clear it; `--no-ignore-revs-file` does. blame takes no --end-of-options before its revision.
test('probe: --no-ignore-revs-file neutralises a missing blame.ignoreRevsFile; -c blame.ignoreRevsFile= does not', (t) => {
  const { repo, run } = renames(t);
  repo.git('config', 'blame.ignoreRevsFile', 'missing-file');
  assert.match(run(['blame', 'HEAD', '--', 'c.txt']).stderr, /could not open object name list: missing-file/);
  assert.equal(run(['-c', 'blame.ignoreRevsFile=', 'blame', 'HEAD', '--', 'c.txt']).status, 128);
  assert.equal(run(['blame', '--no-ignore-revs-file', 'HEAD', '--', 'c.txt']).status, 0);
  assert.equal(run(['blame', '--no-ignore-revs-file', '--end-of-options', 'HEAD', '--', 'c.txt']).status, 128);
});
