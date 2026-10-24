import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { roundTrip, undoWorld } from './_undoWorld.js';

// The remote-config ops registered for undo: do → undo restores the state before exactly (every remote.* key in order,
// the branch config naming the remote, the tracking refs and the remote's HEAD symref) → redo restores the state after.

/** A second remote `up` beside origin, fetched: refs/remotes/up/main and its HEAD symref. */
function second(w, name = 'up') {
  w.repo.git('remote', 'add', name, w.origin.dir);
  w.repo.git('fetch', '-q', name);
  w.repo.git('remote', 'set-head', name, 'main');
}

// Invariant: adding a remote (with a push url) undoes into no such remote and redoes into exactly the same config; no
// direction asks.
test('remote.add with a push url', async (t) => {
  const w = await undoWorld(t);
  const { state } = await roundTrip(w, () => w.op('remote.add', { name: 'extra', url: path.join(w.repo.root, 'e.git'), pushUrl: path.join(w.repo.root, 'p.git') }));
  assert.equal(state.undo.label, 'Add remote extra');
  assert.equal(state.undo.confirm, null);
  await w.undo();
  assert.equal((await w.state()).redo.confirm, null);
});

// Invariant: editing a url undoes into the old url (in place) and redoes into the new one.
test('remote.edit: the url', async (t) => {
  const w = await undoWorld(t);
  const { state } = await roundTrip(w, () => w.op('remote.edit', { name: 'origin', url: path.join(w.repo.root, 'moved.git') }));
  assert.equal(state.undo.label, 'Edit remote origin');
});

// Invariant: a push url set, replaced and unset each undo and redo exactly.
test('remote.edit: the push url set, replaced, unset', async (t) => {
  const w = await undoWorld(t);
  await roundTrip(w, () => w.op('remote.edit', { name: 'origin', pushUrl: path.join(w.repo.root, 'push1.git') }));
  await roundTrip(w, () => w.op('remote.edit', { name: 'origin', pushUrl: path.join(w.repo.root, 'push2.git') }));
  await roundTrip(w, () => w.op('remote.edit', { name: 'origin', pushUrl: null }));
});

// Invariant: a rename undoes by renaming back: the tracking refs, the remote's HEAD symref, branch.<b>.remote and
// branch.<b>.pushRemote all follow both ways.
test('remote.rename: tracking refs, HEAD symref, upstream and pushRemote follow', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('remote', 'set-head', 'origin', 'main');
  w.repo.git('config', 'branch.main.pushRemote', 'origin');
  const { state } = await roundTrip(w, () => w.op('remote.rename', { name: 'origin', newName: 'renamed' }));
  assert.equal(state.undo.label, 'Rename remote origin to renamed');
  assert.equal(state.undo.confirm, null);
});

// Invariant: a remove undoes exactly — its config (an extra key included), the upstreams, pushRemote and pushDefault
// git cleared, the tracking refs and the HEAD symref — and its redo asks first (deletesRemote, with those refs).
test('remote.remove: config, extra key, upstreams, pushRemote, pushDefault, tracking refs and HEAD symref come back', async (t) => {
  const w = await undoWorld(t);
  second(w);
  w.repo.git('branch', 'feat');
  w.repo.git('config', 'branch.feat.remote', 'up');
  w.repo.git('config', 'branch.feat.merge', 'refs/heads/main');
  w.repo.git('config', 'branch.feat.pushRemote', 'up');
  w.repo.git('config', 'branch.main.pushRemote', 'up');
  w.repo.git('config', 'remote.pushDefault', 'up');
  w.repo.git('config', 'remote.up.prune', 'true');
  const { state, result } = await roundTrip(w, () => w.op('remote.remove', { name: 'up' }));
  assert.deepEqual([...result.deletedRefs].sort(), ['refs/remotes/up/HEAD', 'refs/remotes/up/main']);
  assert.equal(state.undo.label, 'Remove remote up');
  assert.equal(state.undo.confirm, null);
  await w.undo();
  const redo = (await w.state()).redo.confirm;
  assert.deepEqual({ ...redo, refs: [...redo.refs].sort() }, { kind: 'deletesRemote', name: 'up', refs: ['refs/remotes/up/HEAD', 'refs/remotes/up/main'] });
});

