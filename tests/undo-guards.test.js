import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { BASE_ARGS, BASE_ENV, isProtectedEnv, READ_ENV } from '../src/git/runner.js';
import { createJournal } from '../src/git/undo/journal.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';
import { refused } from './_refsWorld.js';
import { undoWorld } from './_undoWorld.js';

// What refuses an undo or redo, what each refusal leaves (nothing changed; the slots kept unless the entry can never
// run), and the argv every undo command runs with.

const stage = (w, files) => { for (const [f, c] of Object.entries(files)) w.repo.write(f, c); w.repo.git('add', '-A'); };
const commit = async (w, summary = 'c') => { stage(w, { [`${summary}.txt`]: `${summary}\n` }); return w.op('commit.create', { summary }); };

/** A cherry-pick of a conflicting commit, started with raw git (it does not touch the journal), stopped. */
function rawConflict(w) {
  w.repo.git('switch', '-q', '-c', 'side');
  const s = w.repo.commit({ 'f.txt': 'side\n' }, 'side');
  w.repo.git('switch', '-q', 'main');
  w.repo.commit({ 'f.txt': 'main\n' }, 'main');
  return () => assert.throws(() => w.repo.git('cherry-pick', s));
}

// Invariant: an undo and a redo refuse OPERATION_IN_PROGRESS while a cherry-pick is stopped, and the slots stay.
test('a stopped cherry-pick: undo and redo refuse OPERATION_IN_PROGRESS; nothing moves; the slots are kept', async (t) => {
  const w = await undoWorld(t);
  const start = rawConflict(w);
  await commit(w, 'one');
  start();
  const s = await w.state();
  const head = w.oid('HEAD');
  await assert.rejects(w.undo(), refused('OPERATION_IN_PROGRESS', { operation: 'cherry-pick' }));
  assert.equal(w.oid('HEAD'), head);
  assert.deepEqual(await w.state(), s);
  w.repo.git('cherry-pick', '--abort');
  await w.undo();
  w.repo.git('reset', '-q');
  start();
  const r = await w.state();
  await assert.rejects(w.redo(), refused('OPERATION_IN_PROGRESS'));
  assert.deepEqual(await w.state(), r);
});

// Invariant: unmerged entries with no operation in progress refuse CONFLICTED.
test('unmerged entries with no operation: CONFLICTED', async (t) => {
  const w = await undoWorld(t);
  const start = rawConflict(w);
  await commit(w, 'one');
  start();
  w.repo.git('cherry-pick', '--quit');
  await assert.rejects(w.undo(), refused('CONFLICTED'));
  assert.ok((await w.state()).undo);
});

// Invariant: a redo that deletes a branch now checked out in another worktree refuses BRANCH_CHECKED_OUT.
test('redo of a branch delete while that branch is checked out elsewhere: BRANCH_CHECKED_OUT', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'gone');
  await w.op('branch.delete', { names: ['gone'] });
  await w.undo();
  w.repo.git('worktree', 'add', '-q', path.join(w.repo.root, 'elsewhere'), 'gone');
  await assert.rejects(w.redo(), refused('BRANCH_CHECKED_OUT'));
  assert.equal(w.oid('gone'), w.base);
  assert.ok((await w.state()).redo, 'kept: removing the other checkout makes it runnable again');
});

// Invariant: moving a code-conductor/* HEAD needs the acknowledgement (head: true); with ccOwned it runs.
test('undo on a code-conductor/* HEAD: CC_OWNED_BRANCH head: true, then success with ccOwned', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'code-conductor/x');
  const before = w.oid('HEAD');
  await commit(w, 'one');
  await assert.rejects(w.undo(), refused('CC_OWNED_BRANCH', { head: true, branches: ['code-conductor/x'] }));
  assert.ok((await w.state()).undo);
  await w.undo({ ccOwned: true });
  assert.equal(w.oid('HEAD'), before);
});

// Invariant: a redo deleting a code-conductor/* branch needs the acknowledgement, as branch.delete does.
test('redo of deleting code-conductor/y needs ccOwned', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('branch', 'code-conductor/y');
  await w.op('branch.delete', { names: ['code-conductor/y'], ccOwned: true });
  await w.undo();
  await assert.rejects(w.redo(), refused('CC_OWNED_BRANCH', { branches: ['code-conductor/y'] }));
  assert.ok(w.exists('refs/heads/code-conductor/y'));
  await w.redo({ ccOwned: true });
  assert.equal(w.exists('refs/heads/code-conductor/y'), false);
});

