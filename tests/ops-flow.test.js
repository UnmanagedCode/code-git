import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { subcommandOf } from '../src/git/runner.js';
import { refused as refusedCode, opWorld } from './_ops.js';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

const PREFIXES = { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: 'v' };
const INIT = { main: 'main', develop: 'develop', prefixes: PREFIXES };

/** refsWorld with git-flow initialized (develop created at main). */
async function flowWorld(t) {
  const w = await refsWorld(t);
  await w.op('flow.init', INIT);
  w.head = () => w.repo.git('symbolic-ref', 'HEAD');
  w.parents = (rev) => w.repo.git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
  /** Every ref with its oid, HEAD, the index and the status: what a refused finish must leave untouched. */
  w.snapshot = () => ({
    refs: w.repo.git('for-each-ref', '--format=%(refname) %(objectname)'),
    head: w.repo.git('symbolic-ref', 'HEAD'),
    index: w.repo.git('ls-files', '-s'),
    status: w.repo.git('status', '--porcelain'),
    mergeHead: w.exists('MERGE_HEAD'),
  });
  return w;
}

test('init writes the six gitflow.* keys to the local config and creates develop at main', async (t) => {
  const w = await refsWorld(t);
  const r = await w.op('flow.init', INIT);
  assert.equal(r.createdDevelop, true);
  assert.equal(w.oid('refs/heads/develop'), w.base);
  assert.deepEqual(r.config, { initialized: true, main: 'main', develop: 'develop', prefixes: PREFIXES });
  const local = w.repo.git('config', '--local', '--get-regexp', '^gitflow\\.').split('\n').sort();
  assert.deepEqual(local, [
    'gitflow.branch.develop develop', 'gitflow.branch.master main', 'gitflow.prefix.feature feature/',
    'gitflow.prefix.hotfix hotfix/', 'gitflow.prefix.release release/', 'gitflow.prefix.versiontag v',
  ]);
  assert.equal(w.repo.git('symbolic-ref', 'HEAD'), 'refs/heads/main', 'init moves nothing');
});

test('re-init with develop present does not move it; it rewrites the settings', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('branch', 'develop');
  w.repo.git('checkout', '-q', 'develop');
  const dev = w.repo.commit({ 'd.txt': 'd\n' }, 'd');
  w.repo.git('checkout', '-q', 'main');
  const r = await w.op('flow.init', INIT);
  assert.equal(r.createdDevelop, false);
  assert.equal(w.oid('refs/heads/develop'), dev);
  const again = await w.op('flow.init', { ...INIT, prefixes: { ...PREFIXES, feature: 'f/', versionTag: '' } });
  assert.deepEqual(again.config.prefixes, { ...PREFIXES, feature: 'f/', versionTag: '' });
});

test('init refuses before writing: a code-conductor/ branch or prefix (BAD_REF), equal branches, a missing main, bad prefixes', async (t) => {
  const w = await refsWorld(t);
  const p = (over) => getOp(OPS, 'flow.init').params({ ...INIT, ...over });
  assert.throws(() => p({ develop: 'code-conductor/x' }), refused('BAD_REF'));
  assert.throws(() => p({ prefixes: { ...PREFIXES, feature: 'code-conductor/' } }), refused('BAD_REF'));
  assert.throws(() => p({ develop: 'main' }), refused('BAD_PARAMS'));
  assert.throws(() => p({ prefixes: { ...PREFIXES, release: '' } }), refused('BAD_PARAMS'));
  assert.throws(() => p({ prefixes: { ...PREFIXES, release: 'feature/' } }), refused('BAD_PARAMS'));
  assert.throws(() => p({ prefixes: { ...PREFIXES, hotfix: '-h/' } }), refused('BAD_REF'));
  assert.throws(() => p({ prefixes: { ...PREFIXES, hotfix: 'a..b/' } }), refused('BAD_REF'));
  await assert.rejects(w.op('flow.init', { ...INIT, main: 'nope' }), refused('REF_UNKNOWN'));
  assert.equal(w.exists('refs/heads/develop'), false);
  assert.throws(() => w.repo.git('config', '--local', '--get-regexp', '^gitflow\\.'), 'no gitflow key written');
});

test('init on an unborn HEAD refuses NO_HEAD', async (t) => {
  const w = await opWorld(t);
  await assert.rejects(w.op('flow.init', INIT), refusedCode('NO_HEAD'));
});