// Invariant: a remove records only the branch and push keys git cleared from the repo's own config: an upstream, a
// pushRemote and a pushDefault naming the remote in the global config (which git cannot clear) neither block the undo
// nor are written back by it — undo and redo restore exactly, and the global file is never touched.
test('remote.remove with upstream and push keys in the global config: undo and redo exact, the global file untouched', async (t) => {
  const w = await undoWorld(t);
  const global = path.join(w.repo.home, '.gitconfig');
  fs.appendFileSync(global, '[branch "main"]\n\tremote = origin\n\tpushRemote = origin\n[remote]\n\tpushDefault = origin\n');
  const globalBefore = fs.readFileSync(global, 'utf8');
  const { result } = await roundTrip(w, () => w.op('remote.remove', { name: 'origin' }));
  const old = result.undo.remotes[0].old;
  assert.deepEqual(old.branchKeys, [['branch.main.remote', 'origin'], ['branch.main.merge', 'refs/heads/main']], 'only the repo\'s own keys git cleared');
  assert.equal(old.pushDefault, false, 'no push key git could not clear');
  assert.equal(fs.readFileSync(global, 'utf8'), globalBefore);
});

/** Moves main's `branch.main.remote = origin` out of the repo's own config into `scope`, keeping the local merge → the file it lives in. */
function remoteElsewhere(w, scope) {
  w.repo.git('config', '--unset', 'branch.main.remote');
  const line = '[branch "main"]\n\tremote = origin\n';
  if (scope === 'global') {
    const file = path.join(w.repo.home, '.gitconfig');
    fs.appendFileSync(file, line);
    return file;
  }
  if (scope === 'include') {
    const file = path.join(w.repo.root, 'included.cfg');
    fs.writeFileSync(file, line);
    w.repo.git('config', 'include.path', file);
    return file;
  }
  w.repo.git('config', 'extensions.worktreeConfig', 'true');
  w.repo.git('config', '--worktree', 'branch.main.remote', 'origin');
  return path.join(w.repo.dir, '.git', 'config.worktree');
}

// Invariant: git picks the branches to clear by their effective branch.<b>.remote (any scope) and unsets .remote and
// .merge in the repo's own config; the record is that diff — here the local merge alone, the remote living in a global,
// included or worktree config — so undo writes the local merge back exactly, redo clears it again, and the other file
// is never touched.
for (const scope of ['global', 'include', 'worktree']) {
  test(`remote.remove with main's remote in the ${scope} config and its merge local: undo restores the merge, redo clears it`, async (t) => {
    const w = await undoWorld(t);
    const file = remoteElsewhere(w, scope);
    assert.equal(w.repo.git('config', 'branch.main.remote'), 'origin', 'the effective upstream remote is origin');
    const fileBefore = fs.readFileSync(file, 'utf8');
    const { result } = await roundTrip(w, () => w.op('remote.remove', { name: 'origin' }));
    assert.deepEqual(result.undo.remotes[0].old.branchKeys, [['branch.main.merge', 'refs/heads/main']]);
    assert.deepEqual(result.clearedUpstreams, [{ branch: 'main', merge: 'refs/heads/main' }]);
    assert.equal(fs.readFileSync(file, 'utf8'), fileBefore, `the ${scope} file is untouched`);
    await w.undo();
    assert.equal(w.repo.git('config', '--local', '--get-all', 'branch.main.merge'), 'refs/heads/main', 'the local merge is back, once');
    assert.equal(fs.readFileSync(file, 'utf8'), fileBefore);
  });
}

/** Each var with two local values, the remote last: what `remote remove` sees, and the key it must leave in place. */
const MULTI = {
  merge: { setup: (g) => g('config', '--add', 'branch.main.merge', 'refs/heads/other'), left: 'branch.main.merge' },
  pushRemote: { setup: (g) => { g('branch', 'feat'); g('config', '--add', 'branch.feat.pushRemote', 'elsewhere'); g('config', '--add', 'branch.feat.pushRemote', 'origin'); }, left: 'branch.feat.pushRemote' },
  remote: { setup: (g) => { g('config', '--replace-all', 'branch.main.remote', 'elsewhere'); g('config', '--add', 'branch.main.remote', 'origin'); }, left: 'branch.main.remote' },
  pushDefault: { setup: (g) => { g('config', '--add', 'remote.pushDefault', 'elsewhere'); g('config', '--add', 'remote.pushDefault', 'origin'); }, left: 'remote.pushDefault' },
};

