import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { BASE_ARGS } from '../src/git/runner.js';
import { hermeticEnv } from './_git.js';
import { refused } from './_refsWorld.js';
import { undoWorld } from './_undoWorld.js';

// The engine's ordering guarantees (src/git/undo/engine.js) and the refs step's two value checks
// (src/git/undo/steps/refs.js): its preflight, and the compare-and-swap of its transaction.

/** The argv (after git and BASE_ARGS) of every exec `run` makes. */
async function execsOf(w, run) {
  const from = w.cc.state.execCalls.length;
  const out = await run().then((v) => ({ v }), (e) => ({ e }));
  return { ...out, argvs: w.cc.state.execCalls.slice(from).map((b) => b.argv.slice(1 + BASE_ARGS.length)) };
}
/** Subcommands that write refs, the index or the worktree. */
const WRITERS = new Set(['update-ref', 'symbolic-ref', 'switch', 'reset', 'read-tree', 'restore', 'clean', 'apply', 'branch', 'config', 'stash']);
const writes = (argvs) => argvs.filter((a) => WRITERS.has(a[0]) && !(a[0] === 'symbolic-ref' && a[1] === '-q') && !(a[0] === 'stash' && a[1] === 'create'));

// Invariant: every step's preflight runs before any step applies — a plan whose second step refuses writes nothing,
// not even what its first step would have written.
test('a plan whose second step refuses in preflight changes nothing: redo of create-and-checkout onto a cc HEAD', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'code-conductor/base');
  await w.op('branch.create', { name: 'made', checkout: true, ccOwned: true });
  await w.undo({ ccOwned: true });
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/code-conductor/base');
  assert.equal(w.exists('refs/heads/made'), false);
  // Redo runs [refs: create made, head: switch to made]; the switch's preflight refuses moving the cc HEAD unacknowledged.
  const before = w.snap();
  const r = await execsOf(w, () => w.redo());
  assert.ok(r.e, 'the redo is refused');
  refused('CC_OWNED_BRANCH', { head: true })(r.e);
  assert.deepEqual(w.snap(), before, 'HEAD, refs, index and worktree unchanged');
  assert.deepEqual(writes(r.argvs), [], 'no write command ran: the first step never applied');
  assert.equal(w.exists('refs/heads/made'), false);
  assert.ok((await w.state()).redo, 'kept: with the acknowledgement it can run');
});

// Invariant: the refs step's preflight refuses UNDO_STALE when a ref it writes no longer holds the value the plan
// expects (moved with raw git after the op), before any write — a branch and a tag.
test('a branch or tag moved after the op: UNDO_STALE from the preflight, nothing moves', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'free');
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  const three = w.repo.commit({ 'f.txt': 'three\n' }, 'three');
  await w.op('branch.move', { name: 'free', to: two, expect: w.base });
  w.repo.git('update-ref', 'refs/heads/free', three);
  const before = w.snap();
  const r = await execsOf(w, () => w.undo());
  refused('UNDO_STALE')(r.e);
  assert.deepEqual(writes(r.argvs), [], 'refused before the transaction');
  assert.deepEqual(w.snap(), before);
  assert.equal(w.oid('free'), three);

  await w.op('tag.create', { name: 'v1', oid: w.base });
  w.repo.git('update-ref', 'refs/tags/v1', two);
  const tagged = await execsOf(w, () => w.undo());
  refused('UNDO_STALE')(tagged.e);
  assert.deepEqual(writes(tagged.argvs), []);
  assert.equal(w.oid('refs/tags/v1'), two, 'the tag is not deleted');
});

// Invariant: the transaction compares each ref with its expected old value: a ref moved between the preflight and the
// apply makes `update-ref --stdin` fail and write nothing (UNDO_STALE), the slots are cleared.
test('a ref moved between preflight and apply: the transaction fails, writes nothing, UNDO_STALE', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'b');
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  const three = w.repo.commit({ 'f.txt': 'three\n' }, 'three');
  await w.op('branch.move', { name: 'b', to: two, expect: w.base });
  // The preflight sees b at `two`; the hook moves it to `three` just as the transaction is sent.
  let moved = false;
  w.cc.state.execHook = (body) => {
    const argv = body.argv.slice(1 + BASE_ARGS.length);
    if (!moved && argv[0] === 'update-ref' && argv.includes('--stdin')) {
      moved = true;
      execFileSync('git', ['-C', w.repo.dir, 'update-ref', 'refs/heads/b', three], { env: hermeticEnv(w.repo.home) });
    }
    return undefined;
  };
  await assert.rejects(w.undo(), refused('UNDO_STALE'));
  assert.ok(moved, 'the move landed between preflight and apply');
  assert.equal(w.oid('b'), three, 'the transaction wrote nothing: b keeps the value moved in');
  assert.deepEqual(await w.state(), { undo: null, redo: null });
});

// Invariant: a transaction over several refs is all-or-nothing: one ref moved between preflight and apply leaves every
// ref of it as it was.
test('a two-ref transaction with one ref moved in between writes neither', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'x');
  w.repo.git('branch', 'y');
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  await w.op('branch.delete', { names: ['x', 'y'], force: true });
  // Undo recreates both in one transaction; the hook creates `y` (elsewhere) just before it runs.
  w.cc.state.execHook = (body) => {
    const argv = body.argv.slice(1 + BASE_ARGS.length);
    if (argv[0] === 'update-ref' && argv.includes('--stdin')) {
      w.cc.state.execHook = null;
      execFileSync('git', ['-C', w.repo.dir, 'branch', 'y', two], { env: hermeticEnv(w.repo.home) });
    }
    return undefined;
  };
  await assert.rejects(w.undo(), refused('UNDO_STALE'));
  assert.equal(w.exists('refs/heads/x'), false, 'x was not created either');
  assert.equal(w.oid('y'), two);
});