test('start: a feature branches from develop, a hotfix from main; HEAD moves to the new branch', async (t) => {
  const w = await flowWorld(t);
  w.repo.git('checkout', '-q', 'develop');
  const dev = w.repo.commit({ 'd.txt': 'd\n' }, 'd');
  const f = await w.op('flow.start', { type: 'feature', name: 'login' });
  assert.deepEqual(f, { branch: 'feature/login', base: 'develop', oid: dev });
  assert.equal(w.head(), 'refs/heads/feature/login');
  assert.equal(w.oid('HEAD'), dev);
  const h = await w.op('flow.start', { type: 'hotfix', name: '1.0.1' });
  assert.deepEqual(h, { branch: 'hotfix/1.0.1', base: 'main', oid: w.base });
  assert.equal(w.head(), 'refs/heads/hotfix/1.0.1');
});

test('start refuses: not initialized, a second release, a release whose tag exists, an existing branch, a cc-owned HEAD without ccOwned', async (t) => {
  const plain = await refsWorld(t);
  await assert.rejects(plain.op('flow.start', { type: 'feature', name: 'x' }), refused('FLOW_NOT_INITIALIZED'));
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'release', name: '1.0' });
  await assert.rejects(w.op('flow.start', { type: 'release', name: '1.1' }), refused('FLOW_EXISTS', { branch: 'release/1.0' }));
  await w.op('flow.start', { type: 'feature', name: 'a' });
  await assert.rejects(w.op('flow.start', { type: 'feature', name: 'a' }), refused('REF_EXISTS'));
  w.repo.git('tag', 'v2.0');
  await assert.rejects(w.op('flow.start', { type: 'hotfix', name: '2.0' }), refused('REF_EXISTS'));
  w.worktree('wt', 'code-conductor/wt', 'main');
  await assert.rejects(w.op('flow.start', { type: 'hotfix', name: '3.0' }, 'wt'), refused('CC_OWNED_BRANCH', { head: true }));
  const ok = await w.op('flow.start', { type: 'hotfix', name: '3.0', ccOwned: true }, 'wt');
  assert.equal(ok.branch, 'hotfix/3.0');
});

test('start and finish params: a name starting with - is BAD_REF; an unknown type, or a tag message on a feature, BAD_PARAMS', () => {
  const start = (p) => getOp(OPS, 'flow.start').params(p);
  const finish = (p) => getOp(OPS, 'flow.finish').params({ expect: 'a'.repeat(40), ...p });
  assert.throws(() => start({ type: 'feature', name: '-x' }), refused('BAD_REF'));
  assert.throws(() => start({ type: 'support', name: 'x' }), refused('BAD_PARAMS'));
  assert.throws(() => finish({ type: 'feature', name: '-x' }), refused('BAD_REF'));
  assert.throws(() => finish({ type: 'feature', name: 'x', tagMessage: 'm' }), refused('BAD_PARAMS'));
  assert.throws(() => finish({ type: 'release', name: 'x' }), refused('BAD_PARAMS'), 'a release needs a tag message');
  assert.throws(() => finish({ type: 'release', name: 'x', tagMessage: ' \n' }), refused('BAD_PARAMS'));
  assert.throws(() => finish({ type: 'hotfix', name: 'x', tagMessage: 'a\0b' }), refused('BAD_PARAMS'));
  assert.equal(finish({ type: 'hotfix', name: 'x', tagMessage: 'Hotfix x' }).tagMessage, 'Hotfix x');
});

test('finish feature: develop gains a --no-ff merge of the feature tip, the feature branch is deleted, HEAD is develop', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'feature', name: 'login' });
  const tip = w.repo.commit({ 'login.txt': 'login\n' }, 'login');
  const r = await w.op('flow.finish', { type: 'feature', name: 'login', expect: tip });
  const merge = w.oid('refs/heads/develop');
  assert.deepEqual(w.parents(merge), [w.base, tip]);
  assert.equal(w.repo.git('log', '-1', '--format=%s', merge), "Merge branch 'feature/login'");
  assert.deepEqual(r, {
    branch: 'feature/login', merges: [{ into: 'develop', outcome: 'merged', oid: merge }], tag: null, deleted: true, head: 'develop',
  });
  assert.equal(w.exists('refs/heads/feature/login'), false);
  assert.equal(w.head(), 'refs/heads/develop');
  assert.equal(w.oid('refs/heads/main'), w.base, 'a feature never touches main');
});

