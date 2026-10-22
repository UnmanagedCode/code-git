import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { REF_LIMITS } from '../src/git/refs/limits.js';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

const onOrigin = (w, ref) => { try { return w.origin.git('rev-parse', '--verify', '-q', ref); } catch { return null; } };

test('create: a blank message makes a lightweight tag, a message an annotated one stored byte for byte (via stdin)', async (t) => {
  const w = await refsWorld(t);
  const light = await w.op('tag.create', { name: 'light', oid: w.base, message: '  \n' });
  assert.equal(w.repo.git('cat-file', '-t', 'refs/tags/light'), 'commit');
  assert.equal(light.oid, w.base);
  const message = '# not a comment\n  spaced  \n<img src=x> no newline';
  const ann = await w.op('tag.create', { name: 'ann', oid: w.base, message });
  assert.equal(w.repo.git('cat-file', '-t', 'refs/tags/ann'), 'tag');
  assert.equal(ann.oid, w.oid('refs/tags/ann'));
  assert.notEqual(ann.oid, w.base);
  const body = w.repo.git('cat-file', 'tag', 'refs/tags/ann');
  assert.ok(body.endsWith(`\n\n${message}`), body);
  assert.deepEqual(ann.undo.refs, [{ ref: 'refs/tags/ann', old: null, new: ann.oid }]);
  const argv = w.argvs().find((a) => a[0] === 'tag' && a.includes('-a'));
  assert.equal(argv.includes(message), false, 'the message never goes in argv');
  endOfOptionsBefore(argv, 'ann');
  await assert.rejects(w.op('tag.create', { name: 'ann', oid: w.base }), refused('REF_EXISTS'));
  await assert.rejects(w.op('tag.create', { name: 'tree', oid: w.oid('HEAD^{tree}') }), refused('REV_UNKNOWN'));
});

test('create params: the message is capped and may not hold NUL', () => {
  const p = (message) => getOp(OPS, 'tag.create').params({ name: 'v', oid: 'a'.repeat(40), message });
  assert.throws(() => p('x'.repeat(REF_LIMITS.tagMessageMaxBytes + 1)), refused('BAD_PARAMS'));
  assert.throws(() => p('a\0b'), refused('BAD_PARAMS'));
  assert.equal(p('x'.repeat(REF_LIMITS.tagMessageMaxBytes)).message.length, REF_LIMITS.tagMessageMaxBytes);
});

test('delete records the tag object, so update-ref brings an annotated tag back with its message; a missing name deletes nothing', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('tag', '-a', 'ann', '-m', 'the annotation', w.base);
  w.repo.git('tag', 'light', w.base);
  const object = w.oid('refs/tags/ann');
  await assert.rejects(w.op('tag.delete', { names: ['ann', 'nope'] }), refused('REF_UNKNOWN'));
  assert.equal(w.exists('refs/tags/ann'), true);
  const r = await w.op('tag.delete', { names: ['ann', 'light'] });
  assert.deepEqual(r.deleted, ['ann', 'light']);
  assert.equal(w.exists('refs/tags/ann'), false);
  assert.deepEqual(r.undo.refs, [{ ref: 'refs/tags/ann', old: object, new: null }, { ref: 'refs/tags/light', old: w.base, new: null }]);
  w.repo.git('update-ref', 'refs/tags/ann', r.undo.refs[0].old);
  assert.match(w.repo.git('cat-file', 'tag', 'ann'), /the annotation/);
});

test('push lands the tag on the remote; a tag that differs there is rejected (PUSH_REJECTED with rejected), never forced', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('tag', '-a', 'v1', '-m', 'one', w.base);
  const r = await w.op('tag.push', { remote: 'origin', names: ['v1'] });
  assert.deepEqual([r.pushed, r.upToDate, r.rejected], [['v1'], [], []]);
  assert.equal(onOrigin(w, 'refs/tags/v1'), w.oid('refs/tags/v1'));
  assert.deepEqual(r.undo.remoteRefs, [{ remote: 'origin', ref: 'refs/tags/v1', old: null, new: w.oid('refs/tags/v1') }]);
  assert.deepEqual((await w.op('tag.push', { remote: 'origin', names: ['v1'] })).upToDate, ['v1']);
  const next = w.repo.commit({ 'n.txt': 'n\n' }, 'n');
  w.repo.git('tag', '-f', 'v1', next);
  await assert.rejects(w.op('tag.push', { remote: 'origin', names: ['v1'] }), refused('PUSH_REJECTED', { rejected: [{ ref: 'refs/tags/v1', reason: 'already exists' }] }));
  assert.notEqual(onOrigin(w, 'refs/tags/v1'), next);
  await assert.rejects(w.op('tag.push', { remote: 'origin', names: ['nope'] }), refused('REF_UNKNOWN'));
  const pushes = w.argvs().filter((a) => a[0] === 'push');
  for (const a of pushes) assert.deepEqual(a.slice(0, 4), ['push', '--porcelain', '--end-of-options', 'origin']);
  assert.ok(pushes.every((a) => !a.some((x) => x.startsWith('+') || x === '--force' || x === '-f')));
});

test('deleteRemote removes the tag from the remote; old is the local tag object', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('tag', '-a', 'v1', '-m', 'one', w.base);
  w.repo.git('push', '-q', 'origin', 'v1');
  const r = await w.op('tag.deleteRemote', { remote: 'origin', names: ['v1'] });
  assert.deepEqual(r.deleted, ['v1']);
  assert.equal(onOrigin(w, 'refs/tags/v1'), null);
  assert.equal(w.exists('refs/tags/v1'), true, 'the local tag stays');
  assert.deepEqual(r.undo.remoteRefs, [{ remote: 'origin', ref: 'refs/tags/v1', old: w.oid('refs/tags/v1'), new: null }]);
});

test('a failing pre-push hook runs and fails the push: GIT_FAILED with the hook\'s stderr', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('tag', 'v1', w.base);
  w.repo.hook('pre-push', '#!/bin/sh\necho "pre-push hook refuses" >&2\nexit 1\n');
  await assert.rejects(w.op('tag.push', { remote: 'origin', names: ['v1'] }), (e) => {
    assert.equal(e.code, 'GIT_FAILED');
    assert.match(e.extra.stderr, /pre-push hook refuses/);
    return true;
  });
  assert.equal(onOrigin(w, 'refs/tags/v1'), null);
  assert.equal(w.argvs().find((a) => a[0] === 'push').includes('--no-verify'), false);
});