// Invariant: git refuses to unset a key with several values ("has multiple values") and leaves it; the record omits it
// and the redo predicts git the same way (per key: a multi-valued key is never expected to be cleared, a single-valued
// sibling still is; pushDefault only when it has exactly one local value, the remote), so remove → undo → redo runs and
// matches what git cleared.
for (const [v, { setup, left }] of Object.entries(MULTI)) {
  test(`remote.remove with a multi-valued local ${v} (the remote last): undo and redo exact, the key left in place`, async (t) => {
    const w = await undoWorld(t);
    const g = (...args) => w.repo.git(...args);
    setup(g);
    const values = g('config', '--local', '--get-all', left);
    const { result } = await roundTrip(w, () => w.op('remote.remove', { name: 'origin' }));
    assert.equal(g('config', '--local', '--get-all', left), values, `git left ${left} as it was`);
    const old = result.undo.remotes[0].old;
    assert.ok(!old.branchKeys.some(([k]) => k.toLowerCase() === left.toLowerCase()), `${left} is not in the record`);
    if (v === 'pushDefault') assert.equal(old.pushDefault, false);
    if (v === 'remote') assert.deepEqual(old.branchKeys, [['branch.main.merge', 'refs/heads/main']], 'the single-valued merge was cleared');
  });
}

// Invariant: an add's undo never touches a branch key — an upstream naming the remote that existed before the add
// (branch.side.remote / .merge) is left exactly as it was by the undo (only the section goes) and by the redo.
test('remote.add over a pre-existing upstream naming it: undo removes only the section, the upstream stays', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'side');
  w.repo.git('config', 'branch.side.remote', 'extra');
  w.repo.git('config', 'branch.side.merge', 'refs/heads/side');
  const upstream = () => w.repo.git('config', '--local', '--get-regexp', '^branch\\.side\\.');
  const before = upstream();
  await roundTrip(w, () => w.op('remote.add', { name: 'extra', url: path.join(w.repo.root, 'e.git') }));
  await w.undo();
  assert.equal(upstream(), before, 'the upstream is exactly as before the add');
  assert.throws(() => w.repo.git('config', '--get', 'remote.extra.url'), 'the section is gone');
});

// Invariant: a branch.<b>.pushRemote key is not an upstream: a branch with only a pushRemote naming the remote is left out
// of clearedUpstreams, while branchKeys records its pushRemote and the undo restores it.
test('remote.remove of a branch with only a pushRemote: not in clearedUpstreams, recorded and restored', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'solo');
  w.repo.git('config', 'branch.solo.pushRemote', 'origin');
  const { result } = await roundTrip(w, () => w.op('remote.remove', { name: 'origin' }));
  assert.deepEqual(result.clearedUpstreams, [{ branch: 'main', merge: 'refs/heads/main' }]);
  assert.ok(result.undo.remotes[0].old.branchKeys.some(([k, v]) => k === 'branch.solo.pushremote' && v === 'origin'), 'the pushRemote is recorded');
  await w.undo();
  assert.equal(w.repo.git('config', '--local', '--get-all', 'branch.solo.pushRemote'), 'origin');
});

/** Branches `names` tracking origin (main already does), in config order. */
function tracking(w, names) {
  for (const b of names) {
    w.repo.git('branch', b);
    w.repo.git('config', `branch.${b}.remote`, 'origin');
    w.repo.git('config', `branch.${b}.merge`, `refs/heads/${b}`);
  }
}

// Invariant: the upstreams are compared as a set, not in .git/config order: an undo re-adds a key into a branch section
// that survived (a pushRemote naming another remote pins it) but appends a new section for an emptied one, so the
// order changes — and the redo still runs, as does the undo after it.
for (const [label, names, pinned] of [['two branches, the second pinned', ['feat'], 'feat'], ['three branches, the middle one pinned', ['feat', 'tail'], 'feat']]) {
  test(`remote.remove with ${label} by a surviving pushRemote: remove → undo → redo → undo`, async (t) => {
    const w = await undoWorld(t);
    tracking(w, names);
    w.repo.git('config', `branch.${pinned}.pushRemote`, 'other');
    const { before } = await roundTrip(w, () => w.op('remote.remove', { name: 'origin' }));
    await w.undo();
    assert.deepEqual(w.snap(), before, 'the second undo restores the state before too');
  });
}
