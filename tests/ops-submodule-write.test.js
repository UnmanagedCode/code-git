import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { LIMITS } from '../src/git/limits.js';
import { NET_CONFIG } from '../src/git/remote/net.js';
import { SUBMODULE_LIMITS } from '../src/git/submodule/limits.js';
import { afterBase, subWorld } from './_submodules.js';

// The submodule writes against real repos: what each changes, and what each refuses to change.

const byPathOf = (list) => Object.fromEntries(list.submodules.map((e) => [e.path, e]));
const gm = (w, key) => { const r = w.git('.', 'config', '-f', '.gitmodules', '--get', key); return r.status === 0 ? r.stdout.trim() : null; };
const local = (w, key, dir = '.') => { const r = w.git(dir, 'config', '--get', key); return r.status === 0 ? r.stdout.trim() : null; };
const headOf = (w, dir) => w.repo.git('-C', dir, 'rev-parse', 'HEAD');
const gitlink = (w, rev, p) => w.repo.git('rev-parse', `${rev}:${p}`);
const sub = (w, words) => w.execArgv().map(afterBase).filter((a) => words.every((x, i) => a[a.indexOf('submodule') + i] === x) && a.includes('submodule'));
const refusal = async (w, name, params, code, s) => {
  const r = await w.op(name, params, s);
  assert.equal(r.body.code, code, JSON.stringify(r.body));
  return r.body;
};

test('add writes .gitmodules and stages the gitlink (name, branch; a relative url against the default remote)', async (t) => {
  const w = await subWorld(t, { nested: false });
  assert.deepEqual(await w.ok('submodule.add', { url: w.urls.libA, path: 'libs/second', name: 'second', branch: 'main' }), { path: 'libs/second', name: 'second' });
  assert.equal(gm(w, 'submodule.second.path'), 'libs/second');
  assert.equal(gm(w, 'submodule.second.url'), w.urls.libA);
  assert.equal(gm(w, 'submodule.second.branch'), 'main');
  assert.match(w.repo.git('ls-files', '-s', '--', 'libs/second'), /^160000 /);
  assert.deepEqual(w.repo.git('diff', '--cached', '--name-only').split('\n'), ['.gitmodules', 'libs/second']);
  assert.ok(fs.existsSync(w.file('libs/second/a.txt')));
  const [add] = sub(w, ['submodule', 'add']);
  assert.deepEqual(add, [...NET_CONFIG, 'submodule', 'add', '--name', 'second', '-b', 'main', '--', w.urls.libA, 'libs/second']);
  // Relative: resolved by git against origin's url.
  w.repo.git('remote', 'add', 'origin', path.join(w.root, 'parent.git'));
  assert.deepEqual(await w.ok('submodule.add', { url: '../libA.git', path: 'rel' }), { path: 'rel', name: 'rel' });
  assert.equal(local(w, 'submodule.rel.url'), w.urls.libA);
});

test('add refuses SUBMODULE_EXISTS for an existing path, name or kept gitdir; a bad url, path or name before any exec', async (t) => {
  const w = await subWorld(t, { nested: false });
  assert.equal((await refusal(w, 'submodule.add', { url: w.urls.libA, path: 'libA' }, 'SUBMODULE_EXISTS')).reason, 'exists');
  await refusal(w, 'submodule.add', { url: w.urls.libA, path: 'other', name: 'libA' }, 'SUBMODULE_EXISTS');
  w.repo.write('tracked/x.txt', 'x\n');
  w.repo.git('add', 'tracked');
  await refusal(w, 'submodule.add', { url: w.urls.libA, path: 'tracked/x.txt' }, 'SUBMODULE_EXISTS');
  // On disk but not in the index: git would adopt it (a gitfile's repository included) instead of cloning.
  fs.mkdirSync(w.file('there'));
  fs.writeFileSync(w.file('there/.git'), `gitdir: ${path.join(w.root, 'libA-work', '.git')}\n`);
  w.repo.write('loose.txt', 'x\n');
  for (const p of ['there', 'loose.txt']) assert.equal((await refusal(w, 'submodule.add', { url: w.urls.libA, path: p }, 'SUBMODULE_EXISTS')).reason, 'exists', p);
  assert.equal(w.repo.git('ls-files', '--', 'there'), '');
  await w.ok('submodule.remove', { path: 'libA' });
  w.repo.git('commit', '-qm', 'rm libA');
  const kept = await refusal(w, 'submodule.add', { url: w.urls.libA, path: 'libA' }, 'SUBMODULE_EXISTS');
  assert.equal(kept.reason, 'gitdir');
  const before = w.execCalls().length;
  for (const [params, code] of [
    [{ url: 'ext::sh -c x', path: 'p' }, 'BAD_URL'], [{ url: '-oProxyCommand=x', path: 'p' }, 'BAD_URL'], [{ url: w.urls.libA, path: '../p' }, 'BAD_PATH'],
    [{ url: w.urls.libA, path: '.git/x' }, 'BAD_PATH'], [{ url: w.urls.libA, path: 'p', name: '../n' }, 'BAD_PARAMS'], [{ url: w.urls.libA, path: 'p', branch: '-b' }, 'BAD_REF'],
    [{ url: w.urls.libA, path: 'p', extra: 1 }, 'BAD_PARAMS'],
  ]) await refusal(w, 'submodule.add', params, code);
  assert.equal(w.execCalls().length, before);
});

