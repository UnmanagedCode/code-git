import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { REF_LIMITS } from '../src/git/refs/limits.js';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

const reject = (name, raw, code) => assert.throws(() => getOp(OPS, name).params(raw), refused(code), `${name} ${JSON.stringify(raw)}`);
const head = (w, dir) => w.repo.git('-C', dir ?? w.repo.dir, 'symbolic-ref', '-q', 'HEAD');
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

// ---------- params ----------

test('params: names pass ref-name rules, HEAD and refs/… are refused, oids are full hex, unknown keys are refused', () => {
  for (const name of ['-x', 'a..b', 'HEAD', 'refs/heads/x', 'a b', '']) reject('branch.create', { name }, 'BAD_REF');
  reject('branch.create', { name: 'ok', from: 'HEAD' }, 'BAD_REF');
  reject('branch.create', { name: 'ok', bogus: 1 }, 'BAD_PARAMS');
  reject('branch.create', { name: 'ok', checkout: 'yes' }, 'BAD_PARAMS');
  reject('branch.checkout', { ref: 'main' }, 'BAD_REF');
  reject('branch.checkout', { ref: 'refs/tags/v1' }, 'BAD_REF');
  reject('branch.checkout', { ref: 'refs/heads/-x' }, 'BAD_REF');
  reject('branch.delete', { names: [] }, 'BAD_PARAMS');
  reject('branch.delete', { names: Array.from({ length: REF_LIMITS.namesMax + 1 }, (_, i) => `b${i}`) }, 'BAD_PARAMS');
  reject('branch.setUpstream', { name: 'main' }, 'BAD_PARAMS');
  reject('branch.setUpstream', { name: 'main', upstream: 'refs/heads/x' }, 'BAD_REF');
  reject('branch.fastForward', { name: 'main', to: 'abc', expect: 'abc' }, 'BAD_REF');
  assert.deepEqual(getOp(OPS, 'branch.delete').params({ names: ['a', 'b', 'a'] }).names, ['a', 'b']);
});

// ---------- create ----------

test('create: from HEAD, from an oid, from a tag\'s commit, without checkout; REF_EXISTS; undo names the created ref', async (t) => {
  const w = await refsWorld(t);
  const second = w.repo.commit({ 'g.txt': 'g\n' }, 'second');
  w.repo.git('tag', '-a', 'ann', '-m', 'm', w.base);
  const r1 = await w.op('branch.create', { name: 'from-head' });
  assert.deepEqual(r1, { ref: 'refs/heads/from-head', oid: second, checkedOut: false, undo: { refs: [{ ref: 'refs/heads/from-head', old: null, new: second }], remoteRefs: [], head: null, worktreeSnapshot: null, stashes: [], worktreePatch: null, remotes: [] } });
  assert.equal(w.oid('from-head'), second);
  await w.op('branch.create', { name: 'from-oid', from: w.base });
  assert.equal(w.oid('from-oid'), w.base);
  await w.op('branch.create', { name: 'from-tag', from: w.oid('ann^{commit}') });
  assert.equal(w.oid('from-tag'), w.base);
  assert.equal(head(w), 'refs/heads/main');
  // No upstream: a branch made from a remote-tracking oid does not track it.
  await w.op('branch.create', { name: 'no-track', from: w.oid('origin/main') });
  assert.throws(() => w.repo.git('config', 'branch.no-track.merge'));
  await assert.rejects(w.op('branch.create', { name: 'from-head' }), refused('REF_EXISTS'));
  await assert.rejects(w.op('branch.create', { name: 'tree', from: w.oid('HEAD^{tree}') }), refused('REV_UNKNOWN'));
  for (const a of w.argvs().filter((x) => x[0] === 'branch')) endOfOptionsBefore(a, a.at(-2));
});

