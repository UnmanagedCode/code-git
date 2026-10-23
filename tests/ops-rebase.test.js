import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { REBASE } from '../src/git/remote/integrate.js';
import { hermeticEnv } from './_git.js';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

// rebase.start against real git: onto a branch, N commits onto another, the stop rule, the gates and hostile config.

const read = (w, f) => fs.readFileSync(path.join(w.repo.dir, f), 'utf8');
const subjects = (w, range) => w.repo.git('log', '--format=%s', range).split('\n').filter(Boolean);
const rebases = (w) => w.argvs().filter((a) => a.includes('rebase') && !a.includes('--abort'));
const gitVersionHook = (version) => (body) => (body.argv.at(-1) === 'version'
  ? { status: 200, body: { exitCode: 0, stdout: Buffer.from(`git version ${version}\n`).toString('base64'), stderr: '', encoding: 'base64', durationMs: 1 } }
  : undefined);

/** main: base ← m1 (m.txt); topic: base ← t1 ← t2 ← t3 (t1.txt … t3.txt), checked out. */
async function world(t) {
  const w = await refsWorld(t);
  w.repo.branch('topic');
  const [t1, t2, t3] = ['t1', 't2', 't3'].map((n) => w.repo.commit({ [`${n}.txt`]: `${n}\n` }, n));
  w.repo.checkout('main');
  const m1 = w.repo.commit({ 'm.txt': 'm\n' }, 'm1');
  w.repo.checkout('topic');
  const start = (params) => w.op('rebase.start', { expect: w.oid('HEAD'), ...params });
  return { ...w, t1, t2, t3, m1, start };
}

test('params: onto, upstream and expect are full oids; ccOwned a boolean; nothing else', () => {
  const p = (raw) => getOp(OPS, 'rebase.start').params(raw);
  const oid = 'a'.repeat(40);
  for (const bad of [{ onto: 'main', upstream: oid, expect: oid }, { onto: oid, upstream: oid, expect: oid, ccOwned: 'yes' }, { onto: oid, upstream: oid, expect: oid, interactive: true }]) {
    assert.throws(() => p(bad), (e) => ['BAD_PARAMS', 'BAD_REF'].includes(e.code), JSON.stringify(bad));
  }
});

test('onto a branch: the branch\'s commits replayed on it (linear, content kept), done with the branch\'s undo; REBASE\'s pins on the command', async (t) => {
  const w = await world(t);
  const r = await w.start({ onto: w.m1, upstream: w.m1 });
  assert.equal(r.outcome, 'done');
  assert.deepEqual(subjects(w, `${w.m1}..topic`), ['t3', 't2', 't1']);
  assert.deepEqual([w.repo.git('symbolic-ref', 'HEAD'), read(w, 'm.txt'), r.oid], ['refs/heads/topic', 'm\n', w.oid('topic')]);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/topic', old: w.t3, new: r.oid }]);
  assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/topic', oid: w.t3 }, new: { branch: 'refs/heads/topic', oid: r.oid } });
  const argv = rebases(w).at(-1);
  assert.deepEqual(argv.slice(0, REBASE.length), REBASE);
  assert.ok(argv.includes(`--onto=${w.m1}`));
  endOfOptionsBefore(argv, w.m1);
  assert.equal(argv.at(-1), w.m1);
});

test('N commits onto a branch: upstream = the oldest\'s parent, so only those commits move (t1 is left out)', async (t) => {
  const w = await world(t);
  const r = await w.start({ onto: w.m1, upstream: w.t1 });
  assert.equal(r.outcome, 'done');
  assert.deepEqual(subjects(w, `${w.m1}..topic`), ['t3', 't2']);
  assert.equal(fs.existsSync(path.join(w.repo.dir, 't1.txt')), false);
});

test('upToDate when nothing would move (already on onto): HEAD unchanged, nothing in progress', async (t) => {
  const w = await world(t);
  const r = await w.start({ onto: w.base, upstream: w.base });
  assert.deepEqual([r.outcome, r.oid, w.oid('HEAD')], ['upToDate', w.t3, w.t3]);
  assert.equal((await w.op('commit.state')).operation, null);
});

