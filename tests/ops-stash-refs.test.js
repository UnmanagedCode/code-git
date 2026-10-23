import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPS } from '../src/git/ops/index.js';
import { noViolations, refused } from './_ops.js';
import { runs, stashList, stashWorld } from './_stash.js';

// stash.drop and stash.rename: entries addressed by oid, the drop verified against what git says it dropped.

async function withStashes(t, n = 2) {
  const w = await stashWorld(t);
  const oids = [];
  for (let i = 0; i < n; i++) {
    w.repo.write('a.txt', `a${i}\n`);
    oids.unshift((await w.op('stash.push', { message: `m${i}` })).oid);
  }
  return { ...w, oids };
}
const fail = (body) => ({ status: 200, body: { exitCode: 1, stdout: '', stderr: Buffer.from('error: injected\n').toString('base64'), encoding: 'base64', durationMs: 1, ...body } });

test('drop by oid removes that entry even after another stash is pushed above it', async (t) => {
  const w = await withStashes(t);
  const [top, older] = w.oids;
  w.repo.write('b.txt', 'b2\n');
  w.repo.git('stash', 'push', '-q', '-m', 'elsewhere');
  const newest = stashList(w)[0].oid;
  const r = await w.op('stash.drop', { oid: older });
  assert.deepEqual(stashList(w).map((s) => s.oid), [newest, top]);
  assert.deepEqual(r.undo.stashes, [{ oid: older, old: { message: 'On main: m0' }, new: null, restore: 'store' }]);
  assert.equal(r.oid, older);
  noViolations(w.cc);
});

test('drop race: a stash pushed between resolve and drop → the wrongly dropped entry is re-stored and STASH_MOVED is returned', async (t) => {
  const w = await withStashes(t);
  const before = stashList(w).map((s) => s.oid);
  w.cc.state.execHook = (body) => (body.argv.includes('drop') ? 'hold' : undefined);
  const dropping = w.op('stash.drop', { oid: w.oids[0] });
  const held = await w.cc.nextHeld();
  w.repo.write('b.txt', 'b2\n');
  w.repo.git('stash', 'push', '-q', '-m', 'raced');
  const raced = stashList(w)[0].oid;
  w.cc.state.execHook = null;
  held.release();
  await assert.rejects(dropping, (e) => e.code === 'STASH_MOVED' && e.extra.restored === raced);
  assert.deepEqual(new Set(stashList(w).map((s) => s.oid)), new Set([raced, ...before]));
  assert.equal(stashList(w).find((s) => s.oid === raced).message, 'On main: raced');
});

test('rename stores before it drops: a failure injected on the drop leaves both entries', async (t) => {
  const w = await withStashes(t, 1);
  const [orig] = w.oids;
  w.cc.state.execHook = (body) => (body.argv.includes('drop') ? fail() : undefined);
  await assert.rejects(w.op('stash.rename', { oid: orig, message: 'renamed' }), (e) => {
    assert.equal(e.code, 'GIT_FAILED');
    assert.equal(e.extra.step, 'dropOriginal');
    assert.match(e.extra.newOid, /^[0-9a-f]{40}$/);
    return true;
  });
  const list = stashList(w);
  assert.deepEqual(list.map((s) => s.message), ['On main: renamed', 'On main: m0']);
  assert.equal(list[1].oid, orig);
  const order = w.execArgv().map((a) => a.find((x) => x === 'store' || x === 'drop')).filter(Boolean);
  assert.deepEqual(order, ['store', 'drop']);
});

test('rename keeps the tree, parents, author and dates; the new subject is shown at stash@{0}; undo has two entries', async (t) => {
  const w = await withStashes(t, 2);
  const [top, older] = w.oids;
  const fmt = (oid) => w.repo.git('log', '-1', '--format=%T%n%P%n%an <%ae> %ad%n%cn <%ce> %cd', '--date=raw', oid);
  const r = await w.op('stash.rename', { oid: older, message: 'better name' });
  assert.equal(r.previous, older);
  assert.equal(fmt(r.oid), fmt(older));
  assert.equal(w.repo.git('log', '-1', '--format=%s', r.oid), 'On main: better name');
  assert.deepEqual(stashList(w), [{ oid: r.oid, message: 'On main: better name' }, { oid: top, message: 'On main: m1' }]);
  assert.deepEqual(r.undo.stashes, [
    { oid: r.oid, old: null, new: { message: 'On main: better name' }, restore: 'drop' },
    { oid: older, old: { message: 'On main: m0' }, new: null, restore: 'store' },
  ]);
  // A stash git named "WIP on …" keeps its branch label.
  w.repo.write('a.txt', 'wip\n');
  w.repo.git('stash', 'push', '-q');
  const wip = stashList(w)[0].oid;
  const r2 = await w.op('stash.rename', { oid: wip, message: 'named now' });
  assert.equal(stashList(w)[0].message, 'On main: named now');
  assert.equal(stashList(w)[0].oid, r2.oid);
  assert.equal(runs(w, 'commit-tree').every((a) => a.includes('--no-gpg-sign')), true);
  // A subject git did not write is replaced whole.
  w.repo.git('stash', 'store', '-m', 'custom subject', older);
  const r3 = await w.op('stash.rename', { oid: older, message: 'plain' });
  assert.equal(stashList(w)[0].message, 'plain');
  assert.equal(w.repo.git('log', '-1', '--format=%s', r3.oid), 'plain');
});

test('rename of a stash with untracked files keeps all three parents', async (t) => {
  const w = await stashWorld(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.write('u.txt', 'u\n');
  const { oid } = await w.op('stash.push', { includeUntracked: true });
  const r = await w.op('stash.rename', { oid, message: 'with u' });
  assert.equal(w.repo.git('log', '-1', '--format=%P', r.oid), w.repo.git('log', '-1', '--format=%P', oid));
  assert.equal(w.repo.git('log', '-1', '--format=%P', r.oid).split(' ').length, 3);
});

test('rename to the same message → BAD_PARAMS; an empty message → BAD_PARAMS', async (t) => {
  const w = await withStashes(t, 1);
  await assert.rejects(w.op('stash.rename', { oid: w.oids[0], message: 'm0' }), refused('BAD_PARAMS'));
  await assert.rejects(w.op('stash.rename', { oid: w.oids[0], message: '  ' }), refused('BAD_PARAMS'));
  await assert.rejects(w.op('stash.rename', { oid: w.oids[0] }), refused('BAD_PARAMS'));
  assert.equal(stashList(w).length, 1);
  assert.equal(runs(w, 'stash', 'store').length, 0);
});

test('unknown oid → STASH_UNKNOWN; a selector or short oid → BAD_REF', async (t) => {
  const w = await withStashes(t, 1);
  for (const op of ['stash.drop', 'stash.rename']) {
    const params = (oid) => (op === 'stash.drop' ? { oid } : { oid, message: 'x' });
    await assert.rejects(w.op(op, params(w.base)), refused('STASH_UNKNOWN'));
    for (const oid of ['stash@{0}', w.oids[0].slice(0, 10), '-x']) await assert.rejects(w.op(op, params(oid)), refused('BAD_REF'));
  }
  assert.deepEqual(stashList(w).map((s) => s.oid), w.oids);
});

test('every stash op is kind write, non-cancellable', () => {
  const names = [...OPS.keys()].filter((n) => n.startsWith('stash.'));
  assert.ok(names.includes('stash.push') && names.includes('stash.drop') && names.includes('stash.rename'));
  for (const n of names) {
    assert.equal(OPS.get(n).kind, 'write', n);
    assert.equal(OPS.get(n).cancellable, false, n);
  }
});