test('init registers the URL without network', async (t) => {
  // No System file-transport opt-in: init would fail if it cloned.
  const w = await subWorld(t, { nested: false, populated: false, allowFile: false });
  assert.deepEqual(await w.ok('submodule.init', { paths: ['libA'] }), { submodules: [{ path: 'libA', resolvedUrl: w.urls.libA, urlProblem: null }] });
  assert.equal(local(w, 'submodule.libA.url'), w.urls.libA);
  assert.deepEqual(fs.readdirSync(w.file('libA')), []);
  assert.equal(w.execArgv().some((a) => a.includes('protocol.ext.allow=never')), false);
});

test('every write names a known, unblocked entry: SUBMODULE_UNKNOWN, SUBMODULE_UNSAFE', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('config', '-f', '.gitmodules', 'submodule.../evil.path', 'evil');
  for (const [name, params] of [['submodule.init', { paths: ['nope'] }], ['submodule.update', { paths: ['libA', 'nope'] }], ['submodule.sync', { paths: ['nope'] }],
    ['submodule.setUrl', { path: 'nope', url: w.urls.libA }], ['submodule.remove', { path: 'nope' }], ['submodule.commitPointer', { path: 'nope', expect: 'a'.repeat(40), summary: 's' }]]) {
    const b = await refusal(w, name, params, 'SUBMODULE_UNKNOWN');
    assert.equal(b.path, 'nope');
  }
  const b = await refusal(w, 'submodule.update', { paths: ['evil'] }, 'SUBMODULE_UNSAFE');
  assert.equal(b.reason, 'name');
  assert.equal(sub(w, ['submodule', 'update']).length, 0);
  assert.equal(sub(w, ['submodule', 'init']).length, 0);
});

test('update --recursive clones nested and checks out the recorded commit', async (t) => {
  const w = await subWorld(t, { populated: false });
  assert.deepEqual(await w.ok('submodule.update', { paths: ['libA'] }), { paths: ['libA'] });
  assert.equal(fs.readFileSync(w.file('libA/libB/b.txt'), 'utf8'), 'b\n');
  assert.equal(headOf(w, 'libA'), gitlink(w, 'HEAD', 'libA'));
  assert.equal(headOf(w, 'libA/libB'), w.repo.git('-C', 'libA', 'rev-parse', 'HEAD:libB'));
  const [up] = sub(w, ['submodule', 'update']);
  assert.deepEqual(up, [...NET_CONFIG, 'submodule', 'update', '--checkout', '--init', '--recursive', '--', 'libA']);
  assert.equal(sub(w, ['submodule']).some((a) => a.includes('--force') || a.includes('-f')), false);
});