test('create with checkout switches to it and records the HEAD move; an unborn HEAD without from → NO_HEAD', async (t) => {
  const w = await refsWorld(t);
  const r = await w.op('branch.create', { name: 'topic', checkout: true });
  assert.equal(head(w), 'refs/heads/topic');
  assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/main', oid: w.base }, new: { branch: 'refs/heads/topic', oid: w.base } });
  const sw = w.argvs().find((a) => a[0] === 'switch');
  endOfOptionsBefore(sw, w.base);
  w.repo.git('checkout', '-q', '--orphan', 'empty');
  await assert.rejects(w.op('branch.create', { name: 'x' }), refused('NO_HEAD'));
});

test('create with checkout into a conflicting dirty tree creates no branch: CHECKOUT_CONFLICT with the files', async (t) => {
  const w = await refsWorld(t);
  const other = w.repo.commit({ 'f.txt': 'other\n' }, 'other');
  w.repo.git('reset', '-q', '--hard', w.base);
  w.repo.write('f.txt', 'dirty\n');
  await assert.rejects(w.op('branch.create', { name: 'nb', from: other, checkout: true }), refused('CHECKOUT_CONFLICT', { files: ['f.txt'] }));
  assert.equal(w.exists('refs/heads/nb'), false);
  assert.equal(read(w.repo.dir, 'f.txt'), 'dirty\n');
});

// ---------- checkout ----------

test('checkout carries a non-conflicting change, refuses a conflicting one with its files, and is a no-op on HEAD', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'side');
  w.repo.commit({ 'f.txt': 'main2\n' }, 'main2');
  w.repo.write('new.txt', 'untracked\n');
  w.repo.write('f.txt', 'dirty\n');
  await assert.rejects(w.op('branch.checkout', { ref: 'refs/heads/side' }), refused('CHECKOUT_CONFLICT', { files: ['f.txt'] }));
  assert.equal(head(w), 'refs/heads/main');
  w.repo.git('checkout', '-q', 'f.txt');
  const r = await w.op('branch.checkout', { ref: 'refs/heads/side' });
  assert.equal(head(w), 'refs/heads/side');
  assert.equal(read(w.repo.dir, 'new.txt'), 'untracked\n');
  assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/main', oid: w.oid('main') }, new: { branch: 'refs/heads/side', oid: w.base } });
  const before = w.argvs().length;
  const same = await w.op('branch.checkout', { ref: 'refs/heads/side' });
  assert.equal(same.undo.head, null);
  assert.deepEqual(w.argvs().slice(before).filter((a) => a[0] === 'switch'), []);
  await assert.rejects(w.op('branch.checkout', { ref: 'refs/heads/nope' }), refused('REF_UNKNOWN'));
  endOfOptionsBefore(w.argvs().find((a) => a[0] === 'switch'), 'side');
});

test('checkout of a branch checked out in another worktree → BRANCH_CHECKED_OUT with that worktree\'s path', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'busy');
  await assert.rejects(w.op('branch.checkout', { ref: 'refs/heads/busy' }), refused('BRANCH_CHECKED_OUT', { worktree: wt.dir }));
  assert.equal(head(w), 'refs/heads/main');
});

