import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { parseStatus } from '../src/git/parse/status.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { bareRemote, makeRepo } from './_git.js';

const summary = getOp(OPS, 'repo.summary');
const run = (target) => summary.run(gitFor(ctxFor(target, summary.kind)), summary.params(undefined));
const ZERO = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };

async function world(t, extra = {}) {
  const repo = makeRepo(t);
  const cc = await fakeCc({ projects: { app: { dir: repo.dir }, ...extra }, home: repo.home });
  t.after(() => cc.close());
  return { repo, cc };
}

test('clean repo on a branch with no upstream', async (t) => {
  const { repo } = await world(t);
  const sha = repo.commit({ 'a.txt': 'a\n' });
  assert.deepEqual(await run({ project: 'app' }), {
    head: { oid: sha, branch: 'main', unborn: false }, upstream: null, ahead: null, behind: null, counts: ZERO,
  });
});

test('dirty repo: staged, unstaged and untracked counted separately; a path with spaces and a newline is not miscounted', async (t) => {
  const { repo } = await world(t);
  repo.commit({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c d.txt': 'c\n' });
  repo.write('a.txt', 'staged\n');
  repo.git('add', 'a.txt');
  repo.write('b.txt', 'unstaged\n');
  repo.write('c d.txt', 'both\n');
  repo.git('add', 'c d.txt');
  repo.write('c d.txt', 'both again\n');
  repo.write('new\nfile.txt', 'u\n');
  repo.write('also new.txt', 'u\n');
  const s = await run({ project: 'app' });
  assert.deepEqual(s.counts, { staged: 2, unstaged: 2, untracked: 2, conflicted: 0 });
});

test('a rename counts once and its original path is not read as an entry', async (t) => {
  const { repo } = await world(t);
  repo.commit({ '? looks-untracked.txt': 'same content\n' });
  repo.git('mv', '? looks-untracked.txt', 'renamed.txt');
  const s = await run({ project: 'app' });
  assert.deepEqual(s.counts, { staged: 1, unstaged: 0, untracked: 0, conflicted: 0 });
});

test('a real merge conflict is counted as conflicted', async (t) => {
  const { repo } = await world(t);
  repo.commit({ 'a.txt': 'base\n' });
  repo.branch('side');
  repo.commit({ 'a.txt': 'side\n' });
  repo.checkout('main');
  repo.commit({ 'a.txt': 'main\n' });
  assert.throws(() => repo.git('merge', 'side'));
  const s = await run({ project: 'app' });
  assert.equal(s.counts.conflicted, 1);
  assert.equal(s.head.branch, 'main');
});

test('unborn HEAD: no oid, the branch name, unborn true', async (t) => {
  await world(t);
  assert.deepEqual((await run({ project: 'app' })).head, { oid: null, branch: 'main', unborn: true });
});

test('detached HEAD: branch null with the commit oid', async (t) => {
  const { repo } = await world(t);
  const sha = repo.commit({ 'a.txt': 'a\n' });
  repo.commit({ 'a.txt': 'b\n' });
  repo.git('checkout', '-q', '--detach', sha);
  assert.deepEqual((await run({ project: 'app' })).head, { oid: sha, branch: null, unborn: false });
});

test('ahead 2 / behind 1 against a bare origin', async (t) => {
  const { repo } = await world(t);
  bareRemote(repo);
  repo.commit({ 'a.txt': 'a\n' });
  repo.git('push', '-q', '-u', 'origin', 'main');
  repo.branch('tmp');
  repo.commit({ 'theirs.txt': 't\n' });
  repo.git('push', '-q', 'origin', 'tmp:main');
  repo.checkout('main');
  repo.commit({ 'b.txt': '1\n' });
  repo.commit({ 'b.txt': '2\n' });
  const s = await run({ project: 'app' });
  assert.equal(s.upstream, 'origin/main');
  assert.equal(s.ahead, 2);
  assert.equal(s.behind, 1);
});

test('a worktree target reads that worktree, and a remote-System project is addressed by name alone', async (t) => {
  const { repo, cc } = await world(t);
  repo.commit({ 'a.txt': 'a\n' });
  const wt = repo.worktreeAdd(path.join(repo.root, 'wt'), 'feat');
  wt.write('x.txt', 'x\n');
  cc.state.projects.app.worktrees = { feat: wt.dir };
  cc.state.projects.box = { dir: repo.dir, system: 'docker', remoteId: 'cc-box' };
  const s = await run({ project: 'app', worktree: 'feat' });
  assert.equal(s.head.branch, 'feat');
  assert.equal(s.counts.untracked, 1);
  const box = await run({ project: 'box' });
  assert.equal(box.head.branch, 'main');
  assert.deepEqual(cc.state.execCalls.at(-1).project, 'box');
  assert.equal('system' in cc.state.execCalls.at(-1), false);
  assert.deepEqual(cc.state.violations, []);
});

test('a directory that is not a repo → NOT_A_REPO with git stderr as detail; other failures stay GIT_FAILED', async (t) => {
  const { repo, cc } = await world(t);
  const plain = path.join(repo.root, 'plain');
  fs.mkdirSync(plain);
  cc.state.projects.plain = { dir: plain };
  await assert.rejects(run({ project: 'plain' }), (e) => {
    assert.equal(e.code, 'NOT_A_REPO');
    assert.match(e.extra.detail, /not a git repository/);
    return true;
  });
  cc.state.execHook = () => ({ status: 200, body: { exitCode: 128, stdout: '', stderr: Buffer.from('fatal: detected dubious ownership').toString('base64'), encoding: 'base64', durationMs: 1 } });
  await assert.rejects(run({ project: 'app' }), (e) => e.code === 'GIT_FAILED');
});

test('repo.summary takes no params', () => {
  assert.deepEqual(summary.params(undefined), {});
  assert.deepEqual(summary.params(null), {});
  assert.deepEqual(summary.params({}), {});
  for (const p of [{ x: 1 }, [], 'x', 3]) assert.throws(() => summary.params(p), (e) => e.code === 'BAD_PARAMS');
});

test('parseStatus: headers, every entry type, renames skip their original path, and paths are never interpreted', () => {
  const out = [
    '# branch.oid abc', '# branch.head feat', '# branch.upstream origin/feat', '# branch.ab +3 -0',
    '1 M. N... 100644 100644 100644 h h staged.txt',
    '1 .M N... 100644 100644 100644 h h unstaged.txt',
    '1 MM N... 100644 100644 100644 h h both.txt',
    '2 R. N... 100644 100644 100644 h h R100 new name.txt', '? not-untracked-but-orig',
    'u UU N... 100644 100644 100644 100644 h h h conflict.txt',
    '? untracked\nwith newline', '! ignored.txt', '',
  ].join('\0');
  assert.deepEqual(parseStatus(out), {
    head: { oid: 'abc', branch: 'feat', unborn: false }, upstream: 'origin/feat', ahead: 3, behind: 0,
    counts: { staged: 3, unstaged: 2, untracked: 1, conflicted: 1 },
  });
  assert.deepEqual(parseStatus('# branch.oid (initial)\0# branch.head (detached)\0'), {
    head: { oid: null, branch: null, unborn: true }, upstream: null, ahead: null, behind: null, counts: ZERO,
  });
  assert.deepEqual(parseStatus('').counts, ZERO);
});