test('conflicts leave the rebase in progress (commit.state reports it) with the files; head.continue finishes it', async (t) => {
  const w = await world(t);
  w.repo.checkout('main');
  const clash = w.repo.commit({ 't2.txt': 'main\n' }, 'clash');
  w.repo.checkout('topic');
  const r = await w.start({ onto: clash, upstream: clash });
  assert.deepEqual([r.outcome, r.files], ['conflicts', ['t2.txt']]);
  const s = await w.op('commit.state');
  assert.deepEqual([s.operation.kind, s.operation.rebase.branch, s.operation.rebase.step, s.operation.rebase.total], ['rebase', 'refs/heads/topic', 2, 3]);
  w.repo.write('t2.txt', 't2\n');
  w.repo.git('add', 't2.txt');
  const c = await w.op('head.continue', { which: 'rebase' });
  assert.equal(c.outcome, 'done');
  assert.deepEqual(c.undo.refs, [{ ref: 'refs/heads/topic', old: w.t3, new: w.oid('topic') }]);
});

test('HAS_MERGES (a merge commit in upstream..HEAD), DIRTY_WORKTREE (a tracked change), REF_MOVED (stale expect): nothing runs', async (t) => {
  const w = await world(t);
  await assert.rejects(w.op('rebase.start', { onto: w.m1, upstream: w.m1, expect: w.t2 }), refused('REF_MOVED'));
  w.repo.write('t1.txt', 'dirty\n');
  await assert.rejects(w.start({ onto: w.m1, upstream: w.m1 }), refused('DIRTY_WORKTREE'));
  w.repo.git('checkout', '-q', 't1.txt');
  w.repo.write('untracked.txt', 'fine\n');
  w.repo.git('merge', '-q', '--no-ff', '-m', 'merge main', 'main');
  await assert.rejects(w.start({ onto: w.m1, upstream: w.base }), refused('HAS_MERGES'));
  assert.equal(rebases(w).length, 0);
});

test('a code-conductor/* HEAD refuses CC_OWNED_BRANCH (head: true) without ccOwned and rebases with it', async (t) => {
  const w = await world(t);
  w.repo.checkout('main');
  const wt = w.worktree('wt', 'code-conductor/wt', w.t3);
  await assert.rejects(w.op('rebase.start', { onto: w.m1, upstream: w.m1, expect: w.t3 }, 'wt'), refused('CC_OWNED_BRANCH', { head: true, branches: ['code-conductor/wt'] }));
  assert.equal(rebases(w).length, 0);
  assert.equal((await w.op('rebase.start', { onto: w.m1, upstream: w.m1, expect: w.t3, ccOwned: true }, 'wt')).outcome, 'done');
  assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD~3'), w.m1);
});

test('hostile config: rebase.updateRefs=true moves no other branch, rebase.backend=apply is overridden (state in rebase-merge/)', async (t) => {
  const w = await world(t);
  w.repo.git('branch', 'pinned', w.t2);
  for (const [k, v] of [['rebase.updateRefs', 'true'], ['rebase.backend', 'apply'], ['rebase.autoStash', 'true'], ['rebase.rebaseMerges', 'true']]) w.repo.git('config', k, v);
  assert.equal((await w.start({ onto: w.m1, upstream: w.m1 })).outcome, 'done');
  assert.equal(w.oid('pinned'), w.t2, 'rebase.updateRefs moved no other branch');
  w.repo.checkout('main');
  const clash = w.repo.commit({ 't3.txt': 'main\n' }, 'clash');
  w.repo.checkout('topic');
  assert.equal((await w.start({ onto: clash, upstream: clash })).outcome, 'conflicts');
  assert.deepEqual([fs.existsSync(path.join(w.repo.dir, '.git', 'rebase-merge')), fs.existsSync(path.join(w.repo.dir, '.git', 'rebase-apply'))], [true, false]);
});

test('git below 2.26 refuses GIT_TOO_OLD before anything else runs', async (t) => {
  const w = await world(t);
  w.cc.state.execHook = gitVersionHook('2.25.4');
  await assert.rejects(w.start({ onto: w.m1, upstream: w.m1 }), refused('GIT_TOO_OLD', { feature: 'rebase', need: '2.26', have: '2.25' }));
  assert.equal(rebases(w).length, 0);
});

test('a rebase start refuses OPERATION_IN_PROGRESS while another is stopped', async (t) => {
  const w = await world(t);
  w.repo.checkout('main');
  w.repo.git('merge', '-q', '--no-commit', '-s', 'ours', 'topic');
  await assert.rejects(w.op('rebase.start', { onto: w.base, upstream: w.base, expect: w.m1 }), refused('OPERATION_IN_PROGRESS', { operation: 'merge' }));
});

// ---- rebase.plan and rebase.interactive ----