test('checkout of a remote branch creates a local tracking branch; an existing tracking local is fast-forwarded; another local is only switched to', async (t) => {
  const w = await refsWorld(t);
  // origin/feat ahead of nothing local: a new tracking branch.
  w.repo.git('branch', 'tmp');
  w.repo.git('checkout', '-q', 'tmp');
  const f1 = w.repo.commit({ 'feat.txt': '1\n' }, 'feat1');
  w.repo.git('push', '-q', 'origin', 'tmp:feat');
  w.repo.git('checkout', '-q', 'main');
  w.repo.git('branch', '-D', '-q', 'tmp');
  const r = await w.op('branch.checkout', { ref: 'refs/remotes/origin/feat' });
  assert.equal(head(w), 'refs/heads/feat');
  assert.equal(w.oid('feat'), f1);
  assert.equal(w.repo.git('config', 'branch.feat.merge'), 'refs/heads/feat');
  assert.equal(w.repo.git('config', 'branch.feat.remote'), 'origin');
  assert.equal(r.created, true);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/feat', old: null, new: f1 }]);
  // feat moves on at origin; the local twin (tracking it) is behind → switch + fast-forward.
  const f2 = w.repo.commit({ 'feat.txt': '2\n' }, 'feat2');
  w.repo.git('push', '-q', 'origin', 'feat');
  w.repo.git('reset', '-q', '--hard', f1);
  w.repo.git('checkout', '-q', 'main');
  const ff = await w.op('branch.checkout', { ref: 'refs/remotes/origin/feat' });
  assert.equal(head(w), 'refs/heads/feat');
  assert.equal(w.oid('feat'), f2);
  assert.deepEqual({ created: ff.created, localExisted: ff.localExisted, fastForwarded: ff.fastForwarded }, { created: false, localExisted: true, fastForwarded: true });
  assert.deepEqual(ff.undo.refs, [{ ref: 'refs/heads/feat', old: f1, new: f2 }]);
  // A local `feat` tracking nothing: switched to, never moved.
  w.repo.git('checkout', '-q', 'main');
  w.repo.git('branch', '--unset-upstream', 'feat');
  w.repo.git('update-ref', 'refs/heads/feat', f1);
  const other = await w.op('branch.checkout', { ref: 'refs/remotes/origin/feat' });
  assert.equal(head(w), 'refs/heads/feat');
  assert.equal(w.oid('feat'), f1);
  assert.deepEqual({ localExisted: other.localExisted, fastForwarded: other.fastForwarded }, { localExisted: true, fastForwarded: false });
  await assert.rejects(w.op('branch.checkout', { ref: 'refs/remotes/origin/nope' }), refused('REF_UNKNOWN'));
});

// ---------- rename ----------

test('rename: the own HEAD branch moves with HEAD; REF_UNKNOWN / REF_EXISTS; another worktree\'s branch is refused', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'taken');
  const r = await w.op('branch.rename', { name: 'main', newName: 'trunk' });
  assert.equal(head(w), 'refs/heads/trunk');
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/main', old: w.base, new: null }, { ref: 'refs/heads/trunk', old: null, new: w.base }]);
  assert.deepEqual(r.undo.head.new, { branch: 'refs/heads/trunk', oid: w.base });
  await assert.rejects(w.op('branch.rename', { name: 'nope', newName: 'x' }), refused('REF_UNKNOWN'));
  await assert.rejects(w.op('branch.rename', { name: 'trunk', newName: 'taken' }), refused('REF_EXISTS'));
  const wt = w.worktree('wt', 'elsewhere');
  await assert.rejects(w.op('branch.rename', { name: 'elsewhere', newName: 'moved' }), refused('BRANCH_CHECKED_OUT', { worktree: wt.dir }));
  assert.equal(w.exists('refs/heads/elsewhere'), true);
  endOfOptionsBefore(w.argvs().find((a) => a[0] === 'branch' && a[1] === '-m'), 'main');
});

