import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { elsewhereSnapshot, ELSEWHERE_FILES, noViolations, opWorld, refused } from './_ops.js';
import { blob, outsideLink, read, runs, stashList, stashWorld, exists } from './_stash.js';

// stash.push against real git under the hostile config.

const gitVersionHook = (version) => (body) => (body.argv.at(-1) === 'version'
  ? { status: 200, body: { exitCode: 0, stdout: Buffer.from(`git version ${version}\n`).toString('base64'), stderr: '', encoding: 'base64', durationMs: 1 } }
  : undefined);

test('push whole: creates a stash with the message and cleans tracked changes', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  w.repo.write('new.txt', 'untracked\n');
  const r = await w.op('stash.push', { message: 'my work' });
  assert.deepEqual(stashList(w), [{ oid: r.oid, message: 'On main: my work' }]);
  assert.equal(r.selector, 'stash@{0}');
  assert.equal(w.repo.git('log', '-1', '--format=%s', r.oid), 'On main: my work');
  assert.equal(blob(w, `${r.oid}:a.txt`), 'a2');
  assert.equal(blob(w, `${r.oid}^2:b.txt`), 'b staged');
  assert.equal(blob(w, `${r.oid}^2:a.txt`), 'a');
  assert.deepEqual(w.status(), { 'new.txt': '??' });
  assert.deepEqual(r.undo, { refs: [], remoteRefs: [], head: null, worktreeSnapshot: null, stashes: [{ oid: r.oid, old: null, new: { message: 'On main: my work' }, restore: 'pop' }], worktreePatch: null, remotes: [] });
  noViolations(w.cc);
});

test('push without a message gets git\'s WIP subject; a blank message counts as none', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  const r = await w.op('stash.push', { message: '   ' });
  assert.match(stashList(w)[0].message, /^WIP on main: [0-9a-f]{7,} base$/);
  assert.ok(!runs(w, 'stash', 'push').some((a) => a.some((x) => x.startsWith('--message'))));
  assert.equal(r.oid, stashList(w)[0].oid);
});

test('push includeUntracked stores U and removes untracked files; keepIndex leaves the index', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  w.repo.write('new.txt', 'untracked\n');
  const r = await w.op('stash.push', { includeUntracked: true, keepIndex: true });
  assert.equal(blob(w, `${r.oid}^3:new.txt`), 'untracked');
  assert.equal(exists(w, 'new.txt'), false);
  assert.equal(read(w, 'a.txt'), 'a\n');
  assert.equal(w.indexBlob('b.txt').toString(), 'b staged\n');
  assert.deepEqual(w.status(), { 'b.txt': 'M ' });
});

test('push keepIndex alone (no paths) stashes everything and leaves the staged changes in place', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  const r = await w.op('stash.push', { keepIndex: true });
  assert.equal(blob(w, `${r.oid}:a.txt`), 'a2');
  assert.equal(blob(w, `${r.oid}:b.txt`), 'b staged');
  assert.equal(read(w, 'a.txt'), 'a\n');
  assert.equal(read(w, 'b.txt'), 'b staged\n');
  assert.deepEqual(w.status(), { 'b.txt': 'M ' });
});

test('push paths stashes only those paths (stdin, never argv)', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('dir/c.txt', 'c2\n');
  w.repo.write('b.txt', 'b2\n');
  const r = await w.op('stash.push', { paths: ['a.txt', 'dir/c.txt'] });
  assert.equal(blob(w, `${r.oid}:a.txt`), 'a2');
  assert.equal(blob(w, `${r.oid}:dir/c.txt`), 'c2');
  assert.equal(blob(w, `${r.oid}:b.txt`), 'b');
  assert.deepEqual(w.status(), { 'b.txt': ' M' });
  const push = runs(w, 'stash', 'push');
  assert.equal(push.length, 1);
  assert.ok(push[0].includes('--pathspec-from-file=-'));
  assert.ok(!push[0].some((a) => a.includes('a.txt') || a.includes('c.txt')));
  assert.equal(w.cc.state.execCalls.find((b) => b.argv === push[0]).stdinB64, Buffer.from('a.txt\0dir/c.txt\0').toString('base64'));
});

test('push staged stashes only the index (--staged)', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  const r = await w.op('stash.push', { staged: true, message: 's' });
  assert.equal(blob(w, `${r.oid}:b.txt`), 'b staged');
  assert.equal(blob(w, `${r.oid}:a.txt`), 'a');
  assert.deepEqual(w.status(), { 'a.txt': ' M' });
  assert.ok(runs(w, 'stash', 'push')[0].includes('--staged'));
});

test('push staged on git 2.34 refuses GIT_TOO_OLD before any write', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  w.cc.state.execHook = gitVersionHook('2.34.1');
  await assert.rejects(w.op('stash.push', { staged: true }), (e) => {
    assert.equal(e.code, 'GIT_TOO_OLD');
    assert.deepEqual({ feature: e.extra.feature, need: e.extra.need, have: e.extra.have }, { feature: 'stash push --staged', need: '2.35', have: '2.34' });
    return true;
  });
  assert.deepEqual(runs(w, 'stash', 'push'), []);
  assert.deepEqual(stashList(w), []);
  w.cc.state.execHook = gitVersionHook('2.35.0');
  await w.op('stash.push', { staged: true });
  assert.equal(stashList(w).length, 1);
});