const log = (w, range) => w.repo.git('log', '--format=%s', range).split('\n').filter(Boolean);
const decodeStdin = (b) => (b.stdinB64 === undefined ? '' : Buffer.from(b.stdinB64, 'base64').toString('utf8'));
const interactiveCalls = (w) => w.cc.state.execCalls.filter((b) => b.argv.includes('-i') && b.argv.includes('rebase'));
const msg = (summary, description = '') => ({ summary, description });

/** topic: base ← t1 ← t2 (by Ada, 2020-02-01) ← t3, checked out; main: base ← m1. */
async function iworld(t) {
  const w = await world(t);
  // Rewrite t2 with its own author and date so a reword's carrier can be checked to keep them.
  w.repo.git('reset', '-q', '--hard', w.t1);
  w.repo.write('t2.txt', 't2\n');
  w.repo.git('add', 't2.txt');
  w.repo.git('commit', '-q', '--author=Ada Lovelace <ada@example.com>', '--date=2020-02-01T10:00:00+01:00', '-m', 't2', '-m', 'body of t2');
  const t2 = w.oid('HEAD');
  const t3 = w.repo.commit({ 't3.txt': 't3\n' }, 't3');
  const ir = (rows, over = {}) => w.op('rebase.interactive', { mode: 'rebase', base: w.base, onto: w.base, expect: w.oid('HEAD'), rows, ...over });
  return { ...w, t2, t3, ir };
}

test('rebase.plan lists base..head oldest first with parents, summary, description and author; oids keep the given order', async (t) => {
  const w = await iworld(t);
  const { commits } = await w.op('rebase.plan', { base: w.base, head: w.t3 });
  assert.deepEqual(commits.map((c) => [c.oid, c.summary]), [[w.t1, 't1'], [w.t2, 't2'], [w.t3, 't3']]);
  assert.deepEqual(commits[1].parents, [w.t1]);
  assert.equal(commits[1].description, 'body of t2');
  assert.deepEqual(commits[1].author, { name: 'Ada Lovelace', email: 'ada@example.com', time: 1580547600 });
  const picked = await w.op('rebase.plan', { oids: [w.t3, w.t1] });
  assert.deepEqual(picked.commits.map((c) => c.oid), [w.t3, w.t1]);
  await assert.rejects(w.op('rebase.plan', { oids: [w.repo.git('rev-parse', 'HEAD^{tree}')] }), refused('REV_UNKNOWN'));
});

test('rebase.plan refuses TOO_MANY_COMMITS past the cap (count and max) and HAS_MERGES for a merge', async (t) => {
  const w = await iworld(t);
  const max = 300;
  assert.throws(() => getOp(OPS, 'rebase.plan').params({ oids: Array.from({ length: max + 1 }, (_, i) => i.toString(16).padStart(40, '0')) }), refused('TOO_MANY_COMMITS', { count: max + 1, max }));
  // max + 1 empty commits on top of t3, through fast-import.
  const stream = Array.from({ length: max + 1 }, (_, i) => `commit refs/heads/long\ncommitter T <t@example.com> 0 +0000\ndata 2\nc\n${i === 0 ? `from ${w.t3}\n` : ''}\n`).join('');
  execFileSync('git', ['-C', w.repo.dir, 'fast-import', '--quiet'], { input: stream, env: hermeticEnv(w.repo.home) });
  await assert.rejects(w.op('rebase.plan', { base: w.base, head: w.oid('long') }), refused('TOO_MANY_COMMITS', { count: max + 4, max }));
  w.repo.git('merge', '-q', '--no-ff', '-m', 'merge main', 'main');
  await assert.rejects(w.op('rebase.plan', { base: w.base, head: w.oid('HEAD') }), refused('HAS_MERGES'));
});

test('interactive: reorder and drop give exactly the rows\' history; the drop is explicit (rebase.missingCommitsCheck=error passes)', async (t) => {
  const w = await iworld(t);
  w.repo.git('config', 'rebase.missingCommitsCheck', 'error');
  const r = await w.ir([{ oid: w.t3, action: 'pick' }, { oid: w.t2, action: 'drop' }, { oid: w.t1, action: 'pick' }]);
  assert.equal(r.outcome, 'done');
  assert.deepEqual(log(w, `${w.base}..topic`), ['t1', 't3']);
  assert.equal(fs.existsSync(path.join(w.repo.dir, 't2.txt')), false);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/topic', old: w.t3, new: w.oid('topic') }]);
});

