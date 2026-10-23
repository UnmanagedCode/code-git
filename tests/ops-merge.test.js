import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

// merge.start against real git: the three modes, the message per ref kind, the gates and the hostile merge config.

const read = (w, f) => fs.readFileSync(path.join(w.repo.dir, f), 'utf8');
const parents = (w, rev = 'HEAD') => w.repo.git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
const merges = (w) => w.argvs().filter((a) => a.includes('merge') && !a.includes('merge-base'));

/** main: base ← main change (m.txt); feature: base ← feature change (feat.txt); ahead: main ← ahead (a.txt). */
async function world(t) {
  const w = await refsWorld(t);
  w.repo.branch('feature');
  const feature = w.repo.commit({ 'feat.txt': 'feat\n' }, 'feature change');
  w.repo.checkout('main');
  const main = w.repo.commit({ 'm.txt': 'm\n' }, 'main change');
  w.repo.branch('ahead');
  const ahead = w.repo.commit({ 'a.txt': 'a\n' }, 'ahead');
  w.repo.checkout('main');
  const start = (params) => w.op('merge.start', { expect: w.oid('HEAD'), ...params });
  return { ...w, feature, main, ahead, start };
}

test('params: mode ff/noFf/squash, oids full hex, ref a full refname under heads/remotes/tags or null', () => {
  const p = (raw) => getOp(OPS, 'merge.start').params(raw);
  const oid = 'a'.repeat(40);
  for (const bad of [{ oid, expect: oid, mode: 'octopus' }, { oid: 'HEAD', expect: oid, mode: 'ff' }, { oid, expect: oid, mode: 'ff', ref: 'main' },
    { oid, expect: oid, mode: 'ff', ref: 'refs/notes/x' }, { oid, expect: oid, mode: 'ff', ref: 'refs/heads/-x..y' }, { oid, expect: oid, mode: 'ff', extra: 1 }]) {
    assert.throws(() => p(bad), (e) => ['BAD_PARAMS', 'BAD_REF'].includes(e.code), JSON.stringify(bad));
  }
  assert.deepEqual(p({ oid, expect: oid, mode: 'squash' }), { ref: null, oid, mode: 'squash', expect: oid });
});

test('ff: a descendant fast-forwards (no merge commit); a diverged branch gets a merge commit "Merge branch \'feature\'", with the undo', async (t) => {
  const w = await world(t);
  const ff = await w.start({ ref: 'refs/heads/ahead', oid: w.ahead, mode: 'ff' });
  assert.deepEqual([ff.outcome, ff.oid, w.oid('HEAD')], ['fastForward', w.ahead, w.ahead]);
  assert.deepEqual(ff.undo.refs, [{ ref: 'refs/heads/main', old: w.main, new: w.ahead }]);
  const m = await w.start({ ref: 'refs/heads/feature', oid: w.feature, mode: 'ff' });
  assert.equal(m.outcome, 'merged');
  assert.deepEqual(parents(w), [w.ahead, w.feature]);
  assert.equal(w.repo.git('log', '-1', '--format=%s'), "Merge branch 'feature'");
  assert.deepEqual(m.undo.head, { old: { branch: 'refs/heads/main', oid: w.ahead }, new: { branch: 'refs/heads/main', oid: m.oid } });
  const argv = merges(w).at(-1);
  assert.deepEqual(argv.slice(0, 4), ['-c', 'merge.autoStash=false', 'merge', '--ff']);
  assert.ok(argv.includes('--no-stat'));
  endOfOptionsBefore(argv, w.feature);
  assert.equal(argv.at(-1), w.feature);
});

test('noFf: a merge commit even when a fast-forward is possible', async (t) => {
  const w = await world(t);
  const r = await w.start({ ref: 'refs/heads/ahead', oid: w.ahead, mode: 'noFf' });
  assert.equal(r.outcome, 'merged');
  assert.deepEqual(parents(w), [w.main, w.ahead]);
  assert.ok(merges(w).at(-1).includes('--no-ff'));
});

test('squash: the changes staged, HEAD unchanged, no MERGE_HEAD, and SQUASH_MSG as the message (comments stripped)', async (t) => {
  const w = await world(t);
  const r = await w.start({ ref: 'refs/heads/feature', oid: w.feature, mode: 'squash' });
  assert.deepEqual([r.outcome, r.oid, w.oid('HEAD'), w.exists('MERGE_HEAD')], ['squashed', w.main, w.main, false]);
  assert.equal(w.repo.git('diff', '--cached', '--name-only'), 'feat.txt');
  assert.match(r.message, /^Squashed commit of the following:\n\ncommit [0-9a-f]{40}\n/);
  assert.match(r.message, /feature change/);
  assert.deepEqual(r.undo.refs, []);
  assert.ok(!merges(w).at(-1).includes('-m'), 'a squash takes no message');
});

test('upToDate when the commit is HEAD or already in it: nothing runs', async (t) => {
  const w = await world(t);
  for (const oid of [w.main, w.base]) {
    const r = await w.start({ oid, mode: 'noFf' });
    assert.deepEqual([r.outcome, r.oid], ['upToDate', w.main]);
  }
  assert.equal(merges(w).length, 0);
});