test('an unparsable git version refuses GIT_TOO_OLD with have null; a newer major passes', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  w.cc.state.execHook = gitVersionHook('banana');
  await assert.rejects(w.op('stash.push', { staged: true }), (e) => e.code === 'GIT_TOO_OLD' && e.extra.have === null);
  w.cc.state.execHook = gitVersionHook('3.0.0');
  await w.op('stash.push', { staged: true });
  assert.equal(stashList(w).length, 1);
});

test('push with nothing to stash → NOTHING_TO_STASH, refs/stash unchanged', async (t) => {
  const w = await stashWorld(t);
  await assert.rejects(w.op('stash.push', {}), refused('NOTHING_TO_STASH'));
  assert.deepEqual(stashList(w), []);
  w.repo.write('a.txt', 'a2\n');
  const first = await w.op('stash.push', {});
  w.repo.write('new.txt', 'u\n');
  await assert.rejects(w.op('stash.push', {}), refused('NOTHING_TO_STASH'));
  assert.deepEqual(stashList(w).map((s) => s.oid), [first.oid]);
});

test('push unborn HEAD → NO_HEAD; unmerged → CONFLICTED', async (t) => {
  const w = await opWorld(t);
  w.repo.write('a.txt', 'a\n');
  await assert.rejects(w.op('stash.push', {}), refused('NO_HEAD'));
  w.repo.commit({ 'f.txt': 'base\n' }, 'base');
  w.repo.branch('side');
  w.repo.commit({ 'f.txt': 'side\n' }, 'side');
  w.repo.checkout('main');
  w.repo.commit({ 'f.txt': 'main\n' }, 'main');
  assert.throws(() => w.repo.git('merge', '-q', 'side'));
  await assert.rejects(w.op('stash.push', {}), refused('CONFLICTED'));
  assert.equal(runs(w, 'stash', 'push').length, 0);
});

test('push paths beyond an untracked symlinked dir → PATH_BLOCKED; the outside dir stays empty', async (t) => {
  const w = await stashWorld(t, { 'a.txt': 'a\n', 'link/x.txt': 'x\n' });
  w.repo.git('rm', '-rq', '--cached', 'link');
  fs.rmSync(path.join(w.repo.dir, 'link'), { recursive: true });
  const outside = outsideLink(w, 'link');
  for (const params of [{ paths: ['link/x.txt'] }, {}]) {
    await assert.rejects(w.op('stash.push', params), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths[0] === 'link');
  }
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(runs(w, 'stash', 'push').length, 0);
});

test('staged + includeUntracked or keepIndex → BAD_PARAMS; bad messages and paths are refused', async (t) => {
  const w = await stashWorld(t);
  for (const p of [
    { staged: true, includeUntracked: true }, { staged: true, keepIndex: true }, { message: 'a\nb' }, { message: 'tab\there' },
    { message: 'x'.repeat(1001) }, { message: 3 }, { keepIndex: 'yes' }, { paths: [] }, { nope: 1 },
  ]) await assert.rejects(w.op('stash.push', p), refused('BAD_PARAMS'), JSON.stringify(p));
  for (const p of [{ paths: ['../x'] }, { paths: ['/abs'] }]) await assert.rejects(w.op('stash.push', p), refused('BAD_PATH'));
  await w.op('stash.push', { message: 'x'.repeat(1000), paths: ['a.txt'] }).catch((e) => assert.equal(e.code, 'NOTHING_TO_STASH'));
});

test('hostile core.worktree: the stash acts on the checkout, elsewhereSnapshot unchanged', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('new.txt', 'u\n');
  const r = await w.op('stash.push', { includeUntracked: true });
  assert.equal(blob(w, `${r.oid}:a.txt`), 'a2');
  assert.equal(read(w, 'a.txt'), 'a\n');
  assert.equal(exists(w, 'new.txt'), false);
  assert.deepEqual(elsewhereSnapshot(w.repo), Object.fromEntries(Object.entries(ELSEWHERE_FILES).sort()));
  noViolations(w.cc);
});

test('a failed --staged save that git had already stored names the stash (oid, selector) and carries no undo: the changes are still in place', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('b.txt', 'b staged\n');
  w.repo.git('add', 'b.txt');
  w.repo.write('b.txt', 'b staged\nand changed again\n');
  await assert.rejects(w.op('stash.push', { staged: true }), (e) => {
    assert.equal(e.code, 'GIT_FAILED');
    const [top] = stashList(w);
    assert.ok(top, 'git stored a stash before failing');
    assert.equal(e.extra.oid, top.oid);
    assert.equal(e.extra.selector, 'stash@{0}');
    assert.equal(e.extra.undo, undefined);
    return true;
  });
  assert.equal(w.indexBlob('b.txt').toString(), 'b staged\n');
  assert.equal(read(w, 'b.txt'), 'b staged\nand changed again\n');
});

