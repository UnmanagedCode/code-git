import assert from 'node:assert/strict';
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