// Invariant: an undo of a hard reset refuses DIRTY_WORKTREE over a changed tracked file and changes nothing.
test('undo of a hard reset on a dirty tree: DIRTY_WORKTREE, nothing changed', async (t) => {
  const w = await undoWorld(t);
  const two = w.repo.commit({ 'f.txt': 'two\n' }, 'two');
  await w.op('head.reset', { to: w.base, mode: 'hard', expect: two });
  w.repo.write('f.txt', 'new work\n');
  const before = w.snap();
  await assert.rejects(w.undo(), refused('DIRTY_WORKTREE'));
  assert.deepEqual(w.snap(), before);
});

// Invariant: a hard reset's undo never overwrites an untracked file standing where the old tree has one.
test('undo of a hard reset over an untracked file at a path it would write: CHECKOUT_CONFLICT, nothing changed', async (t) => {
  const w = await undoWorld(t);
  const two = w.repo.commit({ 'g.txt': 'tracked in two\n' }, 'two');
  await w.op('head.reset', { to: w.base, mode: 'hard', expect: two });
  w.repo.write('g.txt', 'my untracked work\n');
  const before = w.snap();
  await assert.rejects(w.undo(), refused('CHECKOUT_CONFLICT', { files: ['g.txt'] }));
  assert.deepEqual(w.snap(), before);
});

// Invariant: an undo of a checkout refuses CHECKOUT_CONFLICT over a local change the switch back would overwrite.
test('undo of a checkout over a conflicting local change: CHECKOUT_CONFLICT, nothing changed', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'feature');
  w.repo.commit({ 'f.txt': 'feature\n' }, 'feature');
  w.repo.git('switch', '-q', 'main');
  await w.op('branch.checkout', { ref: 'refs/heads/feature' });
  w.repo.write('f.txt', 'local edit\n');
  const before = w.snap();
  await assert.rejects(w.undo(), refused('CHECKOUT_CONFLICT'));
  assert.deepEqual(w.snap(), before);
  assert.ok((await w.state()).undo, 'kept: stash the edit and undo again');
});

// Invariant: a cherry-pick's undo (reset --keep) refuses CHECKOUT_CONFLICT over a local change to a file it rewrites.
test('undo of a cherry-pick over a local change to the picked file: CHECKOUT_CONFLICT naming it, nothing changed', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'side');
  const s = w.repo.commit({ 'p.txt': 'picked\n' }, 'p');
  w.repo.git('switch', '-q', 'main');
  await w.op('head.cherryPick', { oid: s });
  w.repo.write('p.txt', 'edited after\n');
  const before = w.snap();
  await assert.rejects(w.undo(), refused('CHECKOUT_CONFLICT', { files: ['p.txt'] }));
  assert.deepEqual(w.snap(), before);
});

// Invariant: a cherry-pick's redo refuses CHECKOUT_CONFLICT over an untracked file standing where the pick adds one.
test('redo of a cherry-pick over an untracked file where it adds one: CHECKOUT_CONFLICT naming it, the file kept', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('switch', '-q', '-c', 'side');
  const s = w.repo.commit({ 'added.txt': 'from the pick\n' }, 'adds');
  w.repo.git('switch', '-q', 'main');
  await w.op('head.cherryPick', { oid: s });
  await w.undo();
  w.repo.write('added.txt', 'mine, untracked\n');
  await assert.rejects(w.redo(), refused('CHECKOUT_CONFLICT', { files: ['added.txt'] }));
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'added.txt'), 'utf8'), 'mine, untracked\n');
  assert.ok((await w.state()).redo);
});

// Invariant: an undo of a discard refuses UNDO_STALE once a discarded file was edited again, and clears the slots.
test('undo of a discard after the file was edited again: UNDO_STALE, nothing restored', async (t) => {
  const w = await undoWorld(t);
  w.repo.write('f.txt', 'discard me\n');
  await w.op('stage.discardFiles', { tracked: ['f.txt'] });
  w.repo.write('f.txt', 'new edit\n');
  await assert.rejects(w.undo(), refused('UNDO_STALE'));
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'f.txt'), 'utf8'), 'new edit\n');
  assert.deepEqual(await w.state(), { undo: null, redo: null });
});

