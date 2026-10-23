import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv, makeRepo } from './_git.js';

// Documentation: what git itself does with the mechanisms the merge, rebase and conflict ops rely on (docs/merge.md,
// wiki: gotchas/sequencer), run directly with code-git's env (LC_ALL=C, GIT_LITERAL_PATHSPECS=1, editors `false`). A
// change here is a change in git the ops must follow.

function probeWorld(t) {
  const repo = makeRepo(t);
  const env = { ...hermeticEnv(repo.home), GIT_LITERAL_PATHSPECS: '1', GIT_EDITOR: 'false', GIT_SEQUENCE_EDITOR: 'false' };
  /** Runs git in the repo: {status, stdout, stderr}; `input` on stdin, `extra` env on top. */
  const git = (args, { input, extra = {} } = {}) => {
    const r = spawnSync('git', ['-C', repo.dir, ...args], { env: { ...env, ...extra }, encoding: 'utf8', input: input ?? '' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const oid = (rev) => repo.git('rev-parse', rev);
  const gitDir = (rel) => path.join(repo.dir, '.git', rel);
  const exists = (ref) => git(['rev-parse', '--verify', '-q', ref]).status === 0;
  /** `rebase -i` with the todo on stdin through the `cat >` sequence editor. */
  const todoRebase = (todo, onto, upstream = onto, extra = {}) => git(
    ['-c', 'rebase.backend=merge', 'rebase', '-i', '--empty=drop', `--onto=${onto}`, '--end-of-options', upstream],
    { input: todo, extra: { GIT_SEQUENCE_EDITOR: 'cat >', ...extra } },
  );
  return { repo, git, oid, gitDir, exists, todoRebase };
}

/** main: base ← a ← b ← c, each adding its own file. */
function linear(t) {
  const p = probeWorld(t);
  const base = p.repo.commit({ 'f.txt': 'base\n' }, 'base');
  const [a, b, c] = ['a', 'b', 'c'].map((n) => p.repo.commit({ [`${n}.txt`]: `${n}\n` }, n));
  return { ...p, base, a, b, c };
}

/** f.txt changed on `topic` and on `main` since base: merging or rebasing one onto the other conflicts. */
function diverged(t) {
  const p = probeWorld(t);
  const base = p.repo.commit({ 'f.txt': 'base\n', 'g.txt': 'g\n' }, 'base');
  p.repo.branch('topic');
  const topic = p.repo.commit({ 'f.txt': 'topic\n' }, 'topic change');
  p.repo.checkout('main');
  const main = p.repo.commit({ 'f.txt': 'main\n' }, 'main change');
  return { ...p, base, topic, main };
}

test('probe: GIT_SEQUENCE_EDITOR="cat >" copies stdin into git\'s todo exactly; no tty; a pre-rebase hook gets no stdin', (t) => {
  const p = linear(t);
  const capture = path.join(p.repo.root, 'hook-stdin');
  p.repo.hook('pre-rebase', `#!/bin/sh\ncat > '${capture}'\nexit 0\n`);
  const todo = `pick ${p.c}\nedit ${p.b}\ndrop ${p.a}\n`;
  const r = p.todoRebase(todo, p.base);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(capture, 'utf8'), '', 'the hook read nothing of the todo');
  // Stopped at the edit: done holds what ran, the todo what is left.
  const done = fs.readFileSync(p.gitDir('rebase-merge/done'), 'utf8');
  const left = fs.readFileSync(p.gitDir('rebase-merge/git-rebase-todo'), 'utf8');
  assert.equal(done, `pick ${p.c}\nedit ${p.b}\n`);
  assert.equal(left, `drop ${p.a}\n`);
});

test('probe: REBASE_HEAD names the commit at an edit stop and at a conflict stop; after an edit stop on the last todo line it outlives the rebase', (t) => {
  const p = linear(t);
  p.todoRebase(`edit ${p.a}\npick ${p.b}\npick ${p.c}\n`, p.base);
  assert.equal(p.oid('REBASE_HEAD'), p.a);
  assert.equal(p.git(['rebase', '--continue'], { extra: { GIT_EDITOR: ':' } }).status, 0);
  assert.equal(p.exists('REBASE_HEAD'), false, 'the picks after it remove it');
  p.todoRebase(`pick ${p.a}\npick ${p.b}\nedit ${p.c}\n`, p.base);
  assert.equal(p.git(['rebase', '--continue'], { extra: { GIT_EDITOR: ':' } }).status, 0);
  assert.deepEqual([fs.existsSync(p.gitDir('rebase-merge')), p.oid('REBASE_HEAD')], [false, p.c], 'REBASE_HEAD is left behind');
  const d = diverged(t);
  d.repo.checkout('topic');
  const r = d.git(['-c', 'rebase.backend=merge', 'rebase', '--end-of-options', 'main']);
  assert.equal(r.status, 1);
  assert.equal(d.oid('REBASE_HEAD'), d.topic);
});

test('probe: rebase -i --onto HEAD HEAD with a pick todo cherry-picks the rows onto HEAD in order', (t) => {
  const p = linear(t);
  p.repo.git('checkout', '-q', '-b', 'other', p.base);
  const o = p.repo.commit({ 'o.txt': 'o\n' }, 'o');
  const r = p.todoRebase(`pick ${p.c}\npick ${p.a}\n`, 'HEAD', 'HEAD');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(p.repo.git('log', '--format=%s', `${o}..HEAD`), 'a\nc');
  assert.equal(p.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/other');
});

test('probe: an empty todo is "nothing to do" (exit 1, nothing changes); an all-drop todo is not: it resets the branch to the upstream', (t) => {
  const p = linear(t);
  const empty = p.todoRebase('', p.a);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /nothing to do/);
  assert.equal(p.oid('HEAD'), p.c);
  const drop = p.todoRebase(`drop ${p.b}\ndrop ${p.c}\n`, p.a);
  assert.equal(drop.status, 0, drop.stderr);
  assert.equal(p.oid('main'), p.a);
});

test('probe: --continue launches the editor (GIT_EDITOR=false fails it); GIT_EDITOR=: keeps the prepared message', (t) => {
  const d = diverged(t);
  d.repo.checkout('topic');
  d.git(['-c', 'rebase.backend=merge', 'rebase', '--end-of-options', 'main']);
  d.repo.write('f.txt', 'resolved\n');
  d.repo.git('add', 'f.txt');
  const refused = d.git(['rebase', '--continue']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /problem with the editor 'false'/);
  assert.equal(d.git(['rebase', '--continue'], { extra: { GIT_EDITOR: ':' } }).status, 0);
  assert.deepEqual([d.repo.git('log', '-1', '--format=%s'), d.repo.git('log', '-1', '--format=%P')], ['topic change', d.main]);
});

test('probe: during a rebase stage 2 ("ours") is the onto side and stage 3 ("theirs") the commit being replayed', (t) => {
  const d = diverged(t);
  d.repo.checkout('topic');
  d.git(['-c', 'rebase.backend=merge', 'rebase', '--end-of-options', 'main']);
  assert.deepEqual([d.repo.git('show', ':2:f.txt'), d.repo.git('show', ':3:f.txt')], ['main', 'topic']);
});

test('probe: continue wording — an empty cherry-pick or revert says "nothing to commit" / "is now empty" (exit 1, still in progress); a rebase with unstaged changes "You must edit all merge conflicts"', (t) => {
  for (const which of ['cherry-pick', 'revert']) {
    const d = diverged(t);
    if (which === 'cherry-pick') d.git(['cherry-pick', '--end-of-options', d.topic]);
    else { d.repo.commit({ 'f.txt': 'later\n' }, 'later'); d.git(['revert', '--no-edit', '--end-of-options', d.main]); }
    d.git(['checkout', '--ours', '--', 'f.txt']);
    d.repo.git('add', 'f.txt');
    const r = d.git([which, '--continue'], { extra: { GIT_EDITOR: ':' } });
    assert.equal(r.status, 1, which);
    assert.match(`${r.stdout}${r.stderr}`, /nothing to commit|is now empty/, which);
    assert.equal(d.exists(which === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD'), true, which);
  }
  const d = diverged(t);
  d.repo.checkout('topic');
  d.git(['-c', 'rebase.backend=merge', 'rebase', '--end-of-options', 'main']);
  d.repo.write('f.txt', 'resolved\n');
  d.repo.git('add', 'f.txt');
  d.repo.write('g.txt', 'unstaged\n');
  const r = d.git(['rebase', '--continue'], { extra: { GIT_EDITOR: ':' } });
  assert.equal(r.status, 1);
  assert.match(`${r.stdout}${r.stderr}`, /You must edit all merge conflicts/);
  assert.equal(d.exists('REBASE_HEAD'), true);
});

test('probe: a carrier (commit-tree of X\'s tree and parent, new message, X\'s author) — "pick <carrier>" with nothing changed before it fast-forwards onto the carrier itself', (t) => {
  const p = linear(t);
  const author = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: '1580515200 +0100' };
  const carrier = p.git(['commit-tree', `${p.b}^{tree}`, '-p', p.a, '-F', '-'], { input: 'reworded\n\nbody\n', extra: author }).stdout.trim();
  const r = p.todoRebase(`pick ${p.a}\npick ${carrier}\npick ${p.c}\n`, p.base);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(p.oid('HEAD~1'), carrier);
  assert.equal(p.repo.git('log', '-1', '--format=%an|%ae|%ad|%B', '--date=raw', 'HEAD~1'), 'Ada|ada@example.com|1580515200 +0100|reworded\n\nbody');
});

test('probe: commit-tree ignores commit.gpgSign (no -S, no signing); -S with a failing gpg.program fails', (t) => {
  const p = linear(t);
  p.repo.git('config', 'commit.gpgSign', 'true');
  p.repo.git('config', 'gpg.program', 'false');
  const plain = p.git(['commit-tree', `${p.c}^{tree}`, '-p', p.c, '-F', '-'], { input: 'm\n' });
  assert.equal(plain.status, 0, plain.stderr);
  assert.notEqual(p.git(['commit-tree', '-S', `${p.c}^{tree}`, '-p', p.c, '-F', '-'], { input: 'm\n' }).status, 0);
});

test('probe: restore --source=<one-file tree> --worktree on an unmerged path writes the file and leaves its stages', (t) => {
  const d = diverged(t);
  d.git(['merge', '--no-edit', '--end-of-options', 'topic']);
  const stages = d.repo.git('ls-files', '-u');
  const blob = d.git(['hash-object', '-w', '--stdin', '--path=f.txt'], { input: 'resolved\n' }).stdout.trim();
  const tree = d.git(['mktree', '-z'], { input: `100644 blob ${blob}\tf.txt\0` }).stdout.trim();
  const r = d.git(['restore', `--source=${tree}`, '--worktree', '--', 'f.txt']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d.repo.dir, 'f.txt'), 'utf8'), 'resolved\n');
  assert.equal(d.repo.git('ls-files', '-u'), stages);
});

test('probe: an `update-index -z --index-info` stage-0 entry replaces every unmerged stage of the path; a gitlink\'s worktree is untouched', (t) => {
  const d = diverged(t);
  d.git(['merge', '--no-edit', '--end-of-options', 'topic']);
  const r = d.git(['update-index', '-z', '--index-info'], { input: `100644 ${d.repo.git('rev-parse', `${d.topic}:f.txt`)} 0\tf.txt\0` });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(d.repo.git('ls-files', '-u'), '');
  assert.equal(d.repo.git('ls-files', '-s', 'f.txt').split(' ')[2], '0\tf.txt');
  assert.match(fs.readFileSync(path.join(d.repo.dir, 'f.txt'), 'utf8'), /^<<<<<<< /, 'the worktree file is not written');
  // A gitlink added on both sides (no submodule checked out): the stage-0 entry resolves it; the directory stays as it was.
  const g = probeWorld(t);
  g.repo.commit({ 'x.txt': 'x\n' }, 'base');
  const link = (to) => { g.repo.git('update-index', '--add', '--cacheinfo', `160000,${to},sub`); g.repo.git('commit', '-qm', `sub ${to.slice(0, 7)}`); };
  const [x, y] = [g.oid('HEAD'), g.repo.commit({ 'y.txt': 'y\n' }, 'y')];
  g.repo.git('checkout', '-q', '-b', 'topic', x);
  link(x);
  g.repo.checkout('main');
  link(y);
  g.repo.write('sub/inner.txt', 'mine\n');
  assert.equal(g.git(['merge', '--no-edit', '--end-of-options', 'topic']).status, 1);
  assert.equal(g.repo.git('ls-files', '-u', 'sub').split('\n').length, 2);
  assert.equal(g.git(['update-index', '-z', '--index-info'], { input: `160000 ${x} 0\tsub\0` }).status, 0);
  assert.equal(g.repo.git('ls-files', '-u'), '');
  assert.equal(g.repo.git('ls-files', '-s', 'sub'), `160000 ${x} 0\tsub`);
  assert.equal(fs.readFileSync(path.join(g.repo.dir, 'sub/inner.txt'), 'utf8'), 'mine\n');
});
