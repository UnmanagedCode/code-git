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
  for (const name of ['head.abort', 'head.continue', 'head.skip', 'merge.start', 'rebase.start']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, false, name);
  }
});