test('rename of a checked-out code-conductor/* branch is refused even in its own checkout; a free one needs ccOwned', async (t) => {
  const w = await refsWorld(t);
  w.worktree('wt', 'code-conductor/wt');
  await assert.rejects(w.op('branch.rename', { name: 'code-conductor/wt', newName: 'x', ccOwned: true }, 'wt'), refused('BRANCH_CHECKED_OUT'));
  await assert.rejects(w.op('branch.rename', { name: 'code-conductor/wt', newName: 'x', ccOwned: true }), refused('BRANCH_CHECKED_OUT'));
  w.repo.git('branch', 'code-conductor/old');
  await assert.rejects(w.op('branch.rename', { name: 'code-conductor/old', newName: 'kept' }), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/old'] }));
  await assert.rejects(w.op('branch.rename', { name: 'main', newName: 'code-conductor/new' }), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/new'] }));
  assert.equal(w.exists('refs/heads/code-conductor/old'), true);
  await w.op('branch.rename', { name: 'code-conductor/old', newName: 'kept', ccOwned: true });
  assert.equal(w.exists('refs/heads/kept'), true);
});

// ---------- cc-owned HEAD moves ----------

test('on a code-conductor/* HEAD, checkout (local, remote) and create+checkout refuse without ccOwned and change nothing, then succeed with it', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  w.repo.git('branch', 'free');
  w.repo.git('push', '-q', 'origin', 'main:remote-only');
  w.repo.git('fetch', '-q', 'origin');
  const attempts = [
    ['branch.checkout', { ref: 'refs/heads/free' }],
    ['branch.checkout', { ref: 'refs/remotes/origin/remote-only' }],
    ['branch.create', { name: 'made', checkout: true }],
  ];
  for (const [name, params] of attempts) {
    const before = w.writes().length;
    await assert.rejects(w.op(name, params, 'wt'), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/wt'], head: true }), name);
    assert.deepEqual(w.writes().slice(before), [], `${name}: no write ran`);
    assert.equal(head(w, wt.dir), 'refs/heads/code-conductor/wt');
  }
  assert.equal(w.exists('refs/heads/made'), false);
  assert.equal(w.exists('refs/heads/remote-only'), false);
  for (const [name, params] of attempts) {
    w.repo.git('-C', wt.dir, 'checkout', '-q', 'code-conductor/wt');
    await w.op(name, { ...params, ccOwned: true }, 'wt');
    assert.notEqual(head(w, wt.dir), 'refs/heads/code-conductor/wt', name);
  }
});

test('on a code-conductor/* HEAD: create without checkout, re-checkout of the same branch and fast-forwarding it need no ccOwned', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  await w.op('branch.create', { name: 'plain' }, 'wt');
  await w.op('branch.checkout', { ref: 'refs/heads/code-conductor/wt' }, 'wt');
  const ahead = w.repo.commit({ 'g.txt': 'g\n' }, 'ahead');
  await w.op('branch.fastForward', { name: 'code-conductor/wt', to: ahead, expect: w.base }, 'wt');
  assert.equal(w.oid('HEAD', wt.dir), ahead);
  assert.equal(read(wt.dir, 'g.txt'), 'g\n');
});

// ---------- delete ----------

test('delete refuses the own HEAD and another worktree\'s branch, and deletes nothing when one name is bad', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'a');
  w.worktree('wt', 'busy');
  await assert.rejects(w.op('branch.delete', { names: ['a', 'main'] }), refused('BRANCH_CHECKED_OUT'));
  await assert.rejects(w.op('branch.delete', { names: ['a', 'busy'] }), refused('BRANCH_CHECKED_OUT'));
  await assert.rejects(w.op('branch.delete', { names: ['a', 'nope'] }), refused('REF_UNKNOWN'));
  w.repo.git('branch', 'code-conductor/old');
  await assert.rejects(w.op('branch.delete', { names: ['a', 'code-conductor/old'] }), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/old'] }));
  assert.equal(w.exists('refs/heads/a'), true);
  assert.deepEqual(w.writes(), []);
  const r = await w.op('branch.delete', { names: ['a', 'code-conductor/old'], ccOwned: true });
  assert.deepEqual(r.deleted, ['a', 'code-conductor/old']);
  endOfOptionsBefore(w.argvs().find((a) => a[0] === 'branch' && a[1] === '-d'), 'a');
});

test('delete -d leaves an unmerged branch (notMerged), force deletes it; undo restores the branch with its upstream', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'merged');
  w.repo.git('checkout', '-q', '-b', 'unmerged');
  const u = w.repo.commit({ 'u.txt': 'u\n' }, 'u');
  w.repo.git('push', '-q', '-u', 'origin', 'unmerged');
  w.repo.git('checkout', '-q', 'main');
  // origin/unmerged contains it, so make the upstream lag to keep it "not fully merged".
  w.repo.git('update-ref', 'refs/remotes/origin/unmerged', w.base);
  const r = await w.op('branch.delete', { names: ['merged', 'unmerged'] });
  assert.deepEqual({ deleted: r.deleted, notMerged: r.notMerged }, { deleted: ['merged'], notMerged: ['unmerged'] });
  assert.equal(w.oid('unmerged'), u);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/merged', old: w.base, new: null, upstream: null }]);
  const f = await w.op('branch.delete', { names: ['unmerged'], force: true });
  assert.deepEqual(f.deleted, ['unmerged']);
  assert.equal(w.exists('refs/heads/unmerged'), false);
  const [rec] = f.undo.refs;
  assert.deepEqual(rec, { ref: 'refs/heads/unmerged', old: u, new: null, upstream: 'refs/remotes/origin/unmerged' });
  w.repo.git('update-ref', rec.ref, rec.old, '');
  w.repo.git('branch', `--set-upstream-to=${rec.upstream}`, 'unmerged');
  assert.equal(w.oid('unmerged'), u);
  assert.equal(w.repo.git('config', 'branch.unmerged.merge'), 'refs/heads/unmerged');
});