test('interactive: a reword carries the new message and keeps the author name, email and date', async (t) => {
  const w = await iworld(t);
  await w.ir([{ oid: w.t1, action: 'pick' }, { oid: w.t2, action: 'reword', message: msg('t2 reworded', 'why') }, { oid: w.t3, action: 'pick' }]);
  assert.deepEqual(log(w, `${w.base}..topic`), ['t3', 't2 reworded', 't1']);
  assert.equal(w.repo.git('log', '-1', '--format=%an|%ae|%ad|%B', '--date=raw', 'topic~1'), 'Ada Lovelace|ada@example.com|1580547600 +0100|t2 reworded\n\nwhy');
  assert.equal(w.oid('topic~2'), w.t1, 'the unchanged pick before it is kept as is');
});

test('interactive: squash melds into the commit above with the chosen message; fixup keeps the head\'s message', async (t) => {
  const w = await iworld(t);
  await w.ir([{ oid: w.t1, action: 'pick', message: msg('t1 and t2') }, { oid: w.t2, action: 'squash' }, { oid: w.t3, action: 'fixup' }]);
  assert.deepEqual(log(w, `${w.base}..topic`), ['t1 and t2']);
  assert.deepEqual(w.repo.git('ls-tree', '--name-only', 'topic').split('\n').filter((f) => f.startsWith('t')), ['t1.txt', 't2.txt', 't3.txt']);
});

test('interactive: edit stops (stopped, the done list as sent); head.continue finishes', async (t) => {
  const w = await iworld(t);
  const r = await w.ir([{ oid: w.t1, action: 'pick' }, { oid: w.t2, action: 'edit' }, { oid: w.t3, action: 'pick' }]);
  assert.equal(r.outcome, 'stopped');
  assert.equal(fs.readFileSync(path.join(w.repo.dir, '.git', 'rebase-merge', 'done'), 'utf8'), `pick ${w.t1}\nedit ${w.t2}\n`);
  assert.equal((await w.op('commit.state')).operation.kind, 'rebase');
  const c = await w.op('head.continue', { which: 'rebase' });
  assert.equal(c.outcome, 'done');
  assert.deepEqual(log(w, `${w.base}..topic`), ['t3', 't2', 't1']);
});

test('pick mode: the rows cherry-picked onto HEAD in order (base = onto = expect = HEAD), no cc acknowledgement needed', async (t) => {
  const w = await iworld(t);
  w.repo.checkout('main');
  const wt = w.worktree('wt', 'code-conductor/wt', w.m1);
  const r = await w.op('rebase.interactive', { mode: 'pick', base: w.m1, onto: w.m1, expect: w.m1, rows: [{ oid: w.t3, action: 'pick' }, { oid: w.t1, action: 'pick' }] }, 'wt');
  assert.equal(r.outcome, 'done');
  assert.deepEqual(w.repo.git('-C', wt.dir, 'log', '--format=%s', `${w.m1}..HEAD`).split('\n'), ['t1', 't3']);
  assert.throws(() => getOp(OPS, 'rebase.interactive').params({ mode: 'pick', base: w.base, onto: w.m1, expect: w.m1, rows: [{ oid: w.t1, action: 'pick' }] }), refused('BAD_PARAMS'));
});

test('squash N commits (rebase mode from the oldest\'s parent): the selected run becomes one commit, the newer ones are replayed on it', async (t) => {
  const w = await iworld(t);
  const r = await w.op('rebase.interactive', {
    mode: 'rebase', base: w.base, onto: w.base, expect: w.t3,
    rows: [{ oid: w.t1, action: 'pick', message: msg('t1+t2', 't1\n\nt2') }, { oid: w.t2, action: 'squash' }, { oid: w.t3, action: 'pick' }],
  });
  assert.equal(r.outcome, 'done');
  assert.deepEqual(log(w, `${w.base}..topic`), ['t3', 't1+t2']);
  assert.equal(w.repo.git('log', '-1', '--format=%B', 'topic~1'), 't1+t2\n\nt1\n\nt2');
});