test('finish feature with nothing to merge: upToDate, and the branch is still deleted', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'feature', name: 'empty' });
  const r = await w.op('flow.finish', { type: 'feature', name: 'empty', expect: w.base });
  assert.deepEqual(r.merges, [{ into: 'develop', outcome: 'upToDate', oid: w.base }]);
  assert.equal(r.deleted, true);
});

for (const type of ['release', 'hotfix']) {
  test(`finish ${type}: main and develop each gain a --no-ff merge of its tip, an annotated tag sits on main's merge, the branch is deleted, HEAD is develop`, async (t) => {
    const w = await flowWorld(t);
    w.repo.git('checkout', '-q', 'develop');
    const devBefore = w.repo.commit({ 'd.txt': 'd\n' }, 'on develop');
    await w.op('flow.start', { type, name: '1.0' });
    const tip = w.repo.commit({ 'version.txt': '1.0\n' }, 'bump');
    const base = type === 'release' ? devBefore : w.base;
    assert.deepEqual(w.parents(tip), [base]);
    const message = `${type === 'release' ? 'Release' : 'Hotfix'} 1.0\n\n# kept verbatim\n`;
    const r = await w.op('flow.finish', { type, name: '1.0', expect: tip, tagMessage: message });
    const mainMerge = w.oid('refs/heads/main');
    const devMerge = w.oid('refs/heads/develop');
    assert.deepEqual(w.parents(mainMerge), [w.base, tip]);
    assert.deepEqual(w.parents(devMerge), [devBefore, tip]);
    assert.equal(w.repo.git('cat-file', '-t', 'refs/tags/v1.0'), 'tag');
    assert.equal(w.oid('v1.0^{commit}'), mainMerge);
    assert.ok(w.repo.git('cat-file', 'tag', 'v1.0').endsWith(`\n\n${message.trimEnd()}`), 'message verbatim');
    assert.deepEqual(r, {
      branch: `${type}/1.0`,
      merges: [{ into: 'main', outcome: 'merged', oid: mainMerge }, { into: 'develop', outcome: 'merged', oid: devMerge }],
      tag: { name: 'v1.0', oid: w.oid('refs/tags/v1.0') }, deleted: true, head: 'develop',
    });
    assert.equal(w.exists(`refs/heads/${type}/1.0`), false);
    assert.equal(w.head(), 'refs/heads/develop');
    const tagArgv = w.argvs().find((a) => a[0] === 'tag');
    assert.equal(tagArgv.includes(message), false, 'the message goes on stdin');
  });
}

test('finish preflights every merge: a conflict on the develop merge (the second) refuses FLOW_CONFLICT with nothing written, main merge included', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'release', name: '2.0' });
  const tip = w.repo.commit({ 'f.txt': 'release\n' }, 'release side');
  w.repo.git('checkout', '-q', 'develop');
  w.repo.commit({ 'f.txt': 'develop\n' }, 'develop side');
  const before = w.snapshot();
  const writesBefore = w.writes().length;
  await assert.rejects(w.op('flow.finish', { type: 'release', name: '2.0', expect: tip, tagMessage: 'Release 2.0' }),
    refused('FLOW_CONFLICT', { into: 'develop', files: ['f.txt'] }));
  assert.deepEqual(w.snapshot(), before);
  assert.equal(w.writes().length, writesBefore, 'no write subcommand ran');
});

