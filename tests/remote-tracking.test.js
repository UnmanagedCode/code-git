import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { push } from '../src/git/remote/push.js';
import {
  assertFetchDestinations, assertNoTrackingSymrefs, destinationNamespaces, fetchSpecs, hasUrl, inDestinations, isHeadAlias, legacyRemoteFile,
  newlyLiveSymrefs, parseFetchRefspec, trackedSnapshot, trackingRefsFor,
} from '../src/git/remote/tracking.js';
import { ctxFor, gitFor } from './_ctx.js';
import { refsWorld, refused } from './_refsWorld.js';

// A push updates the tracking ref the remote's *configured* fetch refspecs map each branch to (git's
// remote_find_tracking), so push() maps through them before checking for a symbolic ref.

const specs = (...list) => list.map((s) => parseFetchRefspec('origin', s));

test('trackingRefsFor: wildcard and exact refspecs map, a negative refspec excludes nothing, a store-less refspec maps nothing', () => {
  assert.deepEqual(trackingRefsFor(specs('+refs/heads/*:refs/remotes/origin/*'), 'refs/heads/a/b'), ['refs/remotes/origin/a/b']);
  assert.deepEqual(trackingRefsFor(specs('refs/heads/*:refs/remotes/other/*'), 'refs/heads/x'), ['refs/remotes/other/x']);
  assert.deepEqual(trackingRefsFor(specs('refs/heads/*-wip:refs/wip/*'), 'refs/heads/topic-wip'), ['refs/wip/topic']);
  assert.deepEqual(trackingRefsFor(specs('+refs/heads/x:refs/remotes/pinned/x'), 'refs/heads/x'), ['refs/remotes/pinned/x']);
  assert.deepEqual(trackingRefsFor(specs('+refs/heads/x:refs/remotes/pinned/x'), 'refs/heads/y'), []);
  assert.deepEqual(trackingRefsFor(specs('+refs/heads/*:refs/remotes/origin/*', '+refs/heads/*:refs/remotes/mirror/*'), 'refs/heads/x'),
    ['refs/remotes/origin/x', 'refs/remotes/mirror/x']);
  // Negative refspecs are parsed but exclude nothing: git's push-time tracking update ignores them.
  assert.deepEqual(trackingRefsFor(specs('+refs/heads/*:refs/remotes/origin/*', '^refs/heads/x'), 'refs/heads/x'), ['refs/remotes/origin/x']);
  assert.deepEqual(trackingRefsFor(specs('+refs/heads/*:refs/remotes/origin/*', '^refs/heads/sec*'), 'refs/heads/secret'), ['refs/remotes/origin/secret']);
  assert.deepEqual(trackingRefsFor(specs('refs/heads/main'), 'refs/heads/main'), []);
  assert.deepEqual(trackingRefsFor([], 'refs/heads/main'), []);
});