// ---------- upstream, tracking ----------

test('setUpstream sets and unsets, returning the previous upstream; an unknown upstream → REF_UNKNOWN', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'topic');
  const set = await w.op('branch.setUpstream', { name: 'topic', upstream: 'refs/remotes/origin/main' });
  assert.deepEqual(set, { name: 'topic', upstream: 'refs/remotes/origin/main', previous: null });
  assert.equal(w.repo.git('rev-parse', '--symbolic-full-name', 'topic@{upstream}'), 'refs/remotes/origin/main');
  const unset = await w.op('branch.setUpstream', { name: 'topic', upstream: null });
  assert.deepEqual(unset, { name: 'topic', upstream: null, previous: 'refs/remotes/origin/main' });
  assert.throws(() => w.repo.git('config', 'branch.topic.merge'));
  await w.op('branch.setUpstream', { name: 'topic', upstream: null });
  await assert.rejects(w.op('branch.setUpstream', { name: 'topic', upstream: 'refs/remotes/origin/nope' }), refused('REF_UNKNOWN'));
  await assert.rejects(w.op('branch.setUpstream', { name: 'nope', upstream: null }), refused('REF_UNKNOWN'));
});

test('tracking counts ahead/behind after commits on both sides, and gone after the upstream is deleted', async (t) => {
  const w = await refsWorld(t);
  w.repo.commit({ 'l1.txt': '1\n' }, 'l1');
  w.repo.commit({ 'l2.txt': '2\n' }, 'l2');
  const clone = w.repo.git('rev-parse', 'HEAD~2');
  w.repo.git('branch', 'gonner');
  w.repo.git('push', '-q', '-u', 'origin', 'gonner');
  // One commit only on origin/main.
  w.repo.git('checkout', '-q', '-b', 'tmp', clone);
  w.repo.commit({ 'r.txt': 'r\n' }, 'r');
  w.repo.git('push', '-q', 'origin', 'tmp:main');
  w.repo.git('fetch', '-q', 'origin');
  w.repo.git('checkout', '-q', 'main');
  w.repo.git('branch', '-D', '-q', 'tmp');
  w.repo.git('push', '-q', 'origin', '--delete', 'gonner');
  const r = await w.op('branch.tracking', {});
  assert.deepEqual(r.remotes, ['origin']);
  assert.deepEqual(r.branches['refs/heads/main'], { upstream: 'refs/remotes/origin/main', ahead: 2, behind: 1, gone: false });
  assert.deepEqual(r.branches['refs/heads/gonner'], { upstream: 'refs/remotes/origin/gonner', ahead: 0, behind: 0, gone: true });
});

// ---------- fast-forward, move ----------