test('a failed save that stored nothing stays a plain GIT_FAILED (no oid)', async (t) => {
  const w = await stashWorld(t);
  await assert.rejects(w.op('stash.push', { paths: ['nope.txt'] }), (e) => e.code === 'GIT_FAILED' && e.extra.oid === undefined);
  assert.deepEqual(stashList(w), []);
});

test('a no-op save is told by git\'s output (no -q): another session\'s push meanwhile is not taken for it', async (t) => {
  const w = await stashWorld(t);
  w.cc.state.execHook = (body) => (body.argv.includes('push') ? 'hold' : undefined);
  const saving = w.op('stash.push', {});
  const held = await w.cc.nextHeld();
  w.repo.write('b.txt', 'theirs\n');
  w.repo.git('stash', 'push', '-q', '-m', 'foreign');
  w.cc.state.execHook = null;
  held.release();
  await assert.rejects(saving, refused('NOTHING_TO_STASH'));
  assert.deepEqual(stashList(w).map((s) => s.message), ['On main: foreign']);
  assert.ok(!runs(w, 'stash', 'push')[0].includes('-q'));
});

/** Saves `mine` with a foreign push landing between git's store and the op's read of the list. */
async function racedSave(t, foreignMessage) {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'mine\n');
  w.cc.state.execHook = (body) => (body.argv.includes('stash') && body.argv.includes('list') ? 'hold' : undefined);
  const saving = w.op('stash.push', { message: 'mine' });
  const held = await w.cc.nextHeld();
  w.repo.write('b.txt', 'theirs\n');
  w.repo.git('stash', 'push', '-q', '-m', foreignMessage);
  w.cc.state.execHook = null;
  held.release();
  return { w, r: await saving, foreign: stashList(w)[0].oid };
}

test('a foreign push right after ours: the result and undo name our stash (stash@{1}), never the foreign one', async (t) => {
  const { w, r, foreign } = await racedSave(t, 'foreign');
  const ours = stashList(w)[1];
  assert.equal(ours.message, 'On main: mine');
  assert.deepEqual({ oid: r.oid, selector: r.selector }, { oid: ours.oid, selector: 'stash@{1}' });
  assert.deepEqual(r.undo.stashes.map((s) => s.oid), [ours.oid]);
  assert.notEqual(r.oid, foreign);
});

test('a foreign stash indistinguishable from ours (same base, same subject): unverified, and no undo claims either', async (t) => {
  const { r } = await racedSave(t, 'mine');
  assert.deepEqual({ oid: r.oid, selector: r.selector, unverified: r.unverified, stashes: r.undo.stashes }, { oid: null, selector: null, unverified: true, stashes: [] });
});

test('push of a directory pathspec guards what it expands to: a tracked dir now an untracked symlink → PATH_BLOCKED', async (t) => {
  const w = await stashWorld(t, { 'a.txt': 'a\n', 'link/x.txt': 'x\n' });
  fs.rmSync(path.join(w.repo.dir, 'link'), { recursive: true });
  const outside = outsideLink(w, 'link');
  await assert.rejects(w.op('stash.push', { paths: ['link'] }), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths[0] === 'link');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(runs(w, 'stash', 'push').length, 0);
});

test('a reference-transaction hook printing "No local changes to save" (on git\'s stderr) does not hide a stored stash', async (t) => {
  const w = await stashWorld(t);
  const marker = path.join(w.repo.root, 'hook-ran');
  w.repo.hook('reference-transaction', `#!/bin/sh\necho "No local changes to save"\ntouch '${marker}'\n`);
  w.repo.write('a.txt', 'a2\n');
  const r = await w.op('stash.push', { message: 'hooked' });
  assert.ok(fs.existsSync(marker), 'the hook ran');
  assert.deepEqual(stashList(w).map((s) => s.oid), [r.oid]);
  assert.equal(r.selector, 'stash@{0}');
  assert.equal(r.undo.stashes[0].oid, r.oid);
  assert.equal(read(w, 'a.txt'), 'a\n');
});

test('a pre-push tip dropped by another session before the list is read: unverified, no undo', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('b.txt', 'older\n');
  w.repo.git('stash', 'push', '-q', '-m', 'older');
  w.repo.write('a.txt', 'mine\n');
  w.cc.state.execHook = (body) => (body.argv.includes('stash') && body.argv.includes('list') ? 'hold' : undefined);
  const saving = w.op('stash.push', { message: 'mine' });
  const held = await w.cc.nextHeld();
  w.repo.git('stash', 'drop', '-q', 'stash@{1}');
  w.cc.state.execHook = null;
  held.release();
  const r = await saving;
  assert.deepEqual({ oid: r.oid, unverified: r.unverified, stashes: r.undo.stashes }, { oid: null, unverified: true, stashes: [] });
  assert.deepEqual(stashList(w).map((s) => s.message), ['On main: mine']);
});