// Invariant: an undo never writes a restored file through an untracked symlink standing for its directory.
test('undo of a discard whose directory is now an untracked symlink: PATH_BLOCKED, nothing written', async (t) => {
  const w = await undoWorld(t);
  w.repo.write('u/new.txt', 'untracked\n');
  await w.op('stage.discardFiles', { untracked: ['u/new.txt'] });
  const outside = path.join(w.repo.root, 'outside');
  fs.mkdirSync(outside);
  fs.rmSync(path.join(w.repo.dir, 'u'), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(w.repo.dir, 'u'));
  await assert.rejects(w.undo(), refused('PATH_BLOCKED'));
  assert.deepEqual(fs.readdirSync(outside), []);
});

// Invariant: a plan that writes the worktree refuses BARE_REPO in a bare repository.
test('a bare repository: BARE_REPO', async (t) => {
  const repo = makeRepo(t);
  const seed = repo.commit({ 'a.txt': 'a\n' });
  const two = repo.commit({ 'a.txt': 'b\n' });
  const bareDir = path.join(repo.root, 'bare.git');
  repo.git('clone', '-q', '--bare', repo.dir, bareDir);
  const cc = await fakeCc({ projects: { bare: { dir: bareDir } }, home: repo.home });
  t.after(() => cc.close());
  const target = { project: 'bare', worktree: null };
  const journal = createJournal();
  const plan = { label: 'x', created: null, confirm: { undo: null, redo: null }, steps: [{ kind: 'head', mode: 'keep', old: { branch: 'refs/heads/main', oid: seed }, new: { branch: 'refs/heads/main', oid: two } }] };
  const entry = journal.recorded(target, journal.beforeWrite(target), 'head.cherryPick', plan);
  const def = getOp(OPS, 'undo.undo');
  const ctx = ctxFor(target, 'write', { op: 'undo.undo' });
  await assert.rejects(def.run(gitFor(ctx), def.params({ id: entry.id }), { target, journal }), refused('BARE_REPO'));
});

// Invariant: a step failing after an earlier step wrote carries appliedSteps, and the slots are cleared (the entry is half-run).
test('a failure after a step wrote: appliedSteps on the refusal, the slots cleared', async (t) => {
  const w = await undoWorld(t);
  await w.op('branch.create', { name: 'made', checkout: true });
  // Undo switches back to main (step one), then deletes `made` (step two): a reference-transaction hook rejects that delete.
  w.repo.hook('reference-transaction', '#!/bin/sh\n[ "$1" = prepared ] || exit 0\nwhile read old new ref; do [ "$ref" = refs/heads/made ] && exit 1; done\nexit 0\n');
  await assert.rejects(w.undo(), (e) => {
    assert.equal(e.code, 'GIT_FAILED');
    assert.equal(e.extra.appliedSteps, 1);
    return true;
  });
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/main');
  assert.ok(w.exists('refs/heads/made'));
  assert.deepEqual(await w.state(), { undo: null, redo: null });
});

/** A branch `gone` at base whose configured upstream reads `merge` (remote "."), deleted; the undo's result and execs. */
async function deletedWithUpstream(t, merge, setup = () => {}) {
  const w = await undoWorld(t);
  setup(w.repo);
  w.repo.git('branch', 'gone');
  fs.appendFileSync(path.join(w.repo.dir, '.git', 'config'), `[branch "gone"]\n\tremote = .\n\tmerge = ${merge}\n`);
  assert.equal(w.repo.git('for-each-ref', '--format=%(upstream)', 'refs/heads/gone'), merge);
  await w.op('branch.delete', { names: ['gone'], force: true });
  const from = w.cc.state.execCalls.length;
  const r = await w.undo();
  const argvs = w.cc.state.execCalls.slice(from).map((b) => b.argv.slice(1 + BASE_ARGS.length));
  return { w, r, argvs };
}

/** The commands of `argvs` that name `value` as an argument of their own. */
const naming = (argvs, value) => argvs.filter((a) => a.includes(value) || a.some((x) => x.endsWith(`=${value}`)));

// Invariant: an upstream read from repo config that is not a full refname (`--help`) is never looked up or set: the
// undo of a delete restores the branch and warns that it is not a ref name.
test('undo of a branch delete whose configured upstream is "--help": the branch back, a not-a-ref-name warning, no lookup', async (t) => {
  const { w, r, argvs } = await deletedWithUpstream(t, '--help');
  assert.equal(w.oid('gone'), w.base);
  assert.deepEqual(r.warnings, ["gone's upstream --help is not a ref name: not set"]);
  assert.deepEqual(naming(argvs, '--help'), [], 'no command named it');
  assert.throws(() => w.repo.git('config', '--get-regexp', '^branch\\.gone\\.'), 'no branch.gone.* config was written');
});