test('fastForward: a free branch moves by CAS; not an ancestor → NOT_FAST_FORWARD; stale expect → REF_MOVED; other worktree refused', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'behind');
  const ahead = w.repo.commit({ 'a.txt': 'a\n' }, 'ahead');
  const r = await w.op('branch.fastForward', { name: 'behind', to: ahead, expect: w.base });
  assert.equal(w.oid('behind'), ahead);
  assert.deepEqual(r, { upToDate: false, undo: { refs: [{ ref: 'refs/heads/behind', old: w.base, new: ahead }], remoteRefs: [], head: null, worktreeSnapshot: null, stashes: [], worktreePatch: null, remotes: [] } });
  assert.equal((await w.op('branch.fastForward', { name: 'behind', to: ahead, expect: ahead })).upToDate, true);
  w.repo.git('checkout', '-q', '-b', 'diverged', w.base);
  const d = w.repo.commit({ 'd.txt': 'd\n' }, 'd');
  w.repo.git('checkout', '-q', 'main');
  await assert.rejects(w.op('branch.fastForward', { name: 'behind', to: d, expect: ahead }), refused('NOT_FAST_FORWARD'));
  await assert.rejects(w.op('branch.fastForward', { name: 'diverged', to: ahead, expect: w.base }), refused('REF_MOVED'));
  assert.equal(w.oid('diverged'), d);
  w.worktree('wt', 'busy', w.base);
  await assert.rejects(w.op('branch.fastForward', { name: 'busy', to: ahead, expect: w.base }), refused('BRANCH_CHECKED_OUT'));
});

test('fastForward of the own HEAD branch updates the worktree; a conflicting local change → CHECKOUT_CONFLICT', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'next');
  w.repo.git('checkout', '-q', 'next');
  const ahead = w.repo.commit({ 'f.txt': 'next\n' }, 'next');
  w.repo.git('checkout', '-q', 'main');
  w.repo.write('f.txt', 'dirty\n');
  await assert.rejects(w.op('branch.fastForward', { name: 'main', to: ahead, expect: w.base }), refused('CHECKOUT_CONFLICT', { files: ['f.txt'] }));
  assert.equal(w.oid('main'), w.base);
  w.repo.git('checkout', '-q', 'f.txt');
  const r = await w.op('branch.fastForward', { name: 'main', to: ahead, expect: w.base });
  assert.equal(read(w.repo.dir, 'f.txt'), 'next\n');
  assert.deepEqual(r.undo.head, { old: { branch: 'refs/heads/main', oid: w.base }, new: { branch: 'refs/heads/main', oid: ahead } });
});

test('move (force-move) is refused for the own HEAD and another worktree\'s branch, respects CAS, and needs ccOwned for a cc branch', async (t) => {
  const w = await refsWorld(t);
  const ahead = w.repo.commit({ 'a.txt': 'a\n' }, 'ahead');
  w.repo.git('branch', 'free', ahead);
  await assert.rejects(w.op('branch.move', { name: 'main', to: w.base, expect: ahead }), refused('BRANCH_CHECKED_OUT'));
  w.worktree('wt', 'busy');
  await assert.rejects(w.op('branch.move', { name: 'busy', to: w.base, expect: ahead }), refused('BRANCH_CHECKED_OUT'));
  await assert.rejects(w.op('branch.move', { name: 'free', to: w.base, expect: w.base }), refused('REF_MOVED'));
  const r = await w.op('branch.move', { name: 'free', to: w.base, expect: ahead });
  assert.equal(w.oid('free'), w.base);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/free', old: ahead, new: w.base }]);
  w.repo.git('branch', 'code-conductor/old', ahead);
  await assert.rejects(w.op('branch.move', { name: 'code-conductor/old', to: w.base, expect: ahead }), refused('CC_OWNED_BRANCH'));
  assert.equal(w.oid('code-conductor/old'), ahead);
  await w.op('branch.move', { name: 'code-conductor/old', to: w.base, expect: ahead, ccOwned: true });
  assert.equal(w.oid('code-conductor/old'), w.base);
});