test('no user data in argv or env: the editor is exactly "cat >", the todo goes on stdin, messages only on carriers\' stdin', async (t) => {
  const w = await iworld(t);
  const secret = 'Reworded $(touch /tmp/x) `id`';
  await w.ir([{ oid: w.t1, action: 'pick' }, { oid: w.t2, action: 'reword', message: msg(secret) }, { oid: w.t3, action: 'drop' }]);
  const [call] = interactiveCalls(w);
  assert.equal(call.env.GIT_SEQUENCE_EDITOR, 'cat >');
  const carrier = w.oid('topic');
  assert.equal(decodeStdin(call), `pick ${w.t1}\npick ${carrier}\ndrop ${w.t3}\n`);
  for (const b of w.cc.state.execCalls) {
    assert.ok(!b.argv.some((a) => a.includes('Reworded')), `argv: ${b.argv.join(' ')}`);
    assert.ok(!Object.values(b.env ?? {}).some((v) => v.includes('Reworded')), 'env');
  }
  const tree = w.cc.state.execCalls.find((b) => b.argv.includes('commit-tree'));
  assert.equal(decodeStdin(tree), `${secret}\n`);
  assert.deepEqual([tree.env.GIT_AUTHOR_NAME, tree.env.GIT_AUTHOR_EMAIL, tree.env.GIT_AUTHOR_DATE], ['Ada Lovelace', 'ada@example.com', '1580547600 +0100']);
});

test('hostile config never runs: sequence.editor and core.editor naming a command leave no marker; rebase.instructionFormat is ignored', async (t) => {
  const w = await iworld(t);
  const marker = path.join(w.repo.root, 'MARKER');
  w.repo.git('config', 'sequence.editor', `touch '${marker}'; false`);
  w.repo.git('config', 'core.editor', `touch '${marker}'; false`);
  w.repo.git('config', 'rebase.instructionFormat', '%s %an');
  const r = await w.ir([{ oid: w.t2, action: 'pick' }, { oid: w.t1, action: 'pick' }, { oid: w.t3, action: 'reword', message: msg('t3!') }]);
  assert.equal(r.outcome, 'done');
  assert.deepEqual(log(w, `${w.base}..topic`), ['t3!', 't1', 't2']);
  assert.equal(fs.existsSync(marker), false);
});

test('rows must be exactly base..HEAD (BAD_PARAMS for one missing, one extra or a duplicate); nothing runs', async (t) => {
  const w = await iworld(t);
  const p = (rows) => w.ir(rows);
  await assert.rejects(p([{ oid: w.t1, action: 'pick' }, { oid: w.t2, action: 'pick' }]), refused('BAD_PARAMS'));
  await assert.rejects(p([{ oid: w.t1, action: 'pick' }, { oid: w.t2, action: 'pick' }, { oid: w.t3, action: 'pick' }, { oid: w.m1, action: 'pick' }]), refused('BAD_PARAMS'));
  assert.throws(() => getOp(OPS, 'rebase.interactive').params({ mode: 'rebase', base: w.base, onto: w.base, expect: w.t3, rows: [{ oid: w.t1, action: 'pick' }, { oid: w.t1, action: 'drop' }] }), refused('BAD_PARAMS'));
  assert.throws(() => getOp(OPS, 'rebase.interactive').params({ mode: 'rebase', base: w.base, onto: w.base, expect: w.t3, rows: [{ oid: w.t1, action: 'pick', note: 1 }] }), refused('BAD_PARAMS'));
  assert.equal(interactiveCalls(w).length, 0);
});

test('commit.gpgSign=true with a signer that fails → GIT_FAILED from the carrier, before any rebase starts', async (t) => {
  const w = await iworld(t);
  w.repo.git('config', 'commit.gpgSign', 'true');
  w.repo.git('config', 'gpg.program', 'false');
  await assert.rejects(w.ir([{ oid: w.t1, action: 'pick' }, { oid: w.t2, action: 'reword', message: msg('x') }, { oid: w.t3, action: 'pick' }]), refused('GIT_FAILED'));
  assert.ok(w.cc.state.execCalls.find((b) => b.argv.includes('commit-tree')).argv.includes('-S'), 'the carrier asked to sign');
  assert.deepEqual([interactiveCalls(w).length, (await w.op('commit.state')).operation, w.oid('topic')], [0, null, w.t3]);
});

test('rebase mode on a code-conductor/* HEAD needs ccOwned', async (t) => {
  const w = await iworld(t);
  w.repo.checkout('main');
  w.worktree('wt', 'code-conductor/wt', w.t3);
  const params = { mode: 'rebase', base: w.base, onto: w.base, expect: w.t3, rows: [{ oid: w.t1, action: 'pick' }, { oid: w.t2, action: 'drop' }, { oid: w.t3, action: 'pick' }] };
  await assert.rejects(w.op('rebase.interactive', params, 'wt'), refused('CC_OWNED_BRANCH', { head: true }));
  assert.equal((await w.op('rebase.interactive', { ...params, ccOwned: true }, 'wt')).outcome, 'done');
});