// Invariant: a full-refname upstream git will not track (a tag) is looked up, its `--set-upstream-to` refusal becomes a
// "could not be set" warning, and the undo still succeeds (the ref was already restored).
test('undo of a branch delete whose configured upstream is a tag: looked up, set refused, a could-not-be-set warning', async (t) => {
  const { w, r, argvs } = await deletedWithUpstream(t, 'refs/tags/v1', (repo) => repo.git('tag', 'v1'));
  assert.equal(w.oid('gone'), w.base);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^gone's upstream refs\/tags\/v1 could not be set: .*not a branch/);
  assert.equal(naming(argvs, 'refs/tags/v1').filter((a) => a[0] === 'for-each-ref').length, 1, 'looked up once');
  assert.equal(naming(argvs, 'refs/tags/v1').filter((a) => a[0] === 'branch').length, 1, 'set attempted once');
  assert.ok((await w.state()).redo, 'the undo succeeded');
});

// Invariant: a full-refname upstream that does not exist (`refs/foo`) is looked up, not set, and warned as gone.
test('undo of a branch delete whose configured upstream "refs/foo" does not exist: a no-longer-exists warning, not set', async (t) => {
  const { w, r, argvs } = await deletedWithUpstream(t, 'refs/foo');
  assert.equal(w.oid('gone'), w.base);
  assert.deepEqual(r.warnings, ["gone's upstream refs/foo no longer exists: not set"]);
  assert.equal(naming(argvs, 'refs/foo').filter((a) => a[0] === 'for-each-ref').length, 1, 'looked up once');
  assert.deepEqual(naming(argvs, 'refs/foo').filter((a) => a[0] === 'branch'), [], 'never set');
});

// Invariant: an upstream in a custom tracking namespace (fetch refspec `+refs/heads/*:refs/other/*`) is restored by the
// undo of a delete: branch.<b>.remote and .merge come back as they were.
test('undo of a branch delete restores an upstream in a custom tracking namespace (refs/other/main)', async (t) => {
  const w = await undoWorld(t);
  w.repo.git('remote', 'add', 'other', path.join(w.repo.root, 'origin.git'));
  w.repo.git('config', '--replace-all', 'remote.other.fetch', '+refs/heads/*:refs/other/*');
  w.repo.git('fetch', '-q', 'other');
  w.repo.git('branch', 'gone');
  w.repo.git('branch', '--set-upstream-to=refs/other/main', 'gone');
  assert.equal(w.repo.git('for-each-ref', '--format=%(upstream)', 'refs/heads/gone'), 'refs/other/main');
  const config = () => w.repo.git('config', '--get-regexp', '^branch\\.gone\\.');
  const before = config();
  await w.op('branch.delete', { names: ['gone'], force: true });
  const r = await w.undo();
  assert.deepEqual(r.warnings, []);
  assert.equal(config(), before);
  assert.equal(w.repo.git('for-each-ref', '--format=%(upstream)', 'refs/heads/gone'), 'refs/other/main');
});

// Invariant: a failure of `branch --set-upstream-to` itself (an upstream git will not track: refs/remotes/<r>/… with no
// remote <r>) is a warning, not a failure — the ref was already restored, and the entry moves to the redo slot.
test('undo of a branch delete whose upstream git refuses to track: the branch back, a warning, the entry in redo', async (t) => {
  const { w, r } = await (async () => {
    const world = await undoWorld(t);
    world.repo.git('update-ref', 'refs/remotes/nope/x', world.base);
    world.repo.git('branch', 'gone');
    fs.appendFileSync(path.join(world.repo.dir, '.git', 'config'), '[branch "gone"]\n\tremote = .\n\tmerge = refs/remotes/nope/x\n');
    await world.op('branch.delete', { names: ['gone'], force: true });
    return { w: world, r: await world.undo() };
  })();
  assert.equal(w.oid('gone'), w.base);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^gone's upstream refs\/remotes\/nope\/x could not be set: /);
  const s = await w.state();
  assert.equal(s.undo, null);
  assert.ok(s.redo, 'the undo succeeded: its entry is in the redo slot');
});

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})/;

