import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startApp } from './_app.js';
import { refused, refsWorld } from './_refsWorld.js';
import { undoWorld } from './_undoWorld.js';

// What refuses the undo or redo of a stash or remote-config op, and that each refusal changed nothing. UNDO_STALE clears
// both slots (the entry can never run); any other refusal keeps them.

const EMPTY = { undo: null, redo: null };
const nums = (n) => Array.from({ length: n }, (_, i) => `l${i + 1}`);
const text = (ls) => ls.map((l) => `${l}\n`).join('');

function saved(w, files, args = []) {
  for (const [f, c] of Object.entries(files)) w.repo.write(f, c);
  w.repo.git('stash', 'push', '-q', ...args);
  return w.oid('refs/stash');
}

/** `run()` refuses `code` and the checkout is exactly as it was; resolves the slots after. */
async function refusesUnchanged(w, run, code, extra) {
  const before = w.snap();
  await assert.rejects(run(), refused(code, extra));
  assert.deepEqual(w.snap(), before, `${code}: nothing changed`);
  return w.state();
}

/** A push of a changed f.txt, recorded. */
async function pushed(w) {
  w.repo.write('f.txt', 'stashed\n');
  await w.op('stash.push', {});
}

// Invariant: a push's undo refuses UNDO_STALE once a file it stashed was edited again, and clears the slots.
test('stash.push undo after editing a stashed file: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await pushed(w);
  w.repo.write('f.txt', 'edited since\n');
  assert.deepEqual(await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE'), EMPTY);
});

// Invariant: a push's undo refuses UNDO_STALE after an external `git add` changed the index.
test('stash.push undo after an external git add: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await pushed(w);
  w.repo.write('other.txt', 'added\n');
  w.repo.git('add', 'other.txt');
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: a push's undo refuses UNDO_STALE after an external commit moved HEAD.
test('stash.push undo after an external commit: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await pushed(w);
  w.repo.git('commit', '-q', '--allow-empty', '-m', 'moved');
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: a pop's undo refuses UNDO_STALE once a popped file was edited.
test('stash.pop undo after an edit: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' });
  await w.op('stash.pop', { oid });
  w.repo.write('f.txt', 'edited\n');
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: a pop's redo refuses UNDO_STALE when its stash was dropped externally after the undo stored it back.
test('stash.pop redo after the stash was dropped externally: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' });
  await w.op('stash.pop', { oid });
  await w.undo();
  w.repo.git('stash', 'drop', '-q');
  await refusesUnchanged(w, () => w.redo(), 'UNDO_STALE');
});

// Invariant: a drop's undo refuses UNDO_STALE once gc pruned the dropped stash's commits.
test('stash.drop undo after reflog expire + gc --prune=now: UNDO_STALE (pruned)', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' });
  await w.op('stash.drop', { oid });
  w.repo.git('reflog', 'expire', '--expire=now', '--all');
  w.repo.git('gc', '-q', '--prune=now');
  assert.throws(() => w.repo.git('cat-file', '-e', `${oid}^{commit}`), 'pruned');
  await assert.rejects(w.undo(), (e) => { refused('UNDO_STALE')(e); assert.match(e.message, /pruned/); return true; });
});

// Invariant: a drop's undo refuses UNDO_STALE when the entry is already back on the list.
test('stash.drop undo after it was re-stored: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' }, ['-m', 'mine']);
  await w.op('stash.drop', { oid });
  w.repo.git('stash', 'store', '-m', 'On main: mine', oid);
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: a drop's redo refuses UNDO_STALE when the entry is already gone.
test('stash.drop redo when it is already gone: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' });
  await w.op('stash.drop', { oid });
  await w.undo();
  w.repo.git('stash', 'drop', '-q');
  await refusesUnchanged(w, () => w.redo(), 'UNDO_STALE');
});