test('checkout of a remote branch whose tracking local cannot fast-forward over a local change: switched, ffBlocked names the files', async (t) => {
  const w = await refsWorld(t);
  w.repo.commit({ 'shared.txt': 'one\n' }, 'shared');
  w.repo.git('push', '-q', 'origin', 'main');
  w.repo.git('checkout', '-q', '-b', 'feat');
  w.repo.git('push', '-q', '-u', 'origin', 'feat');
  const f1 = w.oid('feat');
  const f2 = w.repo.commit({ 'shared.txt': 'two\n' }, 'two');
  w.repo.git('push', '-q', 'origin', 'feat');
  w.repo.git('reset', '-q', '--hard', f1);
  w.repo.git('checkout', '-q', 'main');
  w.repo.write('shared.txt', 'dirty\n');
  const r = await w.op('branch.checkout', { ref: 'refs/remotes/origin/feat' });
  assert.equal(head(w), 'refs/heads/feat');
  assert.equal(w.oid('feat'), f1);
  assert.deepEqual({ fastForwarded: r.fastForwarded, ffBlocked: r.ffBlocked }, { fastForwarded: false, ffBlocked: ['shared.txt'] });
  assert.deepEqual(r.undo.refs, []);
  assert.equal(read(w.repo.dir, 'shared.txt'), 'dirty\n');
  assert.notEqual(f1, f2);
});

// ---------- symbolic refs ----------

/** `alias` → code-conductor/wt, checked out in cc worktree wt; `ahead` a commit past it on main. */
async function aliasWorld(t) {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  const ahead = w.repo.commit({ 'a.txt': 'a\n' }, 'ahead');
  w.repo.git('symbolic-ref', 'refs/heads/alias', 'refs/heads/code-conductor/wt');
  const unchanged = () => {
    assert.equal(w.oid('refs/heads/code-conductor/wt'), w.base, 'code-conductor/wt did not move');
    assert.equal(w.repo.git('symbolic-ref', 'refs/heads/alias'), 'refs/heads/code-conductor/wt', 'alias is still a symbolic ref');
    assert.equal(w.repo.git('-C', wt.dir, 'symbolic-ref', 'HEAD'), 'refs/heads/code-conductor/wt');
    assert.equal(head(w), 'refs/heads/main');
  };
  return { ...w, wt, ahead, unchanged };
}

test('a symbolic ref as the subject of checkout, rename, fast-forward, move or setUpstream → SYMBOLIC_REF, nothing written', async (t) => {
  const w = await aliasWorld(t);
  const attempts = [
    ['branch.checkout', { ref: 'refs/heads/alias', ccOwned: true }],
    ['branch.rename', { name: 'alias', newName: 'renamed', ccOwned: true }],
    ['branch.fastForward', { name: 'alias', to: w.ahead, expect: w.base }],
    ['branch.move', { name: 'alias', to: w.ahead, expect: w.base, ccOwned: true }],
    ['branch.setUpstream', { name: 'alias', upstream: 'refs/remotes/origin/main' }],
  ];
  for (const [name, params] of attempts) {
    await assert.rejects(w.op(name, params), refused('SYMBOLIC_REF', { target: 'refs/heads/code-conductor/wt' }), name);
    w.unchanged();
  }
  assert.deepEqual(w.writes(), []);
  assert.throws(() => w.repo.git('config', 'branch.code-conductor/wt.merge'));
});

test('checkout of a symbolic remote ref (refs/remotes/origin/HEAD) → SYMBOLIC_REF, no branch created', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('remote', 'set-head', 'origin', 'main');
  await assert.rejects(w.op('branch.checkout', { ref: 'refs/remotes/origin/HEAD' }), refused('SYMBOLIC_REF', { target: 'refs/remotes/origin/main' }));
  assert.equal(w.exists('refs/heads/HEAD'), false);
  assert.deepEqual(w.writes(), []);
});

test('deleting a symbolic ref deletes only it; its undo names the alias and its target, never the target\'s oid', async (t) => {
  const w = await aliasWorld(t);
  const r = await w.op('branch.delete', { names: ['alias'] });
  assert.deepEqual(r.deleted, ['alias']);
  assert.equal(w.exists('refs/heads/alias'), false);
  assert.equal(w.oid('refs/heads/code-conductor/wt'), w.base);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/heads/alias', old: null, new: null, symref: 'refs/heads/code-conductor/wt' }]);
});