test('update refuses SUBMODULE_COMMITS_AT_RISK for detached commits, succeeds with discardCommits; a branch commit is not at risk', async (t) => {
  const w = await subWorld(t, { nested: false });
  const recorded = gitlink(w, 'HEAD', 'libA');
  // As `submodule update` leaves it (`submodule add` leaves the clone on its branch).
  w.fx('libA', 'checkout', '-q', '--detach');
  w.repo.write('libA/a.txt', 'local\n');
  w.fx('libA', 'commit', '-qam', 'detached work');
  const moved = headOf(w, 'libA');
  const b = await refusal(w, 'submodule.update', { paths: ['libA'] }, 'SUBMODULE_COMMITS_AT_RISK');
  assert.deepEqual(b.paths, [{ path: 'libA', count: 1 }]);
  assert.equal(headOf(w, 'libA'), moved);
  assert.equal(sub(w, ['submodule', 'update']).length, 0);
  await w.ok('submodule.update', { paths: ['libA'], discardCommits: true });
  assert.equal(headOf(w, 'libA'), recorded);
  // On a branch the commit stays reachable: no refusal, the branch keeps it.
  w.fx('libA', 'checkout', '-q', '-b', 'work');
  w.repo.write('libA/a.txt', 'branch\n');
  w.fx('libA', 'commit', '-qam', 'branch work');
  const onBranch = headOf(w, 'libA');
  await w.ok('submodule.update', { paths: ['libA'] });
  assert.equal(headOf(w, 'libA'), recorded);
  assert.equal(w.repo.git('-C', 'libA', 'rev-parse', 'work'), onBranch);
});

test('update over a conflicting local change → SUBMODULE_DIRTY, changes intact', async (t) => {
  const w = await subWorld(t, { nested: false });
  const old = headOf(w, 'libA');
  const next = w.advance('libA', { 'a.txt': 'upstream\n' });
  // The parent records `next`; libA is still at `old`, with a local change to the file `next` changes.
  w.fx('libA', 'fetch', '-q');
  w.fx('libA', 'checkout', '-q', next);
  w.repo.git('add', 'libA');
  w.repo.git('commit', '-qm', 'bump libA');
  w.fx('libA', 'checkout', '-q', old);
  w.repo.write('libA/a.txt', 'mine\n');
  const b = await refusal(w, 'submodule.update', { paths: ['libA'] }, 'SUBMODULE_DIRTY');
  assert.match(b.stderr, /overwritten by checkout/);
  assert.equal(fs.readFileSync(w.file('libA/a.txt'), 'utf8'), 'mine\n');
  assert.equal(headOf(w, 'libA'), old);
});

test('sync rewrites the URL (and refuses a .gitmodules url code-git does not clone from)', async (t) => {
  const w = await subWorld(t, { nested: false });
  const mirror = path.join(w.root, 'mirror.git');
  w.fx(w.root, 'clone', '-q', '--bare', w.urls.libA, mirror);
  w.repo.git('config', '-f', '.gitmodules', 'submodule.libA.url', mirror);
  await w.ok('submodule.sync', { paths: ['libA'] });
  assert.equal(local(w, 'submodule.libA.url'), mirror);
  assert.equal(local(w, 'remote.origin.url', 'libA'), mirror);
  assert.deepEqual(sub(w, ['submodule', 'sync'])[0], ['submodule', 'sync', '--recursive', '--', 'libA']);
  w.repo.git('config', '-f', '.gitmodules', 'submodule.libA.url', 'ext::sh -c x');
  const b = await refusal(w, 'submodule.sync', { paths: ['libA'] }, 'SUBMODULE_UNSAFE');
  assert.deepEqual([b.reason, b.names], ['url', ['libA']]);
  assert.equal(local(w, 'submodule.libA.url'), mirror);
});

test('setUrl edits .gitmodules and syncs; a bad url is refused before any exec', async (t) => {
  const w = await subWorld(t, { nested: false });
  const mirror = path.join(w.root, 'mirror.git');
  w.fx(w.root, 'clone', '-q', '--bare', w.urls.libA, mirror);
  assert.deepEqual(await w.ok('submodule.setUrl', { path: 'libA', url: mirror }), { path: 'libA', url: mirror });
  assert.equal(gm(w, 'submodule.libA.url'), mirror);
  assert.equal(local(w, 'submodule.libA.url'), mirror);
  assert.equal(local(w, 'remote.origin.url', 'libA'), mirror);
  assert.equal(w.repo.git('diff', '--name-only', '--', '.gitmodules'), '.gitmodules');
  const before = w.execCalls().length;
  await refusal(w, 'submodule.setUrl', { path: 'libA', url: 'fd::3' }, 'BAD_URL');
  assert.equal(w.execCalls().length, before);
  // Not initialized: .gitmodules only.
  w.unclone();
  await w.ok('submodule.setUrl', { path: 'libA', url: '../elsewhere.git' });
  assert.equal(gm(w, 'submodule.libA.url'), '../elsewhere.git');
  assert.equal(local(w, 'submodule.libA.url'), null);
});