// Invariant: a rename's undo refuses UNDO_STALE once the renamed copy was dropped (the original is not stored back).
test('stash.rename undo after the copy was dropped: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'stashed\n' });
  await w.op('stash.rename', { oid, message: 'renamed' });
  w.repo.git('stash', 'drop', '-q');
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: an applyFile's undo refuses UNDO_STALE once the applied lines were edited (its reverse patch no longer fits).
test('stash.applyFile undo after editing those lines: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  const oid = saved(w, { 'f.txt': 'from the stash\n' });
  await w.op('stash.applyFile', { oid, path: 'f.txt' });
  w.repo.write('f.txt', 'edited since\n');
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: a pushLines' undo refuses UNDO_STALE once the lines around the removed ones were edited.
test('stash.pushLines undo after editing those lines: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  w.repo.commit({ 'l.txt': text(nums(10)) }, 'lines');
  w.repo.write('l.txt', text(nums(10).map((l, i) => (i === 1 ? 'L2' : l))));
  const fd = await w.op('diff.file', { source: { kind: 'unstaged' }, path: 'l.txt', context: 3, whitespace: 'none' });
  const h = fd.hunks[0];
  await w.op('stash.pushLines', { path: 'l.txt', context: 3, hunks: [{ header: h.header, lines: h.lines.flatMap((l, i) => (l.kind === 'context' ? [] : [{ index: i, text: l.text }])) }] });
  w.repo.write('l.txt', text(nums(10).map((l, i) => (i <= 3 ? 'X' : l))));
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: an undo never writes a stash path through an untracked symlink standing for its directory: PATH_BLOCKED,
// nothing outside the repo written, the slots kept.
test('stash.push undo with an untracked symlinked leading directory: PATH_BLOCKED, nothing written outside', async (t) => {
  const w = await undoWorld(t);
  w.repo.write('u/new.txt', 'untracked\n');
  await w.op('stash.push', { includeUntracked: true });
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.repo.dir, 'u'));
  const s = await w.state();
  assert.deepEqual(await refusesUnchanged(w, () => w.undo(), 'PATH_BLOCKED'), s);
  assert.deepEqual(fs.readdirSync(outside), []);
});

/** A stash.branch from `main` (local change h.txt carried), recorded. */
async function branched(w, extra = {}) {
  w.repo.commit({ 'h.txt': 'h\n' }, 'h');
  const oid = saved(w, { 'f.txt': 'stashed\n' });
  w.repo.write('h.txt', 'carried\n');
  return w.op('stash.branch', { oid, name: 'from-stash', ...extra });
}

// Invariant: a stash.branch undo refuses BRANCH_CHECKED_OUT when the branch it switches back to is checked out in
// another worktree; nothing changed, the slots kept.
test('stash.branch undo while the branch it switches back to is checked out elsewhere: BRANCH_CHECKED_OUT', async (t) => {
  const w = await undoWorld(t);
  await branched(w);
  w.repo.git('worktree', 'add', '-q', path.join(w.repo.root, 'elsewhere'), 'main');
  const s = await w.state();
  assert.deepEqual(await refusesUnchanged(w, () => w.undo(), 'BRANCH_CHECKED_OUT'), s);
});

// Invariant: a stash.branch redo that moves a code-conductor/* HEAD needs the acknowledgement (head: true); with it, it runs.
test('stash.branch redo from a code-conductor/* HEAD: CC_OWNED_BRANCH head: true, then success with ccOwned', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'code-conductor/x');
  await branched(w, { ccOwned: true });
  await w.undo();
  await refusesUnchanged(w, () => w.redo(), 'CC_OWNED_BRANCH', { head: true, branches: ['code-conductor/x'] });
  await w.redo({ ccOwned: true });
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/from-stash');
});