// Invariant: every undo/redo command puts `--end-of-options` or `--` before an oid, ref or path it names (a same-argument
// `--opt=value` aside; rev-parse takes only hex-led revisions, `symbolic-ref -q` only a full `refs/` name, `stash store`
// only its final full oid, `config` a value after its key); never `git apply --index`; `reset --hard` only for a hard reset's plan, `reset --keep
// --end-of-options` for the commit-making ops' (cherry-pick, revert, merge, rebase); a url only as an argument of its
// own; no env beyond the base but GIT_INDEX_FILE (and READ_ENV on the attribute probe), no protected env; exec form A only.
test('argv scan over every undo and redo exec', async (t) => {
  const w = await undoWorld(t);
  const runs = [];
  const around = async (label, fn) => {
    const from = w.cc.state.execCalls.length;
    await fn();
    runs.push({ label, calls: w.cc.state.execCalls.slice(from) });
  };
  const both = (label) => around(label, async () => { await w.undo().catch((e) => { throw new Error(`${label}: ${e.message}`); }); await w.redo(); });
  const names = new Set(['f.txt', 'u.txt', 'l.txt', 'side', 'refs/heads/side', 'v1', 'refs/tags/v1', 'trunk', 'main', 'refs/heads/main', 'refs/heads/trunk', 'feature', 'refs/heads/feature', 'pickme', 'refs/heads/pickme', 'rb', 'refs/heads/rb']);
  w.repo.git('branch', 'feature');
  stage(w, { 'l.txt': 'l\n' });
  await w.op('commit.create', { summary: 'l' });
  await both('commit');
  await w.op('branch.create', { name: 'side' });
  await both('create');
  await w.op('branch.checkout', { ref: 'refs/heads/feature' });
  await both('checkout');
  w.repo.git('switch', '-q', 'main');
  await w.op('tag.create', { name: 'v1', oid: w.base, message: 'm' });
  await both('tag');
  await w.op('branch.rename', { name: 'main', newName: 'trunk' });
  await both('rename');
  w.repo.git('branch', '-m', 'trunk', 'main');
  w.repo.write('f.txt', 'x\n');
  w.repo.write('u.txt', 'u\n');
  await w.op('stage.discardFiles', { tracked: ['f.txt'], untracked: ['u.txt'] });
  await both('discard');
  const head = w.oid('HEAD');
  w.repo.write('f.txt', 'dirty\n');
  await w.op('head.reset', { to: w.base, mode: 'hard', expect: head });
  await both('hard');
  await w.op('head.reset', { to: head, mode: 'mixed', expect: w.base });
  await both('mixed');
  // Keep-mode plans: cherry-pick, revert, merge, rebase.
  w.repo.git('reset', '-q', '--hard');
  // From base, so the pick lands on another parent (with the fixed test dates it would otherwise be pk itself).
  w.repo.git('switch', '-q', '-c', 'pickme', w.base);
  const pk = w.repo.commit({ 'pk.txt': 'pk\n' }, 'pk');
  w.repo.git('switch', '-q', 'main');
  await w.op('head.cherryPick', { oid: pk });
  await both('cherry-pick');
  await w.op('head.revert', { oid: w.oid('HEAD') });
  await both('revert');
  const merged = await w.op('merge.start', { ref: 'refs/heads/pickme', oid: pk, mode: 'noFf', expect: w.oid('HEAD') });
  assert.equal(merged.outcome, 'merged');
  await both('merge');
  w.repo.git('switch', '-q', '-c', 'rb', w.base);
  const rb = w.repo.commit({ 'rb.txt': 'rb\n' }, 'rb');
  await w.op('rebase.start', { onto: w.oid('main'), upstream: w.base, expect: rb });
  await both('rebase');
  // The stash plans: worktree, stash and patch steps.
  w.repo.git('switch', '-q', 'main');
  w.repo.git('reset', '-q', '--hard');
  w.repo.write('f.txt', 'stash me\n');
  w.repo.write('u.txt', 'untracked\n');
  await w.op('stash.push', { includeUntracked: true });
  await both('stash push');
  const top = w.oid('refs/stash');
  await w.op('stash.rename', { oid: top, message: 'renamed' });
  await both('stash rename');
  const renamed = w.oid('refs/stash');
  await w.op('stash.applyFile', { oid: renamed, path: 'f.txt' });
  await both('stash applyFile');
  w.repo.git('checkout', '-q', 'f.txt');
  await w.op('stash.pop', { oid: renamed, index: true });
  await both('stash pop');
  w.repo.git('stash', 'push', '-q', '-u');
  await w.op('stash.drop', { oid: w.oid('refs/stash') });
  await both('stash drop');
  w.repo.write('f.txt', 'one\ntwo\n');
  const fd = await w.op('diff.file', { source: { kind: 'unstaged' }, path: 'f.txt', context: 3, whitespace: 'none' });
  const h = fd.hunks[0];
  await w.op('stash.pushLines', { path: 'f.txt', context: 3, hunks: [{ header: h.header, lines: h.lines.flatMap((l, i) => (l.kind === 'context' ? [] : [{ index: i, text: l.text }])) }] });
  await both('stash pushLines');
  w.repo.git('checkout', '-q', 'f.txt');
  await w.op('stash.branch', { oid: w.oid('refs/stash'), name: 'stashed-branch' });
  await both('stash branch');
  names.add('stashed-branch').add('refs/heads/stashed-branch').add('renamed');
  // The remote plans: remote and remoteRename steps, a credentialed url, the remove's refs step.
  await w.op('remote.add', { name: 'scanned', url: 'https://user:PW@example.invalid/one.git' });
  await both('remote add');
  await w.op('remote.edit', { name: 'scanned', url: 'https://user:PW@example.invalid/two.git' });
  await both('remote edit');
  await w.op('remote.rename', { name: 'scanned', newName: 'scanned2' });
  await both('remote rename');
  await w.op('remote.remove', { name: 'origin' });
  await both('remote remove');
  names.add('scanned').add('scanned2').add('origin');
  const keepLabels = ['cherry-pick', 'revert', 'merge', 'rebase'];
  for (const { label, calls } of runs) {
    assert.ok(calls.length, label);
    for (const body of calls) {
      const argv = body.argv.slice(1 + BASE_ARGS.length);
      const sub = argv[0];
      const stop = argv.findIndex((a) => a === '--end-of-options' || a === '--');
      argv.forEach((a, i) => {
        if (i === 0 || a.startsWith('-')) return;
        const named = OID.test(a) || names.has(a);
        if (!named) return;
        if (sub === 'rev-parse' && OID.test(a)) return;
        // symbolicTarget's `symbolic-ref -q <ref>` names a full refname, which can never read as an option.
        if (sub === 'symbolic-ref' && argv[1] === '-q' && a.startsWith('refs/')) return;
        // `stash store` takes no --end-of-options; its one argument is a full oid, which can never read as an option.
        if (sub === 'stash' && argv[1] === 'store' && OID.test(a) && i === argv.length - 1) return;
        // `git config` stops parsing options at its key: a value after the key is stored as given (probe-pinned).
        if (sub === 'config' && argv.findIndex((x, k) => k > 0 && !x.startsWith('-')) < i) return;
        assert.ok(stop !== -1 && stop < i, `${label}: ${argv.join(' ')}: ${a} before --end-of-options`);
      });
      assert.ok(!(sub === 'apply' && argv.includes('--index')), `${label}: never apply --index`);
      // A url only ever as an argument of its own: never `key=url`, never after `-c`.
      argv.forEach((a, i) => {
        if (!a.includes('://')) return;
        assert.match(a, /^[a-z][a-z0-9+.-]*:\/\//, `${label}: ${argv.join(' ')}: a url inside another argument`);
        assert.notEqual(argv[i - 1], '-c', `${label}: a url in a -c override`);
      });
      if (sub === 'reset' && argv.includes('--hard')) assert.equal(label, 'hard', `${label}: reset --hard only in a hard plan`);
      const own = Object.entries(body.env ?? {}).filter(([k, v]) => isProtectedEnv(k) && BASE_ENV[k] !== v);
      assert.deepEqual(own, [], `${label}: a protected env name set by the op`);
      const extra = Object.keys(body.env ?? {}).filter((k) => !(k in BASE_ENV));
      // runGit's attribute probe is a read: it carries READ_ENV.
      assert.ok(extra.every((k) => k === 'GIT_INDEX_FILE' || (sub === 'check-attr' && k in READ_ENV)), `${label}: ${argv.join(' ')}: env beyond the base: ${extra.join(', ')}`);
    }
  }
  for (const label of keepLabels) {
    const { calls } = runs.find((r) => r.label === label);
    const keeps = calls.map((b) => b.argv.slice(1 + BASE_ARGS.length)).filter((a) => a[0] === 'reset');
    assert.equal(keeps.length, 2, `${label}: one reset each way`);
    for (const a of keeps) assert.deepEqual(a.slice(0, 3), ['reset', '--keep', '--end-of-options'], `${label}: ${a.join(' ')}`);
  }
  assert.deepEqual(w.cc.state.violations, []);
});