test('conflicts leave the merge in progress with the files; a squash\'s leave conflicts with no operation', async (t) => {
  const w = await world(t);
  w.repo.git('checkout', '-q', '-b', 'clash', w.base);
  const clash = w.repo.commit({ 'm.txt': 'clash\n' }, 'clash');
  w.repo.checkout('main');
  const r = await w.start({ ref: 'refs/heads/clash', oid: clash, mode: 'ff' });
  assert.deepEqual([r.outcome, r.files, w.exists('MERGE_HEAD')], ['conflicts', ['m.txt'], true]);
  assert.equal((await w.op('commit.state')).operation.kind, 'merge');
  await w.op('head.abort', { which: 'merge' });
  const s = await w.start({ ref: 'refs/heads/clash', oid: clash, mode: 'squash' });
  assert.deepEqual([s.outcome, s.files, w.exists('MERGE_HEAD')], ['conflicts', ['m.txt'], false]);
  const state = await w.op('commit.state');
  assert.deepEqual([state.operation, state.conflicts.map((c) => c.path)], [null, ['m.txt']]);
});

test('a local change git would overwrite → CHECKOUT_CONFLICT; nothing starts', async (t) => {
  const w = await world(t);
  w.repo.write('feat.txt', 'mine\n');
  await assert.rejects(w.start({ oid: w.feature, mode: 'ff' }), refused('CHECKOUT_CONFLICT', { files: ['feat.txt'] }));
  assert.deepEqual([w.oid('HEAD'), w.exists('MERGE_HEAD'), read(w, 'feat.txt')], [w.main, false, 'mine\n']);
});

test('REF_MOVED for a stale expect or a ref no longer at the oid; OPERATION_IN_PROGRESS mid-merge; NO_HEAD unborn; nothing runs', async (t) => {
  const w = await world(t);
  await assert.rejects(w.op('merge.start', { oid: w.feature, mode: 'ff', expect: w.base }), refused('REF_MOVED'));
  await assert.rejects(w.start({ ref: 'refs/heads/ahead', oid: w.feature, mode: 'ff' }), refused('REF_MOVED'));
  await assert.rejects(w.start({ oid: w.repo.git('rev-parse', 'HEAD^{tree}'), mode: 'ff' }), refused('REV_UNKNOWN'));
  assert.equal(merges(w).length, 0);
  w.repo.git('merge', '-q', '--no-commit', '-s', 'ours', 'feature');
  await assert.rejects(w.start({ oid: w.ahead, mode: 'ff' }), refused('OPERATION_IN_PROGRESS', { operation: 'merge' }));
  w.repo.git('merge', '--abort');
  w.repo.git('checkout', '-q', '--orphan', 'empty');
  await assert.rejects(w.op('merge.start', { oid: w.feature, mode: 'ff', expect: w.main }), refused('NO_HEAD'));
});

test('the message names the ref: a remote-tracking branch, a tag (peeled), or the commit when no ref is given', async (t) => {
  const w = await world(t);
  w.repo.git('update-ref', 'refs/remotes/origin/feature', w.feature);
  w.repo.git('tag', '-a', '-m', 'v', 'v1', w.feature);
  const cases = [['refs/remotes/origin/feature', "Merge remote-tracking branch 'origin/feature'"], ['refs/tags/v1', "Merge tag 'v1'"], [null, `Merge commit '${w.feature.slice(0, 7)}'`]];
  for (const [ref, message] of cases) {
    const before = w.oid('HEAD');
    await w.start({ ref, oid: w.feature, mode: 'noFf' });
    assert.equal(w.repo.git('log', '-1', '--format=%s'), message);
    w.repo.git('reset', '-q', '--hard', before);
  }
});

test('hostile config is overridden: merge.ff=false and =only, merge.autoStash=true (no hidden stash), merge.stat', async (t) => {
  const w = await world(t);
  for (const [k, v] of [['merge.ff', 'only'], ['merge.autoStash', 'true'], ['merge.stat', 'true']]) w.repo.git('config', k, v);
  w.repo.write('untracked.txt', 'u\n');
  assert.equal((await w.start({ oid: w.feature, mode: 'ff' })).outcome, 'merged');
  w.repo.git('config', 'merge.ff', 'false');
  w.repo.git('reset', '-q', '--hard', w.main);
  assert.equal((await w.start({ oid: w.ahead, mode: 'ff' })).outcome, 'fastForward');
  assert.deepEqual(parents(w), [w.main]);
  assert.equal(w.repo.git('stash', 'list'), '');
});

test('a project on another System (docker) merges by {project, worktree} alone', async (t) => {
  const w = await world(t);
  w.cc.state.projects.repo.system = 'docker';
  w.cc.state.projects.repo.remoteId = 'cc-box';
  assert.equal((await w.start({ oid: w.feature, mode: 'ff' })).outcome, 'merged');
  assert.ok(w.cc.state.execCalls.every((b) => b.system === undefined && b.project === 'repo'));
});
