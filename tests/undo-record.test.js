import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRegistry } from '../src/git/ops/index.js';
import { createJournal, targetKey } from '../src/git/undo/journal.js';
import { journalAround } from '../src/git/undo/record.js';

const A = { project: 'p', worktree: null };
const B = { project: 'p', worktree: 'wt' };
const SUB = { project: 'p', worktree: null, sub: ['lib'] };
const plan = (label = 'x') => ({ label, created: null, confirm: { undo: null, redo: null }, steps: [{ kind: 'refs', refs: [] }] });
const def = (over) => ({ name: 'test.write', kind: 'write', params: () => ({}), run: async () => ({}), ...over });

// Invariant: an op definition's `undo` is checked at load — a function, on a write only.
test('the registry refuses an undo that is not a function, or an undo on a read', () => {
  assert.throws(() => buildRegistry([[def({ undo: 'x' })]]), /undo must be a function/);
  assert.throws(() => buildRegistry([[def({ kind: 'read', undo: () => null })]]), /only a write has an undo/);
  assert.equal(typeof buildRegistry([[def({ undo: () => null })]]).get('test.write').undo, 'function');
});

// Invariant: the journal key is the frontend's tabKey: project, worktree and sub chain each make a distinct checkout.
test('targetKey separates the main checkout, a worktree and a submodule chain', () => {
  const keys = [A, B, SUB, { project: 'p', worktree: null, sub: ['lib', 'deep'] }, { project: 'q', worktree: null }].map(targetKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(targetKey({ project: 'p', worktree: 'wt', sub: ['a', 'b'] }), 'p\0wt\0a\0b');
});

// Invariant: a successful registered write puts its plan in the undo slot and empties redo.
test('a write with a plan is recorded in the undo slot; the slots are per checkout', async () => {
  const j = createJournal();
  const op = def({ undo: () => plan('mine') });
  await journalAround(j, op, A, {}, op.run);
  assert.equal(j.state(A).undo.plan.label, 'mine');
  assert.equal(j.state(A).undo.op, 'test.write');
  assert.equal(j.state(A).redo, null);
  assert.deepEqual(j.state(B), { undo: null, redo: null });
  assert.deepEqual(j.state(SUB), { undo: null, redo: null });
});

// Invariant (D1): every write not registered for undo clears both slots; a read never does.
test('an unregistered write clears both slots of its checkout only; a read clears nothing', async () => {
  const j = createJournal();
  const reg = def({ undo: () => plan() });
  await journalAround(j, reg, A, {}, reg.run);
  await journalAround(j, reg, B, {}, reg.run);
  const e = j.take(A, 'undo', j.state(A).undo.id);
  j.move(A, 'undo', e.entry, e.gen);
  await journalAround(j, reg, A, {}, reg.run);
  j.move(A, 'undo', j.state(A).undo, j.take(A, 'undo', j.state(A).undo.id).gen);
  assert.ok(j.state(A).redo);
  await journalAround(j, def({ kind: 'read' }), A, {}, async () => ({}));
  assert.ok(j.state(A).redo, 'a read keeps the slots');
  await journalAround(j, def({ name: 'stash.push' }), A, {}, async () => ({}));
  assert.deepEqual(j.state(A), { undo: null, redo: null });
  assert.ok(j.state(B).undo, 'another checkout keeps its slot');
});

// Invariant (D1): a registered write that fails, or answers no plan (a conflicts stop), leaves the slots cleared.
test('a failed write, a null plan and a plan without steps all leave the slots empty', async () => {
  const j = createJournal();
  const reg = def({ undo: () => plan() });
  for (const [op, run] of [
    [reg, async () => { throw new Error('git failed'); }],
    [def({ undo: () => null }), async () => ({})],
    [def({ undo: () => ({ ...plan(), steps: [] }) }), async () => ({})],
  ]) {
    await journalAround(j, reg, A, {}, reg.run);
    assert.ok(j.state(A).undo);
    await journalAround(j, op, A, {}, run).catch(() => {});
    assert.deepEqual(j.state(A), { undo: null, redo: null });
  }
});

// Invariant: undo.* ops pass through journalAround without clearing (they manage the slots themselves).
test('an undo.* write does not clear the slots', async () => {
  const j = createJournal();
  const reg = def({ undo: () => plan() });
  await journalAround(j, reg, A, {}, reg.run);
  await journalAround(j, def({ name: 'undo.undo' }), A, {}, async () => ({}));
  assert.ok(j.state(A).undo);
});

// Invariant: a write that started before another write cleared the slots cannot record over it.
test('a plan recorded under an older generation is dropped', () => {
  const j = createJournal();
  const g1 = j.beforeWrite(A);
  const g2 = j.beforeWrite(A);
  assert.ok(j.recorded(A, g2, 'b', plan('b')));
  assert.equal(j.recorded(A, g1, 'a', plan('a')), null);
  assert.equal(j.state(A).undo.plan.label, 'b');
});

// Invariant: take matches the id exactly; move needs the generation it was taken at, so a clear during an undo wins.
test('take by id, move to the other slot, and a clear while an undo runs keeps the slots empty', () => {
  const j = createJournal();
  const gen = j.beforeWrite(A);
  const entry = j.recorded(A, gen, 'op', plan());
  assert.equal(j.take(A, 'undo', entry.id + 1), null);
  assert.equal(j.take(A, 'redo', entry.id), null);
  const t1 = j.take(A, 'undo', entry.id);
  j.move(A, 'undo', t1.entry, t1.gen);
  assert.deepEqual(j.state(A), { undo: null, redo: entry });
  const t2 = j.take(A, 'redo', entry.id);
  j.beforeWrite(A);
  j.move(A, 'redo', t2.entry, t2.gen);
  assert.deepEqual(j.state(A), { undo: null, redo: null });
  const fresh = j.recorded(A, j.beforeWrite(A), 'op', plan());
  assert.ok(fresh.id > entry.id, 'ids are never reused');
  j.clear(A);
  assert.deepEqual(j.state(A), { undo: null, redo: null });
});

// Invariant: a plan builder that throws is logged, never fails the op that already ran, and records nothing.
test('a throwing plan builder answers the op result and records nothing', async (t) => {
  const j = createJournal();
  t.mock.method(console, 'error', () => {});
  const op = def({ undo: () => { throw new Error('bug'); } });
  assert.deepEqual(await journalAround(j, op, A, {}, async () => ({ ok: 1 })), { ok: 1 });
  assert.deepEqual(j.state(A), { undo: null, redo: null });
  assert.equal(console.error.mock.callCount(), 1);
});