test('a symlinked .gitmodules is refused before add, setUrl or remove writes through it', async (t) => {
  const w = await subWorld(t, { nested: false });
  const outside = path.join(w.root, 'outside-gitmodules');
  fs.renameSync(w.file('.gitmodules'), outside);
  fs.symlinkSync(outside, w.file('.gitmodules'));
  const before = fs.readFileSync(outside, 'utf8');
  for (const [name, params] of [['submodule.add', { url: w.urls.libA, path: 'x' }], ['submodule.setUrl', { path: 'libA', url: w.urls.libA }], ['submodule.remove', { path: 'libA' }]]) {
    assert.equal((await refusal(w, name, params, 'SUBMODULE_UNSAFE')).reason, 'gitmodules');
  }
  assert.equal(fs.readFileSync(outside, 'utf8'), before);
});

test('remove refuses SUBMODULE_DIRTY when modified/untracked/orphaned/staged; discard removes; keeps .git/modules', async (t) => {
  const w = await subWorld(t, { nested: false });
  const facts = async () => {
    const b = await refusal(w, 'submodule.remove', { path: 'libA' }, 'SUBMODULE_DIRTY');
    return { modified: b.modified, untracked: b.untracked, orphaned: b.orphaned, staged: b.staged, gitmodules: b.gitmodules };
  };
  const none = { modified: false, untracked: false, orphaned: 0, staged: false, gitmodules: false };
  w.repo.write('libA/a.txt', 'changed\n');
  assert.deepEqual(await facts(), { ...none, modified: true });
  w.fx('libA', 'checkout', '-q', '--', 'a.txt');
  w.repo.write('libA/new.txt', 'n\n');
  assert.deepEqual(await facts(), { ...none, untracked: true });
  fs.rmSync(w.file('libA/new.txt'));
  w.fx('libA', 'checkout', '-q', '--detach');
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'detached');
  assert.deepEqual(await facts(), { ...none, orphaned: 1 });
  w.repo.git('add', 'libA');
  assert.deepEqual(await facts(), { ...none, orphaned: 0, staged: true });
  assert.equal(sub(w, ['submodule', 'deinit']).length, 0);
  assert.ok(fs.existsSync(w.file('libA/a.txt')));
  assert.deepEqual(await w.ok('submodule.remove', { path: 'libA', discard: true }), { path: 'libA', name: 'libA' });
  assert.equal(fs.existsSync(w.file('libA')), false);
  assert.equal(w.repo.git('ls-files', '--', 'libA'), '');
  assert.equal(gm(w, 'submodule.libA.path'), null);
  assert.match(w.repo.git('diff', '--cached', '--name-only'), /^\.gitmodules$/m);
  assert.ok(fs.existsSync(w.file('.git/modules/libA')));
  assert.deepEqual(sub(w, ['submodule', 'deinit']), [['submodule', 'deinit', '-f', '--', 'libA']]);
});

test('remove refuses SUBMODULE_DIRTY {gitmodules} over unstaged .gitmodules changes; discard stages them with the removal', async (t) => {
  const w = await subWorld(t, { nested: false });
  await w.ok('submodule.add', { url: w.urls.libA, path: 'two' });
  w.repo.git('commit', '-qm', 'add two');
  w.repo.git('config', '-f', '.gitmodules', 'submodule.two.url', '../edited.git');
  const b = await refusal(w, 'submodule.remove', { path: 'libA' }, 'SUBMODULE_DIRTY');
  assert.deepEqual([b.gitmodules, b.modified, b.untracked, b.orphaned, b.staged], [true, false, false, 0, false]);
  assert.equal(w.repo.git('diff', '--name-only'), '.gitmodules');
  await w.ok('submodule.remove', { path: 'libA', discard: true });
  assert.equal(w.repo.git('diff', '--name-only'), '');
  assert.equal(gm(w, 'submodule.libA.path'), null);
  assert.equal(w.repo.git('show', ':.gitmodules').includes('../edited.git'), true);
});