test('parseFetchRefspec fails closed (REMOTE_CONFIG_UNSUPPORTED with remote and refspec) on every shape it does not map with confidence', () => {
  for (const bad of ['', 'refs/heads/*:refs/remotes/x/*/*', 'refs/heads/*/*:refs/remotes/x/*/*', 'refs/heads/*:refs/remotes/x/y',
    'refs/heads/x:refs/remotes/*', 'heads/*:refs/remotes/x/*', 'main:refs/remotes/origin/main', 'refs/heads/*:remotes/x/*',
    'a:b:c', '^refs/heads/x:refs/y', '^heads/x', '^refs/*/*', 'refs/heads/* :refs/x/*', ':']) {
    assert.throws(() => parseFetchRefspec('origin', bad), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin', refspec: bad }), JSON.stringify(bad));
  }
});

/** refsWorld with `doomed` on origin and fetched; `refs/remotes/<alias>` made a symbolic ref to the checked-out cc branch. */
async function aliasWorld(t, fetchSpecsList, alias) {
  const w = await refsWorld(t);
  const wt = w.worktree('wt', 'code-conductor/wt');
  w.repo.git('push', '-q', 'origin', 'main:doomed');
  w.repo.git('config', '--unset-all', 'remote.origin.fetch');
  for (const s of fetchSpecsList) w.repo.git('config', '--add', 'remote.origin.fetch', s);
  w.repo.git('fetch', '-q', 'origin');
  if (alias) {
    if (w.exists(`refs/remotes/${alias}`)) w.repo.git('update-ref', '-d', `refs/remotes/${alias}`);
    w.repo.git('symbolic-ref', `refs/remotes/${alias}`, 'refs/heads/code-conductor/wt');
  }
  const intact = () => {
    assert.equal(w.oid('refs/heads/code-conductor/wt'), w.base, 'the cc branch survives');
    assert.equal(w.repo.git('-C', wt.dir, 'symbolic-ref', 'HEAD'), 'refs/heads/code-conductor/wt');
  };
  const pushed = () => w.argvs().some((a) => a[0] === 'push');
  return { w, intact, pushed };
}

test('a custom fetch refspec mapping to other/*: the symbolic other/doomed refuses the remote delete; origin/doomed is not what git writes', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/other/*'], 'other/doomed');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }), refused('SYMBOLIC_REF', { target: 'refs/heads/code-conductor/wt' }));
  intact();
  assert.equal(pushed(), false, 'no push ran');
  assert.equal(w.origin.git('rev-parse', 'refs/heads/doomed'), w.base);
});

test('two fetch refspecs, one mapping the branch to a symbolic ref: refused, no push', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*', '+refs/heads/*:refs/remotes/mirror/*'], 'mirror/doomed');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }), refused('SYMBOLIC_REF'));
  intact();
  assert.equal(pushed(), false);
});

test('an exact (non-wildcard) fetch refspec maps its one branch: a symbolic destination refuses, no push', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/doomed:refs/remotes/pinned/doomed'], 'pinned/doomed');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }), refused('SYMBOLIC_REF'));
  intact();
  assert.equal(pushed(), false);
});

test('a negative fetch refspec naming the branch does not stop git writing its tracking ref: still refused, no push', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*', '^refs/heads/doomed'], 'origin/doomed');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }), refused('SYMBOLIC_REF', { target: 'refs/heads/code-conductor/wt' }));
  intact();
  assert.equal(pushed(), false);
});

test('a fetch refspec that stores nothing for the branch maps nothing: the delete runs and the cc branch survives a symbolic origin/<b>', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/main:refs/remotes/origin/main'], 'origin/doomed');
  const r = await w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] });
  assert.deepEqual(r.deleted, ['doomed']);
  assert.equal(pushed(), true);
  intact();
  assert.equal(w.repo.git('symbolic-ref', 'refs/remotes/origin/doomed'), 'refs/heads/code-conductor/wt', 'git did not touch the unmapped ref');
  assert.deepEqual(r.undo.remoteRefs, [{ remote: 'origin', ref: 'refs/heads/doomed', old: null, new: null, tracking: null }]);
});

test('an unparseable fetch refspec: REMOTE_CONFIG_UNSUPPORTED and no push; tag pushes do not read it', async (t) => {
  const { w, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*'], null);
  // A refspec git accepts (a short source, DWIM-expanded by fetch) but code-git does not map with confidence. One git
  // itself refuses (two stars) fails earlier, in `git remote`, as GIT_FAILED.
  w.repo.git('config', '--add', 'remote.origin.fetch', 'doomed:refs/remotes/short/doomed');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }),
    refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin', refspec: 'doomed:refs/remotes/short/doomed' }));
  assert.equal(pushed(), false);
  w.repo.git('tag', 'v1', w.base);
  assert.deepEqual((await w.op('tag.push', { remote: 'origin', names: ['v1'] })).pushed, ['v1']);
});

test('the default fetch refspec behaves as before: a plain delete runs and its undo names origin/<b>; a symbolic origin/<b> refuses', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*'], null);
  const r = await w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] });
  assert.deepEqual(r.undo.remoteRefs, [{ remote: 'origin', ref: 'refs/heads/doomed', old: w.base, new: null, tracking: 'refs/remotes/origin/doomed' }]);
  assert.equal(w.exists('refs/remotes/origin/doomed'), false);
  assert.equal(pushed(), true);
  w.repo.git('push', '-q', 'origin', 'main:doomed2');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/doomed2', 'refs/heads/code-conductor/wt');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed2'] }), refused('SYMBOLIC_REF'));
  intact();
});

test('a plain branch push through push() under a custom mapping: a symbolic other/<b> refuses before the push, its target untouched', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/other/*'], 'other/x');
  w.repo.git('branch', 'x');
  const git = gitFor(ctxFor({ project: 'repo' }, 'write', { op: 'test.push', cancellable: true }));
  await assert.rejects(push(git, 'origin', ['refs/heads/x:refs/heads/x']), refused('SYMBOLIC_REF', { target: 'refs/heads/code-conductor/wt' }));
  intact();
  assert.equal(pushed(), false);
});

test('hasUrl counts only non-empty url values after the last empty one, as git does', () => {
  assert.equal(hasUrl(['../o.git']), true);
  assert.equal(hasUrl([]), false);
  assert.equal(hasUrl(['']), false);
  assert.equal(hasUrl(['../o.git', '']), false, 'an empty value clears the list');
  assert.equal(hasUrl(['', '../o.git']), true);
  // Only the *last* empty value counts as the reset.
  assert.equal(hasUrl(['a', '', 'b', '']), false);
  assert.equal(hasUrl(['a', '', 'b']), true);
});

test('legacyRemoteFile refuses a name that is not a valid remote nick before splicing it into --git-path: null, and no command runs', async () => {
  const calls = [];
  const git = async (args) => { calls.push(args); return { exitCode: 0, stdout: Buffer.from('.git/remotes/x\n'), stderr: Buffer.alloc(0) }; };
  for (const name of ['../x', 'a/b', '.', '..', '']) assert.equal(await legacyRemoteFile(git, name), null, JSON.stringify(name));
  assert.deepEqual(calls, []);
  // A valid nick does go through rev-parse --git-path and hash-object (the fake answers as if the file exists).
  assert.equal(await legacyRemoteFile(git, 'origin'), 'remotes/origin');
  assert.deepEqual(calls.map((a) => a.slice(0, 2)), [['rev-parse', '--git-path'], ['hash-object', '--no-filters']]);
});

/** Writes a legacy remote file (`remotes` or `branches`) in the repo's git dir. */
const legacy = (w, dir, name, body) => {
  fs.mkdirSync(path.join(w.repo.dir, '.git', dir), { recursive: true });
  fs.writeFileSync(path.join(w.repo.dir, '.git', dir, name), body);
};

test('an empty url makes git read a legacy .git/remotes file: refused (REMOTE_CONFIG_UNSUPPORTED), no push, the cc branch survives', async (t) => {
  const { w, intact, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*'], 'origin/doomed');
  w.repo.git('config', '--unset-all', 'remote.origin.fetch');
  w.repo.git('config', '--replace-all', 'remote.origin.url', '');
  legacy(w, 'remotes', 'origin', `URL: ${w.origin.dir}\nPull: refs/heads/*:refs/remotes/origin/*\n`);
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin', refspec: null }));
  intact();
  assert.equal(pushed(), false);
  assert.equal(w.origin.git('rev-parse', 'refs/heads/doomed'), w.base);
});

/** A push-only remote `po`: pushurl = the bare origin, its own fetch refspec, no url. */
function pushOnly(w) {
  w.repo.git('config', 'remote.po.pushurl', w.origin.dir);
  w.repo.git('config', 'remote.po.fetch', '+refs/heads/*:refs/remotes/po/*');
}

test('a push-only remote (pushurl, fetch, no url) with no legacy file works: its tracking ref is mapped, checked and named in the undo', async (t) => {
  const { w, intact } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*'], null);
  pushOnly(w);
  w.repo.git('update-ref', 'refs/remotes/po/doomed', w.base);
  const r = await w.op('branch.deleteRemote', { remote: 'po', branches: ['doomed'] });
  assert.deepEqual(r.deleted, ['doomed']);
  assert.deepEqual(r.undo.remoteRefs, [{ remote: 'po', ref: 'refs/heads/doomed', old: w.base, new: null, tracking: 'refs/remotes/po/doomed' }]);
  assert.equal(w.exists('refs/remotes/po/doomed'), false);
  // Checked too: a symbolic po/<b> refuses.
  w.repo.git('push', '-q', 'origin', 'main:doomed2');
  w.repo.git('symbolic-ref', 'refs/remotes/po/doomed2', 'refs/heads/code-conductor/wt');
  await assert.rejects(w.op('branch.deleteRemote', { remote: 'po', branches: ['doomed2'] }), refused('SYMBOLIC_REF', { target: 'refs/heads/code-conductor/wt' }));
  intact();
});

for (const dir of ['remotes', 'branches']) {
  test(`a push-only remote with a legacy .git/${dir} file is refused (REMOTE_CONFIG_UNSUPPORTED), no push`, async (t) => {
    const { w, pushed } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*'], null);
    pushOnly(w);
    legacy(w, dir, 'po', dir === 'remotes' ? `URL: ${w.origin.dir}\nPull: refs/heads/*:refs/remotes/po/*\n` : `${w.origin.dir}\n`);
    await assert.rejects(w.op('branch.deleteRemote', { remote: 'po', branches: ['doomed'] }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'po', refspec: null }));
    assert.equal(pushed(), false);
  });
}

test('an empty url with no legacy file and no fetch refspec maps nothing, as git: the delete runs and git leaves a symbolic origin/<b> alone', async (t) => {
  const { w, intact } = await aliasWorld(t, ['+refs/heads/*:refs/remotes/origin/*'], 'origin/doomed');
  w.repo.git('config', '--unset-all', 'remote.origin.fetch');
  w.repo.git('config', '--replace-all', 'remote.origin.url', '');
  w.repo.git('config', 'remote.origin.pushurl', w.origin.dir);
  const git = gitFor(ctxFor({ project: 'repo' }, 'write', { op: 'test.fetchSpecs' }));
  assert.deepEqual(await fetchSpecs(git, 'origin'), []);
  const r = await w.op('branch.deleteRemote', { remote: 'origin', branches: ['doomed'] });
  assert.deepEqual(r.deleted, ['doomed']);
  intact();
  assert.equal(w.repo.git('symbolic-ref', 'refs/remotes/origin/doomed'), 'refs/heads/code-conductor/wt', 'git did not write through the unmapped ref');
});

test('assertFetchDestinations: a destination outside refs/remotes/ and refs/tags/ → REMOTE_CONFIG_UNSUPPORTED naming the refspec as configured; store-less and negative refspecs pass', () => {
  assertFetchDestinations('origin', specs('+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*', 'refs/heads/x:refs/remotes/pin/x', 'refs/heads/main', '^refs/heads/secret'));
  for (const bad of ['+refs/heads/*:refs/heads/*', 'refs/heads/x:refs/heads/code-conductor/x', '+refs/heads/*:refs/wip/*', 'refs/heads/a:refs/notes/a', '+refs/heads/*:refs/remotesx/*']) {
    assert.throws(() => assertFetchDestinations('origin', specs('+refs/heads/*:refs/remotes/origin/*', bad)), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin', refspec: bad }), bad);
  }
});

test('destinationNamespaces cuts a wildcard destination after the last / before its *, keeps an exact one, and skips store-less and negative refspecs; inDestinations matches exactly', () => {
  const s = specs('+refs/heads/*:refs/remotes/origin/*', 'refs/heads/*:refs/remotes/origin/pre-*', 'refs/heads/x:refs/remotes/pin/x', 'refs/heads/main', '^refs/heads/n*');
  assert.deepEqual(destinationNamespaces(s), ['refs/remotes/origin/', 'refs/remotes/pin/x']);
  assert.deepEqual(destinationNamespaces(specs('refs/heads/*-wip:refs/remotes/w/a/*-x')), ['refs/remotes/w/a/']);
  assert.equal(inDestinations(s, 'refs/remotes/origin/a/b'), true);
  assert.equal(inDestinations(s, 'refs/remotes/pin/x'), true);
  assert.equal(inDestinations(s, 'refs/remotes/pin/x/y'), false);
  assert.equal(inDestinations(s, 'refs/remotes/other/a'), false);
  assert.equal(inDestinations(specs('refs/heads/*:refs/remotes/w/*-x'), 'refs/remotes/w/a'), false);
});

test('isHeadAlias: only <dst with * = HEAD> pointing into the same destination pattern', () => {
  const s = specs('+refs/heads/*:refs/remotes/origin/*', 'refs/heads/x:refs/remotes/pin/x');
  assert.equal(isHeadAlias(s, 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'), true);
  assert.equal(isHeadAlias(s, 'refs/remotes/origin/HEAD', 'refs/heads/main'), false);
  assert.equal(isHeadAlias(s, 'refs/remotes/origin/HEAD', 'refs/remotes/other/main'), false);
  assert.equal(isHeadAlias(s, 'refs/remotes/origin/x', 'refs/remotes/origin/main'), false);
  assert.equal(isHeadAlias(s, 'refs/remotes/pin/HEAD', 'refs/remotes/pin/x'), false, 'an exact refspec has no HEAD alias');
});

test('assertNoTrackingSymrefs refuses the first symbolic ref with its ref and target, except the HEAD alias; newlyLiveSymrefs lists symrefs not live before', () => {
  const s = specs('+refs/heads/*:refs/remotes/origin/*');
  const snap = (entries) => new Map(entries.map(([ref, symref]) => [ref, { oid: 'a'.repeat(40), symref }]));
  assertNoTrackingSymrefs(snap([['refs/remotes/origin/main', null], ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], ['refs/tags/v1', null]]), s, 'origin');
  assert.throws(() => assertNoTrackingSymrefs(snap([['refs/remotes/origin/x', 'refs/heads/victim']]), s, 'origin'),
    refused('SYMBOLIC_REF', { ref: 'refs/remotes/origin/x', target: 'refs/heads/victim' }));
  assert.throws(() => assertNoTrackingSymrefs(snap([['refs/remotes/origin/HEAD', 'refs/heads/main']]), s, 'origin'), refused('SYMBOLIC_REF', { ref: 'refs/remotes/origin/HEAD' }));
  assert.throws(() => assertNoTrackingSymrefs(snap([['refs/tags/v1', 'refs/heads/main']]), s, 'origin'), refused('SYMBOLIC_REF', { ref: 'refs/tags/v1', target: 'refs/heads/main' }));
  const before = snap([['refs/remotes/origin/a', 'refs/heads/t'], ['refs/remotes/origin/b', null]]);
  const after = snap([['refs/remotes/origin/a', 'refs/heads/t'], ['refs/remotes/origin/b', 'refs/heads/u'], ['refs/remotes/origin/c', 'refs/heads/ghost'], ['refs/remotes/origin/d', null]]);
  assert.deepEqual(newlyLiveSymrefs(before, after), [{ ref: 'refs/remotes/origin/b', target: 'refs/heads/u' }, { ref: 'refs/remotes/origin/c', target: 'refs/heads/ghost' }]);
});

test('trackedSnapshot: every destination ref and every tag, with symrefs; nothing outside the destinations, nothing dangling', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('fetch', '-q', 'origin');
  w.repo.git('tag', 'v1');
  w.repo.git('update-ref', 'refs/remotes/originx/a', w.base);
  w.repo.git('update-ref', 'refs/remotes/other/a', w.base);
  w.repo.git('symbolic-ref', 'refs/remotes/origin/alias', 'refs/heads/main');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/ghost', 'refs/heads/nowhere');
  const git = gitFor(ctxFor({ project: 'repo' }, 'write', { op: 'test.snapshot' }));
  const snap = await trackedSnapshot(git, await fetchSpecs(git, 'origin'));
  assert.deepEqual(Object.fromEntries(snap), {
    // git's own fetch created the HEAD alias (followRemoteHEAD).
    'refs/remotes/origin/HEAD': { oid: w.base, symref: 'refs/remotes/origin/main' },
    'refs/remotes/origin/alias': { oid: w.base, symref: 'refs/heads/main' },
    'refs/remotes/origin/main': { oid: w.base, symref: null },
    'refs/tags/v1': { oid: w.base, symref: null },
  });
});