test('finish refuses before any write: dirty tracked files, a moved flow branch, main or develop checked out in another worktree, an operation in progress', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'release', name: '1.0' });
  const tip = w.repo.commit({ 'r.txt': 'r\n' }, 'r');
  const finish = (over = {}, wt = null) => w.op('flow.finish', { type: 'release', name: '1.0', expect: tip, tagMessage: 'Release 1.0', ...over }, wt);
  const before = w.snapshot();
  await assert.rejects(finish({ expect: w.base }), refused('REF_MOVED'));
  w.repo.write('f.txt', 'dirty\n');
  await assert.rejects(finish(), refused('DIRTY_WORKTREE'));
  w.repo.git('checkout', '--', 'f.txt');
  assert.deepEqual(w.snapshot(), before);
  // From a cc worktree: main stays checked out in the main checkout.
  w.repo.git('checkout', '-q', 'develop');
  w.worktree('wt', 'code-conductor/wt', 'develop');
  await assert.rejects(finish({ ccOwned: true }, 'wt'), refused('BRANCH_CHECKED_OUT', { worktree: w.repo.dir }));
  // A conflicted merge left in progress.
  w.repo.git('checkout', '-q', '-b', 'side', 'main');
  w.repo.commit({ 'f.txt': 'side\n' }, 'side');
  w.repo.git('checkout', '-q', 'main');
  w.repo.commit({ 'f.txt': 'main\n' }, 'main');
  assert.throws(() => w.repo.git('merge', '-q', 'side'));
  await assert.rejects(finish(), refused('OPERATION_IN_PROGRESS'));
  assert.equal(w.exists('refs/heads/release/1.0'), true);
  assert.equal(w.exists('refs/tags/v1.0'), false);
});

test('a failing pre-merge-commit hook stops the finish: FLOW_INCOMPLETE names the merge step and carries the hook output; the branch is kept', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'feature', name: 'hooked' });
  const tip = w.repo.commit({ 'h.txt': 'h\n' }, 'h');
  w.repo.hook('pre-merge-commit', '#!/bin/sh\necho HOOK-SAYS-NO\nexit 1\n');
  await assert.rejects(w.op('flow.finish', { type: 'feature', name: 'hooked', expect: tip }), (e) => {
    refused('FLOW_INCOMPLETE', { step: 'merge', into: 'develop', done: [{ step: 'switch', into: 'develop' }] })(e);
    assert.equal(e.extra.cause.code, 'GIT_FAILED');
    assert.match(e.extra.cause.stderr, /HOOK-SAYS-NO/);
    return true;
  });
  assert.equal(w.exists('refs/heads/feature/hooked'), true);
  assert.equal(w.head(), 'refs/heads/develop', 'the switch stands');
});

test('start and finish argv: every user-named argument follows --end-of-options (or is the value of switch -c)', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'release', name: '1.0' });
  const tip = w.repo.commit({ 'r.txt': 'r\n' }, 'r');
  await w.op('flow.finish', { type: 'release', name: '1.0', expect: tip, tagMessage: 'Release 1.0' });
  const named = { switch: ['release/1.0', 'main', 'develop'], 'merge-tree': [tip], merge: [tip], tag: ['v1.0'], branch: ['release/1.0', 'develop'] };
  let checked = 0;
  for (const argv of w.argvs()) {
    const sub = subcommandOf(argv);
    for (const name of named[sub] ?? []) {
      if (!argv.includes(name)) continue;
      // `-c <name>`: the value of an option, never parsed as one (as branch.create's switch).
      if (argv[argv.indexOf(name) - 1] !== '-c') endOfOptionsBefore(argv, name);
      checked++;
    }
  }
  assert.ok(checked >= 7, `checked ${checked}`);
});

test('settings: a type prefix that prefixes main or develop is refused (BAD_PARAMS), so neither can read as a flow branch', () => {
  const p = (prefixes) => getOp(OPS, 'flow.init').params({ ...INIT, prefixes: { ...PREFIXES, ...prefixes } });
  assert.throws(() => p({ feature: 'ma' }), refused('BAD_PARAMS'));
  assert.throws(() => p({ release: 'main' }), refused('BAD_PARAMS'));
  assert.throws(() => p({ hotfix: 'dev' }), refused('BAD_PARAMS'));
  assert.equal(p({ feature: 'f/' }).prefixes.feature, 'f/');
});

test('finish never deletes main or develop: stored settings whose prefix prefixes main refuse FLOW_NOT_INITIALIZED, main untouched', async (t) => {
  const w = await flowWorld(t);
  w.repo.git('config', 'gitflow.prefix.feature', 'ma');
  w.repo.git('checkout', '-q', 'develop');
  await assert.rejects(w.op('flow.finish', { type: 'feature', name: 'in', expect: w.base }), refused('FLOW_NOT_INITIALIZED'));
  await assert.rejects(w.op('flow.start', { type: 'feature', name: 'x' }), refused('FLOW_NOT_INITIALIZED'));
  assert.equal(w.oid('refs/heads/main'), w.base);
  assert.equal(w.head(), 'refs/heads/develop');
});