/** A `.gitmodules` section for `name` with no gitlink anywhere, committed. */
function declareOnly(w, name) {
  w.repo.git('config', '-f', '.gitmodules', `submodule.${name}.path`, name);
  w.repo.git('config', '-f', '.gitmodules', `submodule.${name}.url`, w.urls.libA);
  w.repo.git('commit', '-qam', `declare ${name}`);
}

test('an entry with no gitlink in the index: init, update and sync refuse SUBMODULE_NOT_RECORDED before any submodule command', async (t) => {
  const w = await subWorld(t, { nested: false });
  declareOnly(w, 'ghost');
  w.repo.git('rm', '-q', '--cached', 'libA');
  for (const name of ['submodule.init', 'submodule.update', 'submodule.sync']) {
    const b = await refusal(w, name, { paths: ['libA', 'ghost'] }, 'SUBMODULE_NOT_RECORDED');
    assert.deepEqual(b.paths, ['libA', 'ghost'], name);
  }
  assert.equal(sub(w, ['submodule']).length, 0);
  const list = byPathOf(await w.ok('submodule.list'));
  assert.deepEqual([list.ghost.recorded, list.ghost.committed, list.libA.recorded, list.libA.committed !== null], [null, null, null, true]);
});

test('remove of a declared-only entry drops its .gitmodules section (and the config init wrote), stages .gitmodules, runs no deinit or rm', async (t) => {
  const w = await subWorld(t, { nested: false });
  declareOnly(w, 'ghost');
  w.repo.git('config', 'submodule.ghost.url', w.urls.libA);
  assert.deepEqual(await w.ok('submodule.remove', { path: 'ghost' }), { path: 'ghost', name: 'ghost' });
  assert.equal(gm(w, 'submodule.ghost.path'), null);
  assert.equal(gm(w, 'submodule.libA.path'), 'libA');
  assert.equal(local(w, 'submodule.ghost.url'), null);
  assert.deepEqual(w.repo.git('diff', '--cached', '--name-only').split('\n'), ['.gitmodules']);
  assert.equal(w.repo.git('diff', '--name-only'), '');
  assert.equal(w.execArgv().map(afterBase).some((a) => a[0] === 'rm' || (a[0] === 'submodule' && a[1] === 'deinit')), false);
});

test('remove of a gitlink in HEAD but not in the index (git rm --cached): gated as any submodule, ends as a staged deletion, the directory removed; a refusal leaves the index as it was', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('rm', '-q', '--cached', 'libA');
  w.repo.write('libA/a.txt', 'changed\n');
  const b = await refusal(w, 'submodule.remove', { path: 'libA' }, 'SUBMODULE_DIRTY');
  assert.equal(b.modified, true);
  assert.equal(w.repo.git('ls-files', '--', 'libA'), '', 'the entry put back for the gate is taken out again');
  assert.equal(fs.readFileSync(w.file('libA/a.txt'), 'utf8'), 'changed\n');
  w.fx('libA', 'checkout', '-q', '--', 'a.txt');
  await w.ok('submodule.remove', { path: 'libA' });
  assert.equal(fs.existsSync(w.file('libA/a.txt')), false);
  assert.equal(w.repo.git('ls-files', '--', 'libA'), '');
  assert.deepEqual(w.repo.git('diff', '--cached', '--name-status').split('\n'), ['M\t.gitmodules', 'D\tlibA']);
  assert.ok(fs.existsSync(w.file('.git/modules/libA')));
});

