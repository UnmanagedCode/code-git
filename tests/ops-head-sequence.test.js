import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv } from './_git.js';
import { refsWorld, refused } from './_refsWorld.js';

// head.continue / head.skip / head.abort for each operation, and the starts that refuse while one is in progress.

const read = (w, f) => fs.readFileSync(path.join(w.repo.dir, f), 'utf8');

/** main: base ← main change (f.txt main); topic: base ← topic change (f.txt topic) ← t2 (f.txt t2, g.txt). */
async function world(t) {
  const w = await refsWorld(t);
  w.repo.branch('topic');
  const topic = w.repo.commit({ 'f.txt': 'topic\n' }, 'topic change');
  const t2 = w.repo.commit({ 'f.txt': 't2\n', 'g.txt': 'g\n' }, 't2');
  w.repo.checkout('main');
  const main = w.repo.commit({ 'f.txt': 'main\n' }, 'main change');
  const user = (args, extra = {}) => spawnSync('git', ['-C', w.repo.dir, ...args], {
    env: { ...hermeticEnv(w.repo.home), GIT_EDITOR: 'false', ...extra }, encoding: 'utf8',
  });
  const kind = async () => (await w.op('commit.state')).operation?.kind ?? null;
  /** Each continue/skip exec's env, as sent to cc. */
  const resumeEnvs = () => w.cc.state.execCalls.filter((b) => b.argv.includes('--continue') || b.argv.includes('--skip')).map((b) => b.env);
  /** Starts `which` so that it stops on f.txt's conflict (rebase: topic onto main, two commits). */
  const stop = (which) => {
    if (which === 'merge') user(['merge', '--no-edit', 'topic']);
    if (which === 'rebase') { w.repo.checkout('topic'); user(['-c', 'rebase.backend=merge', 'rebase', 'main']); }
    if (which === 'cherry-pick') user(['cherry-pick', topic]);
    if (which === 'revert') { w.repo.commit({ 'f.txt': 'later\n' }, 'later'); user(['revert', '--no-edit', main]); }
  };
  const resolve = (content = 'resolved\n') => { w.repo.write('f.txt', content); w.repo.git('add', 'f.txt'); };
  return { ...w, topic, t2, main, user, kind, resumeEnvs, stop, resolve };
}

const KINDS = ['merge', 'rebase', 'cherry-pick', 'revert'];

test('continue: each kind, once resolved and staged, finishes (done, HEAD on the new commit, nothing in progress) with GIT_EDITOR=:', async (t) => {
  for (const which of KINDS) {
    const w = await world(t);
    w.stop(which);
    assert.equal(await w.kind(), which);
    const before = w.oid('HEAD');
    // A rebase resolved to topic's side replays t2 cleanly after it.
    w.resolve(which === 'rebase' ? 'topic\n' : 'resolved\n');
    const r = await w.op('head.continue', { which });
    assert.equal(r.outcome, 'done', which);
    assert.equal(r.oid, w.oid('HEAD'), which);
    // A rebase replays both topic commits onto main; the others commit once on top of HEAD.
    if (which === 'rebase') assert.deepEqual([w.repo.git('log', '--format=%s', 'main..topic'), w.repo.git('symbolic-ref', 'HEAD')], ['t2\ntopic change', 'refs/heads/topic']);
    else assert.equal(w.repo.git('log', '-1', '--format=%P').split(' ')[0], before, which);
    assert.equal(await w.kind(), null, which);
    assert.ok(w.resumeEnvs().length > 0);
    for (const env of w.resumeEnvs()) assert.equal(env.GIT_EDITOR, ':', which);
  }
});

test('continue with unmerged files → CONFLICTED with the files; the operation stays, nothing ran', async (t) => {
  for (const which of KINDS) {
    const w = await world(t);
    w.stop(which);
    await assert.rejects(w.op('head.continue', { which }), refused('CONFLICTED', { files: ['f.txt'] }), which);
    assert.equal(await w.kind(), which);
    assert.deepEqual(w.resumeEnvs(), [], which);
  }
});

test('which names another operation (or none is in progress) → NOTHING_IN_PROGRESS for continue, skip and abort', async (t) => {
  const w = await world(t);
  for (const op of ['head.continue', 'head.skip', 'head.abort']) await assert.rejects(w.op(op, { which: 'rebase' }), refused('NOTHING_IN_PROGRESS'), op);
  w.stop('merge');
  for (const which of ['rebase', 'cherry-pick']) await assert.rejects(w.op('head.continue', { which }), refused('NOTHING_IN_PROGRESS'));
  await assert.rejects(w.op('head.abort', { which: 'revert' }), refused('NOTHING_IN_PROGRESS'));
  assert.equal(await w.kind(), 'merge');
});