test('every update-ref passes --no-deref', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'free');
  const ahead = w.repo.commit({ 'a.txt': 'a\n' }, 'ahead');
  await w.op('branch.fastForward', { name: 'free', to: ahead, expect: w.base });
  await w.op('branch.move', { name: 'free', to: w.base, expect: ahead });
  const updates = w.argvs().filter((a) => a[0] === 'update-ref');
  assert.equal(updates.length, 2);
  for (const a of updates) assert.equal(a[1], '--no-deref');
});

test('on a code-conductor/* HEAD, checking out its own remote twin only fast-forwards it and needs no ccOwned', async (t) => {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  const tip = w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD');
  w.repo.write('../wt/w.txt', 'w\n');
  w.repo.git('-C', wt.dir, 'add', 'w.txt');
  w.repo.git('-C', wt.dir, 'commit', '-q', '-m', 'agent');
  const agent = w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD');
  w.repo.git('-C', wt.dir, 'push', '-q', '-u', 'origin', 'code-conductor/wt');
  w.repo.git('-C', wt.dir, 'reset', '-q', '--hard', tip);
  const r = await w.op('branch.checkout', { ref: 'refs/remotes/origin/code-conductor/wt' }, 'wt');
  assert.deepEqual({ created: r.created, fastForwarded: r.fastForwarded }, { created: false, fastForwarded: true });
  assert.equal(head(w, wt.dir), 'refs/heads/code-conductor/wt');
  assert.equal(w.repo.git('-C', wt.dir, 'rev-parse', 'HEAD'), agent);
  assert.equal(r.undo.head.old.branch, 'refs/heads/code-conductor/wt');
});

test('a dangling symbolic ref (invisible to for-each-ref) refuses create, create+checkout, tag.create, rename and delete; no ref is written anywhere', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'plain');
  w.repo.git('symbolic-ref', 'refs/heads/a', 'refs/tags/t');
  w.repo.git('symbolic-ref', 'refs/tags/ta', 'refs/heads/x');
  const allRefs = () => w.repo.git('for-each-ref', '--format=%(refname) %(objectname)');
  const before = allRefs();
  const attempts = [
    ['branch.create', { name: 'a' }, 'refs/tags/t'],
    ['branch.create', { name: 'a', checkout: true }, 'refs/tags/t'],
    ['tag.create', { name: 'ta', oid: w.base }, 'refs/heads/x'],
    ['branch.rename', { name: 'plain', newName: 'a' }, 'refs/tags/t'],
    ['branch.rename', { name: 'a', newName: 'renamed' }, 'refs/tags/t'],
    ['branch.delete', { names: ['a'] }, 'refs/tags/t'],
  ];
  for (const [name, params, target] of attempts) {
    await assert.rejects(w.op(name, params), refused('SYMBOLIC_REF', { target }), `${name} ${JSON.stringify(params)}`);
  }
  assert.equal(allRefs(), before, 'no ref created, renamed or deleted in any namespace');
  assert.equal(w.exists('refs/tags/t'), false);
  assert.equal(w.exists('refs/heads/x'), false);
  assert.equal(w.repo.git('symbolic-ref', 'refs/heads/a'), 'refs/tags/t');
  assert.equal(w.repo.git('symbolic-ref', 'refs/tags/ta'), 'refs/heads/x');
  assert.equal(head(w), 'refs/heads/main');
  assert.deepEqual(w.writes(), []);
});

test('checkout of a remote branch whose local twin is a symbolic ref → SYMBOLIC_REF with its target, nothing written', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'target');
  w.repo.git('symbolic-ref', 'refs/heads/alias', 'refs/heads/target');
  w.repo.git('push', '-q', 'origin', 'target:alias');
  w.repo.git('fetch', '-q', 'origin');
  await assert.rejects(w.op('branch.checkout', { ref: 'refs/remotes/origin/alias' }), refused('SYMBOLIC_REF', { target: 'refs/heads/target' }));
  assert.equal(head(w), 'refs/heads/main');
  assert.equal(w.repo.git('symbolic-ref', 'refs/heads/alias'), 'refs/heads/target');
  assert.deepEqual(w.writes(), []);
});