// Invariant: a stash.branch undo refuses UNDO_STALE once the new branch moved.
test('stash.branch undo after the branch moved: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await branched(w);
  w.repo.git('commit', '-q', '--allow-empty', '-m', 'moved');
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant (R2): only a real loss asks — the drop's redo (dropsStashes) and the branch's undo (deletesRefs); every
// other stash direction runs at once.
test('confirm shapes of the stash plans', async (t) => {
  const w = await undoWorld(t);
  const seen = {};
  const both = async (name) => {
    const undo = (await w.state()).undo.confirm;
    await w.undo();
    seen[name] = { undo, redo: (await w.state()).redo.confirm };
    await w.redo();
  };
  w.repo.write('f.txt', 'a\n');
  await w.op('stash.push', {});
  await both('push');
  const top = w.oid('refs/stash');
  await w.op('stash.rename', { oid: top, message: 'm' });
  await both('rename');
  const renamed = w.oid('refs/stash');
  await w.op('stash.applyFile', { oid: renamed, path: 'f.txt' });
  await both('applyFile');
  w.repo.git('checkout', '-q', 'f.txt');
  await w.op('stash.pop', { oid: renamed });
  await both('pop');
  const again = saved(w, { 'f.txt': 'b\n' });
  await w.op('stash.drop', { oid: again });
  await both('drop');
  const forBranch = saved(w, { 'f.txt': 'c\n' });
  await w.op('stash.branch', { oid: forBranch, name: 'nb' });
  await both('branch');
  assert.deepEqual(seen, {
    push: { undo: null, redo: null },
    rename: { undo: null, redo: null },
    applyFile: { undo: null, redo: null },
    pop: { undo: null, redo: null },
    drop: { undo: null, redo: { kind: 'dropsStashes', messages: [`WIP on main: ${w.base.slice(0, 7)} base`] } },
    branch: { undo: { kind: 'deletesRefs', refs: ['refs/heads/nb'] }, redo: null },
  });
});

// Invariant: an add's undo refuses UNDO_STALE once the remote's url was changed outside code-git (removing it would
// throw away a config the op did not write).
test('remote.add undo after an external url change: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await w.op('remote.add', { name: 'extra', url: path.join(w.repo.root, 'e.git') });
  w.repo.git('config', 'remote.extra.url', path.join(w.repo.root, 'other.git'));
  assert.deepEqual(await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE'), EMPTY);
});

// Invariant: a remove's undo refuses UNDO_STALE once a remote of that name exists again.
test('remote.remove undo after a remote of that name was re-added: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await w.op('remote.remove', { name: 'origin' });
  w.repo.git('remote', 'add', 'origin', path.join(w.repo.root, 'elsewhere.git'));
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: a remove's undo refuses UNDO_STALE once a branch it would point back at the remote has an upstream again.
test('remote.remove undo after branch.<b>.remote was set again: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await w.op('remote.remove', { name: 'origin' });
  w.repo.git('config', 'branch.main.remote', '.');
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant: a rename's undo refuses UNDO_STALE once the old name is a remote again.
test('remote.rename undo after the old name was re-used: UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  await w.op('remote.rename', { name: 'origin', newName: 'renamed' });
  w.repo.git('remote', 'add', 'origin', path.join(w.repo.root, 'elsewhere.git'));
  await refusesUnchanged(w, () => w.undo(), 'UNDO_STALE');
});

// Invariant (R2): of the remote plans only the remove's redo asks (deletesRemote: the name and the tracking refs it
// deletes); add, edit and rename run at once both ways, and so does the remove's undo.
test('confirm shapes of the remote plans', async (t) => {
  const w = await undoWorld(t);
  const seen = {};
  const both = async (name) => {
    const undo = (await w.state()).undo.confirm;
    await w.undo();
    seen[name] = { undo, redo: (await w.state()).redo.confirm };
    await w.redo();
  };
  await w.op('remote.add', { name: 'extra', url: path.join(w.repo.root, 'e.git') });
  await both('add');
  await w.op('remote.edit', { name: 'extra', url: path.join(w.repo.root, 'f.git') });
  await both('edit');
  await w.op('remote.rename', { name: 'extra', newName: 'other' });
  await both('rename');
  await w.op('remote.remove', { name: 'origin' });
  await both('remove');
  assert.deepEqual(seen, {
    add: { undo: null, redo: null },
    edit: { undo: null, redo: null },
    rename: { undo: null, redo: null },
    remove: { undo: null, redo: { kind: 'deletesRemote', name: 'origin', refs: ['refs/remotes/origin/main'] } },
  });
});

// Invariant: a credentialed url never leaves the journal: undo.state, the undo/redo results, a refusal's body and the
// activity log carry remote names only (git's argv masked as user:***@), through add, edit and remove both ways. A
// remote's other config values (`extra`: a proxy with a password) reach no response at all — not even the remote ops' own
// results, which still carry the urls — while the journal keeps them raw: undoing a remove restores the proxy exactly.
test('credentials: a password in a url or a proxy never reaches undo.state, undo/redo results, refusals, op results or /api/activity', async (t) => {
  const w = await refsWorld(t);
  const app = await startApp(t);
  const target = { project: 'repo' };
  const PW = 'S3cretPW';
  const PROXY_PW = 'Pr0xyPW';
  const proxy = `http://proxyuser:${PROXY_PW}@proxy.invalid:8080`;
  const url = (n) => `https://user:${PW}@example.invalid/${n}.git`;
  const seen = [];
  const results = [];
  const call = async (op, params, status = 200) => {
    const r = await app.call('POST', `/api/ops/${op}`, { target, params });
    assert.equal(r.status, status, `${op}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const watched = async (op, params, status) => { const body = await call(op, params, status); seen.push(body); return body; };
  const remoteOp = async (op, params) => { const body = await call(op, params); results.push(body); return body; };
  const state = () => watched('undo.state');
  const undo = async () => watched('undo.undo', { id: (await state()).result.undo.id });
  const redo = async () => watched('undo.redo', { id: (await state()).result.redo.id });
  const proxyOf = (name) => w.repo.git('config', '--get', `remote.${name}.proxy`);
  await remoteOp('remote.add', { name: 'cred', url: url('one') });
  await undo();
  await redo();
  w.repo.git('config', 'remote.cred.proxy', proxy);
  const edited = await remoteOp('remote.edit', { name: 'cred', url: url('two') });
  assert.deepEqual(edited.result.undo.remotes[0].old.extra, [['proxy', null]], 'the proxy is named, its value withheld');
  await undo();
  await redo();
  await remoteOp('remote.rename', { name: 'cred', newName: 'cred2' });
  await undo();
  await redo();
  assert.equal(proxyOf('cred2'), proxy);
  await remoteOp('remote.remove', { name: 'cred2' });
  await undo();
  assert.equal(proxyOf('cred2'), proxy, 'undoing the remove wrote the raw proxy back');
  await redo();
  await remoteOp('remote.add', { name: 'stale', url: url('three') });
  w.repo.git('config', 'remote.stale.url', url('changed'));
  const refusal = await watched('undo.undo', { id: (await state()).result.undo.id }, 409);
  assert.equal(refusal.code, 'UNDO_STALE');
  for (const body of seen) for (const secret of [PW, PROXY_PW]) assert.ok(!JSON.stringify(body).includes(secret), JSON.stringify(body));
  for (const body of results) assert.ok(!JSON.stringify(body).includes(PROXY_PW), JSON.stringify(body));
  const activity = JSON.stringify((await app.call('GET', '/api/activity')).body);
  for (const secret of [PW, PROXY_PW]) assert.ok(!activity.includes(secret), 'the activity log never holds a password');
  assert.ok(activity.includes('https://user:***@example.invalid/one.git'), 'the undo/redo argv shows the url masked');
  assert.ok(activity.includes('http://proxyuser:***@proxy.invalid:8080'), 'the restored proxy\'s argv shows it masked');
});
