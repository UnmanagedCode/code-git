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

test('the file and line staging ops are registered as non-cancellable writes', () => {
  for (const name of ['stage.files', 'stage.unstageFiles', 'stage.discardFiles', 'stage.stageLines', 'stage.unstageLines', 'stage.discardLines']) {
    const d = OPS.get(name);
    assert.equal(d?.kind, 'write', name);
    assert.equal(d.cancellable, false, name);
  }
});
