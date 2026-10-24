import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRegistry, getOp, OPS } from '../src/git/ops/index.js';

const op = (over) => ({ name: 'test.op', kind: 'read', params: () => ({}), run: async () => null, ...over });

test('cancellable defaults to true for reads and false for writes; an explicit value is kept', () => {
  const reg = buildRegistry([[op({ name: 'a.read' }), op({ name: 'a.write', kind: 'write' })], [op({ name: 'b.write', kind: 'write', cancellable: true }), op({ name: 'b.read', cancellable: false })]]);
  assert.equal(reg.get('a.read').cancellable, true);
  assert.equal(reg.get('a.write').cancellable, false);
  assert.equal(reg.get('b.write').cancellable, true);
  assert.equal(reg.get('b.read').cancellable, false);
  assert.ok(Object.isFrozen(reg.get('a.read')));
});

test('the registry refuses at load: a duplicate name, a non-boolean cancellable, a bad name or kind, missing functions', () => {
  const bad = [
    [[op({ name: 'x.y' })], [op({ name: 'x.y' })]],
    [[op({ cancellable: 'yes' })]],
    [[op({ cancellable: 1 })]],
    [[op({ name: 'NoDot' })]],
    [[op({ name: 'a.b.c' })]],
    [[op({ name: 'a.b-c' })]],
    [[op({ kind: 'admin' })]],
    [[op({ params: undefined })]],
    [[op({ run: 'x' })]],
  ];
  for (const lists of bad) assert.throws(() => buildRegistry(lists), /op registry/);
});

test('getOp resolves a registered op and refuses UNKNOWN_OP otherwise, prototype names included', () => {
  assert.equal(getOp(OPS, 'repo.summary').name, 'repo.summary');
  for (const name of ['nope.op', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => getOp(OPS, name), (e) => e.code === 'UNKNOWN_OP');
  }
});

test("C1's registry holds repo.summary as a cancellable read", () => {
  const s = OPS.get('repo.summary');
  assert.equal(s.kind, 'read');
  assert.equal(s.cancellable, true);
});

test('the diff ops are registered as cancellable reads', () => {
  for (const name of ['diff.files', 'diff.file', 'diff.patch']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'read', name);
    assert.equal(d.cancellable, true, name);
  }
});

test('the staging, commit, ignore, restore and patch writes are registered as non-cancellable writes', () => {
  for (const name of ['stage.files', 'stage.unstageFiles', 'stage.discardFiles', 'stage.stageLines', 'stage.unstageLines', 'stage.discardLines', 'commit.create', 'ignore.add', 'files.restore', 'patch.apply']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, false, name);
  }
});

test('the commit box reads and patch.check are cancellable reads', () => {
  for (const name of ['commit.state', 'commit.headMessage', 'commit.template', 'patch.check']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'read', name);
    assert.equal(d.cancellable, true, name);
  }
});

test('the branch ops: tracking is a cancellable read; the local branch writes are not cancellable', () => {
  assert.equal(OPS.get('branch.tracking')?.kind, 'read');
  assert.equal(OPS.get('branch.tracking').cancellable, true);
  for (const name of ['branch.create', 'branch.checkout', 'branch.rename', 'branch.delete', 'branch.setUpstream', 'branch.fastForward', 'branch.move']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, false, name);
  }
});

test('the tag ops and the remote branch delete are registered as writes, the network ones cancellable', () => {
  for (const [name, cancellable] of [['tag.create', false], ['tag.delete', false], ['tag.push', true], ['tag.deleteRemote', true], ['branch.deleteRemote', true]]) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, cancellable, name);
  }
});

test('the HEAD ops are registered as non-cancellable writes', () => {
  for (const name of ['head.reset', 'head.revert', 'head.cherryPick', 'head.abort']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, false, name);
  }
});

test('the sequence writes (continue, skip, abort, and the merge / rebase / conflict starts) are non-cancellable writes; their reads cancellable', () => {
  for (const name of ['head.abort', 'head.continue', 'head.skip', 'merge.start', 'rebase.start', 'rebase.interactive', 'conflict.save', 'conflict.take']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, false, name);
  }
  for (const name of ['rebase.plan', 'conflict.read']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'read', name);
    assert.equal(d.cancellable, true, name);
  }
});

test('the submodule ops: list is a cancellable read', () => {
  assert.equal(OPS.get('submodule.list')?.kind, 'read');
  assert.equal(OPS.get('submodule.list').cancellable, true);
});

test('write ops are non-cancellable: every submodule write', () => {
  for (const name of ['submodule.add', 'submodule.init', 'submodule.update', 'submodule.sync', 'submodule.setUrl', 'submodule.remove', 'submodule.commitPointer']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, false, name);
  }
});

// Invariant: undo.state is a cancellable read; undo.undo and undo.redo are writes that cannot be cancelled mid-plan.
test('the undo ops: state is a cancellable read, undo and redo non-cancellable writes', () => {
  assert.equal(OPS.get('undo.state')?.kind, 'read');
  assert.equal(OPS.get('undo.state').cancellable, true);
  for (const name of ['undo.undo', 'undo.redo']) {
    assert.equal(OPS.get(name)?.kind, 'write', name);
    assert.equal(OPS.get(name).cancellable, false, name);
  }
});

// Invariant (D2): exactly these ops are registered for undo; every other write clears the slots.
test('the ops registered for undo are exactly the decided list', () => {
  const registered = [...OPS.values()].filter((o) => o.undo).map((o) => o.name).sort();
  assert.deepEqual(registered, [
    'branch.checkout', 'branch.create', 'branch.delete', 'branch.fastForward', 'branch.move', 'branch.rename',
    'commit.create', 'head.cherryPick', 'head.continue', 'head.reset', 'head.revert', 'head.skip',
    'merge.start', 'rebase.interactive', 'rebase.start', 'remote.add', 'remote.edit', 'remote.remove', 'remote.rename',
    'stage.discardFiles', 'stage.discardLines',
    'stash.apply', 'stash.applyFile', 'stash.branch', 'stash.drop', 'stash.pop', 'stash.push', 'stash.pushLines', 'stash.rename', 'tag.create', 'tag.delete',
  ]);
});

// Invariant (R3): `journal: 'neutral'` is accepted on a write only; any other value, on a read, or beside an undo throws at load.
test("journal: 'neutral' is a write-only flag, refused with another value, on a read or with an undo", () => {
  const write = op({ name: 'n.write', kind: 'write', journal: 'neutral' });
  assert.equal(buildRegistry([[write]]).get('n.write').journal, 'neutral');
  assert.throws(() => buildRegistry([[op({ journal: 'neutral' })]]), /op registry: test\.op: journal/);
  for (const journal of ['skip', true, null, '']) assert.throws(() => buildRegistry([[op({ kind: 'write', journal })]]), /op registry: test\.op: journal/, String(journal));
  assert.throws(() => buildRegistry([[op({ kind: 'write', journal: 'neutral', undo: () => null })]]), /op registry: test\.op: journal/);
});