test('skip: a rebase skips the stopped commit and stops on the next; a cherry-pick and a revert skip theirs (nothing left in progress)', async (t) => {
  const w = await world(t);
  w.stop('rebase');
  const r = await w.op('head.skip', { which: 'rebase' });
  assert.deepEqual([r.outcome, r.files], ['conflicts', ['f.txt']]);
  assert.equal(w.oid('REBASE_HEAD'), w.t2);
  const done = await w.op('head.skip', { which: 'rebase' });
  assert.equal(done.outcome, 'done');
  assert.deepEqual([w.oid('topic'), await w.kind()], [w.main, null]);
  for (const which of ['cherry-pick', 'revert']) {
    const x = await world(t);
    x.stop(which);
    const head = x.oid('HEAD');
    assert.equal((await x.op('head.skip', { which })).outcome, 'done', which);
    assert.deepEqual([x.oid('HEAD'), await x.kind(), x.repo.git('status', '--porcelain')], [head, null, ''], which);
    for (const env of x.resumeEnvs()) assert.equal(env.GIT_EDITOR, ':');
  }
});

test('abort: each kind puts HEAD and the files back; a rebase abort puts the branch back on HEAD', async (t) => {
  for (const which of KINDS) {
    const w = await world(t);
    if (which === 'revert') w.repo.commit({ 'f.txt': 'later\n' }, 'later');
    const own = which === 'rebase' ? { branch: 'refs/heads/topic', oid: w.t2 } : { branch: 'refs/heads/main', oid: w.oid('HEAD') };
    if (which === 'revert') w.user(['revert', '--no-edit', w.main]); else w.stop(which);
    const a = await w.op('head.abort', { which });
    assert.equal(await w.kind(), null, which);
    assert.deepEqual(a.undo.head.new, own, which);
    assert.equal(w.repo.git('status', '--porcelain'), '', which);
    assert.equal(w.repo.git('symbolic-ref', 'HEAD'), own.branch, which);
  }
});

test('a rebase continued to the end returns the undo of the whole rebase: the branch from its tip before the rebase to the new tip', async (t) => {
  const w = await world(t);
  w.stop('rebase');
  w.resolve('topic\n');
  const r = await w.op('head.continue', { which: 'rebase' });
  const now = w.oid('topic');
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/topic', old: w.t2, new: now }]);
  assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/topic', oid: w.t2 }, new: { branch: 'refs/heads/topic', oid: now } });
  assert.equal(w.repo.git('rev-list', '--count', `${w.main}..topic`), '2');
});

test('continue reaching an edit stop answers stopped (the rebase stays in progress); the next continue finishes', async (t) => {
  const w = await world(t);
  w.repo.checkout('topic');
  // pick topic (conflicts onto main), then edit t2.
  w.user(['-c', 'rebase.backend=merge', 'rebase', '-i', '--onto=main', 'main'], { GIT_SEQUENCE_EDITOR: `printf 'pick ${w.topic}\\nedit ${w.t2}\\n' >` });
  assert.equal(await w.kind(), 'rebase');
  w.resolve('topic\n');
  const r = await w.op('head.continue', { which: 'rebase' });
  assert.deepEqual([r.outcome, await w.kind(), w.oid('REBASE_HEAD')], ['stopped', 'rebase', w.t2]);
  assert.equal((await w.op('head.continue', { which: 'rebase' })).outcome, 'done');
  assert.equal(read(w, 'f.txt'), 't2\n');
});

test('a failing continue never aborts: an empty cherry-pick → NOTHING_TO_COMMIT, a rebase with unstaged changes → DIRTY_WORKTREE; both stay in progress', async (t) => {
  const w = await world(t);
  w.stop('cherry-pick');
  w.resolve('main\n');
  await assert.rejects(w.op('head.continue', { which: 'cherry-pick' }), refused('NOTHING_TO_COMMIT'));
  assert.equal(await w.kind(), 'cherry-pick');
  const x = await world(t);
  x.stop('rebase');
  x.resolve('topic\n');
  x.repo.write('f.txt', 'unstaged edit\n');
  await assert.rejects(x.op('head.continue', { which: 'rebase' }), refused('DIRTY_WORKTREE'));
  assert.equal(await x.kind(), 'rebase');
  assert.equal(read(x, 'f.txt'), 'unstaged edit\n');
});

test('revert and cherry-pick refuse OPERATION_IN_PROGRESS mid-rebase and CONFLICTED with leftover conflicts; nothing runs', async (t) => {
  const w = await world(t);
  w.stop('rebase');
  for (const op of ['head.revert', 'head.cherryPick']) {
    await assert.rejects(w.op(op, { oid: w.base }), refused('OPERATION_IN_PROGRESS', { operation: 'rebase' }), op);
  }
  const x = await world(t);
  x.user(['merge', '--squash', 'topic']);
  await assert.rejects(x.op('head.cherryPick', { oid: x.t2 }), refused('CONFLICTED', { files: ['f.txt'] }));
  assert.equal(x.writes().length, 0);
});