test('remove of a declared-only entry whose directory holds a clone refuses SUBMODULE_NOT_RECORDED and leaves it', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.fx('.', 'clone', '-q', w.urls.libA, 'loose');
  declareOnly(w, 'loose');
  const b = await refusal(w, 'submodule.remove', { path: 'loose' }, 'SUBMODULE_NOT_RECORDED');
  assert.deepEqual(b.paths, ['loose']);
  assert.ok(fs.existsSync(w.file('loose/a.txt')));
  assert.equal(gm(w, 'submodule.loose.path'), 'loose');
});

test('remove of a clean submodule needs no discard and passes no -f', async (t) => {
  const w = await subWorld(t, { nested: false });
  await w.ok('submodule.remove', { path: 'libA' });
  assert.equal(w.repo.git('ls-files', '--', 'libA'), '');
  assert.equal(w.execArgv().map(afterBase).some((a) => (a[0] === 'rm' || a[1] === 'deinit') && a.includes('-f')), false);
});

test('commitPointer commits only the gitlink, leaves other staged changes staged, refuses SUBMODULE_POINTER_MOVED', async (t) => {
  const w = await subWorld(t, { nested: false });
  const parentHead = w.repo.git('rev-parse', 'HEAD');
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved');
  const head = headOf(w, 'libA');
  w.repo.write('staged.txt', 's\n');
  w.repo.git('add', 'staged.txt');
  await refusal(w, 'submodule.commitPointer', { path: 'libA', expect: parentHead, summary: 'x' }, 'SUBMODULE_POINTER_MOVED');
  assert.equal(w.repo.git('rev-parse', 'HEAD'), parentHead);
  const { oid } = await w.ok('submodule.commitPointer', { path: 'libA', expect: head, summary: 'Update submodule libA', description: 'why' });
  assert.equal(oid, w.repo.git('rev-parse', 'HEAD'));
  assert.equal(w.repo.git('show', '--format=', '--name-only', 'HEAD'), 'libA');
  assert.equal(w.repo.git('log', '-1', '--format=%B'), 'Update submodule libA\n\nwhy');
  assert.equal(gitlink(w, 'HEAD', 'libA'), head);
  assert.equal(w.repo.git('diff', '--cached', '--name-only'), 'staged.txt');
  // Already committed: nothing to do.
  await refusal(w, 'submodule.commitPointer', { path: 'libA', expect: head, summary: 'x' }, 'NOTHING_TO_COMMIT');
  for (const params of [{ path: 'libA', expect: 'HEAD', summary: 's' }, { path: 'libA', expect: head, summary: '' }, { path: 'libA', expect: head, summary: 'a\nb' }]) {
    assert.equal((await w.op('submodule.commitPointer', params)).status, 400);
  }
});

test('commitPointer commits exactly expect: a submodule HEAD moved between the check and the commit is not what lands', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'seen');
  const seen = headOf(w, 'libA');
  w.repo.write('staged.txt', 's\n');
  w.repo.git('add', 'staged.txt');
  // Hold the first command after the gate (the temporary index's read-tree), move libA meanwhile, then let it run.
  w.cc.state.execHook = (b) => (b.argv.includes('read-tree') ? 'hold' : undefined);
  const pending = w.op('submodule.commitPointer', { path: 'libA', expect: seen, summary: 'Update submodule libA' });
  const held = await w.cc.nextHeld();
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved after the check');
  const moved = headOf(w, 'libA');
  assert.notEqual(moved, seen);
  w.cc.state.execHook = null;
  held.release();
  const r = await pending;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(gitlink(w, 'HEAD', 'libA'), seen);
  assert.equal(w.repo.git('show', '--format=', '--name-only', 'HEAD'), 'libA');
  // The real index holds the committed pointer (no staged revert), the other staged change is still staged, and the
  // submodule's newer HEAD shows as a change in the working tree.
  assert.equal(w.repo.git('rev-parse', ':libA'), seen);
  assert.equal(w.repo.git('diff', '--cached', '--name-only'), 'staged.txt');
  assert.equal(w.repo.git('diff', '--name-only', '--ignore-submodules=none'), 'libA');
});