test('a first switch refused before anything moved rethrows its own refusal (CHECKOUT_CONFLICT), not FLOW_INCOMPLETE; nothing changed', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'feature', name: 'blocked' });
  const tip = w.repo.commit({ 'b.txt': 'b\n' }, 'b');
  w.repo.git('checkout', '-q', 'develop');
  w.repo.commit({ 'u.txt': 'tracked on develop\n' }, 'u');
  w.repo.git('checkout', '-q', 'feature/blocked');
  // Untracked: assertClean ignores it, and switching to develop would overwrite it.
  w.repo.write('u.txt', 'untracked here\n');
  const before = w.snapshot();
  await assert.rejects(w.op('flow.finish', { type: 'feature', name: 'blocked', expect: tip }), refused('CHECKOUT_CONFLICT', { files: ['u.txt'] }));
  assert.deepEqual(w.snapshot(), before);
});

test('a hook failing on the first switch after it moved HEAD (post-checkout) is FLOW_INCOMPLETE: judged by what git did, not by the steps done', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'feature', name: 'moved' });
  const tip = w.repo.commit({ 'm.txt': 'm\n' }, 'm');
  w.repo.hook('post-checkout', '#!/bin/sh\necho CHECKOUT-HOOK-NO\nexit 1\n');
  await assert.rejects(w.op('flow.finish', { type: 'feature', name: 'moved', expect: tip }), (e) => {
    refused('FLOW_INCOMPLETE', { step: 'switch', into: 'develop', done: [] })(e);
    assert.match(e.extra.cause.stderr, /CHECKOUT-HOOK-NO/);
    return true;
  });
  assert.equal(w.head(), 'refs/heads/develop', 'HEAD moved before the hook failed');
  assert.equal(w.exists('refs/heads/feature/moved'), true);
});

test('finish from a code-conductor/* HEAD needs ccOwned (CC_OWNED_BRANCH {head: true}); acknowledged, it finishes there', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'feature', name: 'cc' });
  const tip = w.repo.commit({ 'c.txt': 'c\n' }, 'c');
  w.repo.git('checkout', '-q', 'main');
  const wt = w.worktree('wt', 'code-conductor/wt', 'main');
  await assert.rejects(w.op('flow.finish', { type: 'feature', name: 'cc', expect: tip }, 'wt'), refused('CC_OWNED_BRANCH', { head: true }));
  assert.equal(w.exists('refs/heads/feature/cc'), true);
  const r = await w.op('flow.finish', { type: 'feature', name: 'cc', expect: tip, ccOwned: true }, 'wt');
  assert.equal(r.deleted, true);
  assert.equal(wt.git('symbolic-ref', 'HEAD'), 'refs/heads/develop');
});

test('a release whose develop merge is upToDate: main is merged and tagged, develop unchanged, the branch deleted', async (t) => {
  const w = await flowWorld(t);
  await w.op('flow.start', { type: 'release', name: '3.0' });
  const tip = w.repo.commit({ 'v.txt': '3.0\n' }, 'bump');
  // develop already holds the release tip.
  w.repo.git('branch', '-f', 'develop', tip);
  const r = await w.op('flow.finish', { type: 'release', name: '3.0', expect: tip, tagMessage: 'Release 3.0' });
  assert.deepEqual(r.merges.map((m) => m.outcome), ['merged', 'upToDate']);
  assert.deepEqual(r.merges[1], { into: 'develop', outcome: 'upToDate', oid: tip });
  assert.equal(w.oid('refs/heads/develop'), tip);
  assert.equal(w.oid('v3.0^{commit}'), r.merges[0].oid);
  assert.equal(r.deleted, true);
});

test('a flow name may hold a slash: feature/team/login starts, finishes and is deleted', async (t) => {
  const w = await flowWorld(t);
  const s = await w.op('flow.start', { type: 'feature', name: 'team/login' });
  assert.equal(s.branch, 'feature/team/login');
  const tip = w.repo.commit({ 't.txt': 't\n' }, 't');
  const r = await w.op('flow.finish', { type: 'feature', name: 'team/login', expect: tip });
  assert.equal(r.branch, 'feature/team/login');
  assert.equal(r.deleted, true);
  assert.deepEqual(w.parents(w.oid('refs/heads/develop')), [w.base, tip]);
});