test('commitPointer runs the commit hooks, and works on a parent with no commit yet', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.hook('pre-commit', `#!/bin/sh\ntouch '${w.marker('pre-commit')}'\n`);
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved');
  await w.ok('submodule.commitPointer', { path: 'libA', expect: headOf(w, 'libA'), summary: 's' });
  assert.deepEqual(w.markers(), ['pre-commit']);
  // An unborn HEAD (a new orphan branch): the root commit holds the gitlink alone, as commit --only would.
  w.repo.git('checkout', '-q', '--orphan', 'fresh');
  const head = headOf(w, 'libA');
  await w.ok('submodule.commitPointer', { path: 'libA', expect: head, summary: 'root' });
  assert.equal(w.repo.git('ls-tree', '--name-only', 'HEAD'), 'libA');
  assert.equal(w.repo.git('rev-list', '--count', 'HEAD'), '1');
  assert.equal(gitlink(w, 'HEAD', 'libA'), head);
});

/** A conflicting `side` branch: `conflict.txt` differs from main's. */
function conflictingBranch(w) {
  w.repo.commit({ 'conflict.txt': 'base\n' }, 'base for conflict');
  w.repo.branch('side');
  w.repo.commit({ 'conflict.txt': 'side\n' }, 'side');
  w.repo.checkout('main');
  w.repo.commit({ 'conflict.txt': 'main\n' }, 'main');
  return w.repo.git('rev-parse', 'side');
}

test('commitPointer refuses OPERATION_IN_PROGRESS during a stopped merge, cherry-pick or revert, or a rebase: nothing changes', async (t) => {
  for (const [operation, start] of [
    ['merge', (w) => w.git('.', 'merge', '-q', 'side')],
    ['cherry-pick', (w, side) => w.git('.', 'cherry-pick', side)],
    ['revert', (w) => { w.repo.commit({ 'conflict.txt': 'later\n' }, 'later'); return w.git('.', 'revert', '--no-edit', 'HEAD~1'); }],
    ['rebase', (w) => w.git('.', 'rebase', '-q', 'side')],
  ]) {
    const w = await subWorld(t, { nested: false });
    const side = conflictingBranch(w);
    assert.notEqual(start(w, side).status, 0, `${operation} stops on its conflict`);
    w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved');
    const index = fs.readFileSync(w.file('.git/index'));
    const head = w.repo.git('rev-parse', 'HEAD');
    const b = await refusal(w, 'submodule.commitPointer', { path: 'libA', expect: headOf(w, 'libA'), summary: 's' }, 'OPERATION_IN_PROGRESS');
    assert.equal(b.operation, operation);
    assert.match(b.error, /finish or abort it first/);
    assert.deepEqual(fs.readFileSync(w.file('.git/index')), index, operation);
    assert.equal(w.repo.git('rev-parse', 'HEAD'), head, operation);
    assert.equal(w.execArgv().map(afterBase).some((a) => a[0] === 'read-tree' || a[0] === 'commit'), false, operation);
    if (operation !== 'rebase') assert.equal(w.git('.', 'rev-parse', '-q', '--verify', { merge: 'MERGE_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD', revert: 'REVERT_HEAD' }[operation]).status, 0);
    else assert.ok(fs.existsSync(w.file('.git/rebase-merge')) || fs.existsSync(w.file('.git/rebase-apply')));
  }
});

test('long ops use cloneTimeoutMs; the others the write default', async (t) => {
  const w = await subWorld(t, { nested: false });
  await w.ok('submodule.add', { url: w.urls.libA, path: 'two' });
  await w.ok('submodule.update', { paths: ['libA'] });
  await w.ok('submodule.sync', { paths: ['libA'] });
  await w.ok('submodule.init', { paths: ['libA'] });
  const of = (words) => w.execCalls().find((b) => words.every((x, i) => afterBase(b.argv)[afterBase(b.argv).indexOf('submodule') + i] === x));
  for (const words of [['submodule', 'add'], ['submodule', 'update']]) {
    assert.equal(of(words).timeoutMs, SUBMODULE_LIMITS.cloneTimeoutMs, words.join(' '));
    assert.equal(of(words).maxOutputBytes, SUBMODULE_LIMITS.cloneMaxOutputBytes, words.join(' '));
  }
  for (const words of [['submodule', 'sync'], ['submodule', 'init']]) assert.equal(of(words).timeoutMs, LIMITS.write.timeoutMs, words.join(' '));
});
