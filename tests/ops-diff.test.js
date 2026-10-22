import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';
import { getOp, OPS } from '../src/git/ops/index.js';
import { startApp } from './_app.js';
import { ctxFor, gitFor } from './_ctx.js';
import { APP_NEW, diffRepo, GITLINK, HUGE_LINES, LFS, NULL_MARKER, SECRET_MARKER } from './_diffRepo.js';
import { fakeCc } from './_fakeCc.js';
import { hermeticEnv, makeRepo } from './_git.js';

const T = { project: 'diffs' };

async function world(t) {
  const fx = diffRepo(t);
  const cc = await fakeCc({ projects: { diffs: { dir: fx.repo.dir } }, home: fx.repo.home });
  t.after(() => cc.close());
  return { ...fx, cc };
}

/** Runs op `name` as routes/ops.js does: params checked, then run(git, params, {target}). */
const op = async (name, params, target = T) => {
  const def = getOp(OPS, name);
  return def.run(gitFor(ctxFor(target, def.kind, { op: name })), def.params(params), { target });
};
const files = (source, extra = {}) => op('diff.files', { source, ...extra });
const file = (source, p, extra = {}) => op('diff.file', { source, path: p, ...extra });
const commit = (rev, parent) => ({ kind: 'commit', rev, ...(parent ? { parent } : {}) });
const paths = (r) => r.files.map((f) => f.path).sort();
const refused = (c) => (e) => { assert.equal(e.code, c); return true; };
const diffArgv = (cc) => cc.state.execCalls.map((b) => b.argv).filter((a) => a.includes('diff') || a.includes('format-patch'));

test('commit vs its first parent: the pinned pair, the commit with its parents, and its files', async (t) => {
  const { oids } = await world(t);
  const r = await files(commit('HEAD~1'));
  assert.deepEqual(r.pair, { old: { type: 'tree', oid: oids.merge }, new: { type: 'tree', oid: oids.change } });
  assert.deepEqual(r.commit, { oid: oids.change, parents: [oids.merge] });
  assert.equal(r.mergeBase, null);
  assert.equal(r.series, null);
  assert.deepEqual(paths(r), ['-rf', ':(glob)*', 'big.bin', 'bin.dat', 'conv.tc', 'huge.txt', 'new/name.js', 'src/app.ts', 'vendor/lib', 'w.txt', 'xss.html']);
});

test('root commit diffs against the empty tree', async (t) => {
  const { oids } = await world(t);
  const r = await files(commit(oids.root));
  assert.equal(r.pair.old.oid, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.deepEqual(r.commit.parents, []);
  assert.ok(r.files.every((f) => f.status === 'A'));
});

test('merge commit: parent 1 by default, parent 2 on request (other files), parent 3 refused BAD_PARAMS', async (t) => {
  const { oids } = await world(t);
  const p1 = await files(commit(oids.merge));
  assert.deepEqual(paths(p1), ['topic.txt']);
  assert.deepEqual(p1.commit.parents, [oids.m1, oids.t1]);
  assert.deepEqual(paths(await files(commit(oids.merge, 2))), ['main-only.txt']);
  await assert.rejects(files(commit(oids.merge, 3)), refused('BAD_PARAMS'));
  await assert.rejects(files(commit(oids.change, 2)), refused('BAD_PARAMS'));
});

test('a revision that names no commit → REV_UNKNOWN (404), for every user-typed field', async (t) => {
  await world(t);
  for (const source of [commit('nope'), { kind: 'worktree', rev: 'nope' }, { kind: 'compare', from: 'main', to: 'nope', mode: '..' }, commit('HEAD:src/app.ts')]) {
    await assert.rejects(files(source), refused('REV_UNKNOWN'));
  }
  await assert.rejects(files({ kind: 'commits', oids: ['f'.repeat(40)] }), refused('REV_UNKNOWN'));
});

test('a revision rev-parse --verify fails on with exit 128 (HEAD@{999}) is REV_UNKNOWN, not GIT_FAILED; not-a-repo stays GIT_FAILED', async (t) => {
  const { cc, repo } = await world(t);
  for (const source of [commit('HEAD@{999}'), { kind: 'worktree', rev: 'HEAD@{999}' }, { kind: 'compare', from: 'HEAD@{999}', to: 'main', mode: '...' }]) {
    await assert.rejects(files(source), (e) => {
      assert.equal(e.code, 'REV_UNKNOWN');
      assert.equal(typeof e.extra.detail, 'string');
      return true;
    });
  }
  const plain = path.join(repo.root, 'plain');
  fs.mkdirSync(plain);
  cc.state.projects.plain = { dir: plain };
  await assert.rejects(op('diff.files', { source: commit('HEAD') }, { project: 'plain' }), refused('GIT_FAILED'));
});

test('unstaged: index → worktree plus untracked files as ?, whose diff is all added lines', async (t) => {
  const { cc } = await world(t);
  const r = await files({ kind: 'unstaged' });
  assert.deepEqual(r.pair, { old: { type: 'index' }, new: { type: 'worktree' } });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [
    ['main-only.txt', 'M'], ['bare-dir-link', '?'], ['dir-link', '?'], ['notes.txt', '?'], ['out', '?'], ['secret-link', '?'],
  ]);
  const u = r.files.find((f) => f.path === 'notes.txt');
  assert.deepEqual([u.added, u.deleted, u.binary, u.oversized], [null, null, false, false]);
  const d = await file({ kind: 'unstaged' }, 'notes.txt', { untracked: true });
  assert.deepEqual(d.hunks[0].lines.map((l) => [l.kind, l.text, l.newNo]), [['add', 'untracked', 1], ['add', 'notes', 2]]);
  assert.ok(cc.state.execCalls.some((b) => b.argv.includes('--no-index')));
});

test('an untracked path through a symlinked directory → BAD_PATH, and no --no-index command runs', async (t) => {
  const { cc } = await world(t);
  await assert.rejects(file({ kind: 'unstaged' }, 'out/etc/passwd', { untracked: true }), refused('BAD_PATH'));
  await assert.rejects(file({ kind: 'unstaged' }, 'src/app.ts', { untracked: true }), refused('BAD_PATH'));
  assert.equal(cc.state.execCalls.some((b) => b.argv.includes('--no-index')), false);
});

test('untracked is refused unless the source is index → worktree', async (t) => {
  await world(t);
  await assert.rejects(file({ kind: 'staged' }, 'notes.txt', { untracked: true }), refused('BAD_PARAMS'));
  await assert.rejects(file(commit('HEAD'), 'notes.txt', { untracked: true }), refused('BAD_PARAMS'));
});

test('an untracked symlink shows its target path (mode 120000), never the target file content', async (t) => {
  const { secret } = await world(t);
  const d = await file({ kind: 'unstaged' }, 'secret-link', { untracked: true });
  assert.equal(d.newMode, '120000');
  const lines = d.hunks.flatMap((h) => h.lines);
  assert.deepEqual(lines.map((l) => [l.kind, l.text]), [['add', secret]]);
  assert.equal(JSON.stringify(d).includes(SECRET_MARKER), false);
});

test('an untracked symlink to a directory is refused BAD_PATH: never <link>/null, whether the target has a null file or not', async (t) => {
  const { cc } = await world(t);
  for (const link of ['dir-link', 'bare-dir-link', 'out']) {
    const before = cc.state.execCalls.length;
    await assert.rejects(file({ kind: 'unstaged' }, link, { untracked: true }), (e) => {
      assert.equal(e.code, 'BAD_PATH');
      assert.equal(JSON.stringify({ message: e.message, extra: e.extra }).includes(NULL_MARKER), false);
      return true;
    });
    // Only the stat-only raw probe ran with --no-index: no patch was ever produced through the link.
    const noIndex = cc.state.execCalls.slice(before).filter((b) => b.argv.includes('--no-index'));
    assert.equal(noIndex.length, 1, link);
    assert.ok(noIndex[0].argv.includes('--raw'), link);
  }
});

test('gitlink: listed as a submodule; its diff is the two pointers and no hunks', async (t) => {
  await world(t);
  const r = await files(commit('HEAD~1'));
  const f = r.files.find((x) => x.path === 'vendor/lib');
  assert.deepEqual([f.submodule, f.oldMode, f.newMode], [true, '160000', '160000']);
  assert.equal(r.files.filter((x) => x.submodule).length, 1);
  const d = await file(r.pair && { kind: 'pair', ...r.pair }, 'vendor/lib');
  assert.deepEqual(d.submodule, { old: GITLINK.old, new: GITLINK.new, dirty: false });
  assert.deepEqual(d.hunks, []);
});

test('staged: HEAD → index; on an unborn HEAD, the empty tree → index', async (t) => {
  const { oids } = await world(t);
  const r = await files({ kind: 'staged' });
  assert.deepEqual(r.pair, { old: { type: 'tree', oid: oids.tail }, new: { type: 'index' } });
  assert.deepEqual(paths(r), ['tail.txt']);
  const unborn = makeRepo(t, { name: 'unborn' });
  unborn.write('first.txt', 'first\n');
  unborn.git('add', 'first.txt');
  const cc = await fakeCc({ projects: { unborn: { dir: unborn.dir } }, home: unborn.home });
  t.after(() => cc.close());
  const u = await op('diff.files', { source: { kind: 'staged' } }, { project: 'unborn' });
  assert.equal(u.pair.old.oid, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.deepEqual(u.files.map((f) => [f.path, f.status]), [['first.txt', 'A']]);
});

test('compare: .. diffs the two tips, ... diffs from the merge base (other file sets); no merge base → NO_MERGE_BASE', async (t) => {
  const { oids } = await world(t);
  const two = await files({ kind: 'compare', from: 'main', to: 'side', mode: '..' });
  assert.deepEqual(paths(two), ['side.txt', 'side2.txt', 'tail.txt']);
  assert.equal(two.mergeBase, null);
  const three = await files({ kind: 'compare', from: 'main', to: 'side', mode: '...' });
  assert.deepEqual(paths(three), ['side.txt', 'side2.txt']);
  assert.equal(three.mergeBase, oids.change);
  assert.deepEqual(three.pair, { old: { type: 'tree', oid: oids.change }, new: { type: 'tree', oid: oids.s2 } });
  await assert.rejects(files({ kind: 'compare', from: 'main', to: 'orphan', mode: '...' }), refused('NO_MERGE_BASE'));
});

test('worktree kind: commit → working tree holds staged and unstaged tracked changes, not untracked files', async (t) => {
  await world(t);
  const r = await files({ kind: 'worktree', rev: 'HEAD' });
  assert.deepEqual(r.pair.new, { type: 'worktree' });
  assert.deepEqual(paths(r), ['main-only.txt', 'tail.txt']);
});

test('commits: a contiguous run is a combined series; two apart are a direct compare; three apart are refused', async (t) => {
  const { oids } = await world(t);
  const run3 = await files({ kind: 'commits', oids: [oids.change, oids.tail, oids.merge] });
  assert.deepEqual(run3.series, { oids: [oids.tail, oids.change, oids.merge], direct: false, wip: false, merges: true });
  assert.deepEqual(run3.pair, { old: { type: 'tree', oid: oids.m1 }, new: { type: 'tree', oid: oids.tail } });
  assert.ok(paths(run3).includes('topic.txt') && paths(run3).includes('tail.txt') && paths(run3).includes('src/app.ts'));
  const linear = await files({ kind: 'commits', oids: [oids.tail, oids.change] });
  assert.equal(linear.series.merges, false);
  const direct = await files({ kind: 'commits', oids: [oids.change, oids.root] });
  assert.deepEqual(direct.series, { oids: [oids.change, oids.root], direct: true, wip: false, merges: false });
  assert.deepEqual(direct.pair, { old: { type: 'tree', oid: oids.root }, new: { type: 'tree', oid: oids.change } });
  const diverged = await files({ kind: 'commits', oids: [oids.s1, oids.tail] });
  assert.equal(diverged.series.direct, true);
  assert.deepEqual(new Set([diverged.pair.old.oid, diverged.pair.new.oid]), new Set([oids.s1, oids.tail]));
  await assert.rejects(files({ kind: 'commits', oids: [oids.root, oids.change, oids.tail] }), refused('DIFF_NOT_CONTIGUOUS'));
});

test('commits with wip: the newest must be HEAD, and then the new side is the working tree', async (t) => {
  const { oids } = await world(t);
  const r = await files({ kind: 'commits', oids: [oids.change, oids.tail], wip: true });
  assert.deepEqual(r.pair, { old: { type: 'tree', oid: oids.merge }, new: { type: 'worktree' } });
  assert.equal(r.series.wip, true);
  assert.ok(paths(r).includes('main-only.txt'));
  await assert.rejects(files({ kind: 'commits', oids: [oids.merge, oids.change], wip: true }), refused('DIFF_NOT_CONTIGUOUS'));
  await assert.rejects(files({ kind: 'commits', oids: [oids.root, oids.tail], wip: true }), refused('DIFF_NOT_CONTIGUOUS'));
});

test('file states: binary, rename with similarity and an edit, LFS pointers, oversized', async (t) => {
  await world(t);
  const r = await files(commit('HEAD~1'));
  const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
  assert.deepEqual([by['bin.dat'].binary, by['bin.dat'].added, by['bin.dat'].deleted], [true, null, null]);
  assert.deepEqual([by['new/name.js'].status, by['new/name.js'].oldPath, typeof by['new/name.js'].similarity], ['R', 'old/name.js', 'number']);
  assert.deepEqual([by['huge.txt'].oversized, by['huge.txt'].added], [true, HUGE_LINES]);
  assert.equal(by['src/app.ts'].oversized, false);
  const pair = { kind: 'pair', ...r.pair };
  const bin = await file(pair, 'bin.dat');
  assert.deepEqual([bin.binary, bin.hunks], [true, []]);
  const ren = await file(pair, 'new/name.js', { oldPath: 'old/name.js' });
  assert.equal(ren.oldPath, 'old/name.js');
  assert.deepEqual(ren.hunks.flatMap((h) => h.lines).filter((l) => l.kind !== 'context').map((l) => [l.kind, l.text]), [['del', 'six'], ['add', 'SIX']]);
  const lfs = await file(pair, 'big.bin');
  assert.deepEqual(lfs.lfs, { old: LFS.old, new: LFS.new });
  assert.equal((await file(pair, 'src/app.ts')).lfs, null);
});

test('an empty file added, deleted, or untracked has no hunks and only the present side has a mode', async (t) => {
  const { repo } = await world(t);
  repo.git('stash', '-q', '--include-untracked');
  repo.commit({ 'empty.txt': '' }, 'add empty');
  const added = await file(commit('HEAD'), 'empty.txt');
  assert.deepEqual([added.oldMode, added.newMode, added.hunks], [null, '100644', []]);
  repo.git('rm', '-q', 'empty.txt');
  repo.git('commit', '-q', '-m', 'drop empty');
  const deleted = await file(commit('HEAD'), 'empty.txt');
  assert.deepEqual([deleted.oldMode, deleted.newMode, deleted.hunks], ['100644', null, []]);
  repo.write('fresh-empty.txt', '');
  const untracked = await file({ kind: 'unstaged' }, 'fresh-empty.txt', { untracked: true });
  assert.deepEqual([untracked.oldMode, untracked.newMode, untracked.hunks], [null, '100644', []]);
});

test('context: 0 gives bare changes, full gives one hunk covering every line; whitespace all drops a whitespace-only change', async (t) => {
  await world(t);
  const src = commit('HEAD~1');
  const zero = await file(src, 'src/app.ts', { context: 0 });
  assert.ok(zero.hunks.every((h) => h.lines.every((l) => l.kind !== 'context')));
  const full = await file(src, 'src/app.ts', { context: 'full' });
  assert.equal(full.hunks.length, 1);
  assert.equal(full.hunks[0].newLines, APP_NEW.split('\n').length - 1);
  assert.equal(full.hunks[0].lines.filter((l) => l.kind !== 'del').length, full.hunks[0].newLines);
  assert.ok((await file(src, 'w.txt')).hunks.length > 0);
  assert.deepEqual((await file(src, 'w.txt', { whitespace: 'all' })).hunks, []);
  await assert.rejects(file(src, 'w.txt', { context: 1001 }), refused('BAD_PARAMS'));
  await assert.rejects(file(src, 'w.txt', { whitespace: 'some' }), refused('BAD_PARAMS'));
});

test('caps: the list and the file commands carry their own maxOutputBytes', async (t) => {
  const { cc } = await world(t);
  await files(commit('HEAD~1'));
  await file(commit('HEAD~1'), 'src/app.ts');
  const lists = cc.state.execCalls.filter((b) => b.argv.includes('--raw'));
  const one = cc.state.execCalls.filter((b) => b.argv.includes('diff') && b.argv.includes('src/app.ts'));
  assert.equal(lists.length, 1);
  assert.equal(lists[0].maxOutputBytes, DIFF_LIMITS.listMaxOutputBytes);
  assert.equal(one.length, 1);
  assert.equal(one[0].maxOutputBytes, DIFF_LIMITS.fileMaxOutputBytes);
});

test('output over the cap → 422 OUTPUT_TOO_LARGE with limitBytes, for the list and for one file', async (t) => {
  const { cc } = await world(t);
  const app = await startApp(t);
  const tooLarge = (pred) => (body) => (pred(body.argv) ? { status: 422, body: { error: 'too large', code: 'EXEC_OUTPUT_TOO_LARGE', limitBytes: body.maxOutputBytes } } : undefined);
  cc.state.execHook = tooLarge((a) => a.includes('--raw'));
  const list = await app.call('POST', '/api/ops/diff.files', { target: T, params: { source: commit('HEAD~1') } });
  assert.deepEqual([list.status, list.body.code, list.body.limitBytes], [422, 'OUTPUT_TOO_LARGE', DIFF_LIMITS.listMaxOutputBytes]);
  cc.state.execHook = tooLarge((a) => a.includes('-U3'));
  const one = await app.call('POST', '/api/ops/diff.file', { target: T, params: { source: commit('HEAD~1'), path: 'huge.txt' } });
  assert.deepEqual([one.status, one.body.code, one.body.limitBytes], [422, 'OUTPUT_TOO_LARGE', DIFF_LIMITS.fileMaxOutputBytes]);
  const unknown = await app.call('POST', '/api/ops/diff.files', { target: T, params: { source: commit('nope') } });
  assert.deepEqual([unknown.status, unknown.body.code], [404, 'REV_UNKNOWN']);
});

test('hardening: every diff argv has -c diff.suppressBlankEmpty=false before the subcommand, --no-ext-diff and --no-textconv', async (t) => {
  const { cc, oids } = await world(t);
  await files(commit('HEAD~1'));
  await file(commit('HEAD~1'), 'conv.tc');
  await file({ kind: 'unstaged' }, 'notes.txt', { untracked: true });
  await op('diff.patch', { source: commit('HEAD~1') });
  await op('diff.patch', { source: commit(oids.merge) });
  const argvs = diffArgv(cc);
  assert.ok(argvs.length >= 5);
  for (const a of argvs) {
    const sub = a.findIndex((x) => x === 'diff' || x === 'format-patch');
    const cfg = a.indexOf('diff.suppressBlankEmpty=false');
    assert.ok(cfg > 0 && a[cfg - 1] === '-c' && cfg < sub, a.join(' '));
    assert.ok(a.includes('--no-ext-diff') && a.includes('--no-textconv'), a.join(' '));
  }
});

test('hostile config: blank context lines, a/ b/ prefixes, no colour, -U3 hunks, no external diff or textconv run', async (t) => {
  const { hostileRan } = await world(t);
  const d = await file(commit('HEAD~1'), 'src/app.ts');
  assert.deepEqual(d.hunks.map((h) => h.header), ['@@ -1,5 +1,5 @@', '@@ -15,4 +15,4 @@ export function greet(name: string): string {']);
  const blank = d.hunks[0].lines.find((l) => l.text === '');
  assert.deepEqual([blank.kind, blank.oldNo, blank.newNo], ['context', 3, 3]);
  assert.deepEqual(d.hunks[0].lines.map((l) => l.kind), ['context', 'del', 'add', 'context', 'context', 'context']);
  assert.equal(JSON.stringify(d).includes('\\u001b'), false);
  const patch = Buffer.from((await op('diff.patch', { source: commit('HEAD~1'), paths: ['src/app.ts'] })).base64, 'base64').toString();
  assert.match(patch, /^--- a\/src\/app\.ts$/m);
  assert.match(patch, /^\+\+\+ b\/src\/app\.ts$/m);
  assert.equal(patch.includes('\x1b'), false);
  const conv = await file(commit('HEAD~1'), 'conv.tc');
  assert.deepEqual(conv.hunks.flatMap((h) => h.lines).map((l) => l.text), ['conv 1', 'conv 2']);
  assert.equal(fs.existsSync(hostileRan), false);
});

test('paths that look like options or pathspec magic diff as literal files', async (t) => {
  await world(t);
  for (const [p, a, b] of [['-rf', 'dash', 'dash 2'], [':(glob)*', 'magic', 'magic 2']]) {
    const d = await file(commit('HEAD~1'), p);
    assert.deepEqual(d.hunks.flatMap((h) => h.lines).map((l) => l.text), [a, b], p);
  }
});

test('every exec is form A: no violations', async (t) => {
  const { cc } = await world(t);
  await files({ kind: 'unstaged' });
  await op('diff.patch', { source: { kind: 'unstaged' } });
  assert.deepEqual(cc.state.violations, []);
});

const decode = (r) => Buffer.from(r.base64, 'base64');

test('patch of a commit: mailbox, not numbered, git am applies it on the parent', async (t) => {
  const { repo, oids } = await world(t);
  const r = await op('diff.patch', { source: commit('HEAD~1') });
  const text = decode(r).toString();
  assert.ok(text.startsWith(`From ${oids.change} `));
  assert.match(text, /^Subject: \[PATCH\] change$/m);
  assert.equal(r.filename, `${oids.change.slice(0, 7)}.patch`);
  assert.equal(decode(r).length, r.bytes);
  const clone = path.join(repo.root, 'clone');
  const env = hermeticEnv(repo.home);
  execFileSync('git', ['clone', '-q', repo.dir, clone], { env });
  execFileSync('git', ['-C', clone, 'checkout', '-q', oids.merge], { env });
  const file = path.join(repo.root, 'c.patch');
  fs.writeFileSync(file, decode(r));
  execFileSync('git', ['-C', clone, 'am', '-q', file], { env });
  assert.equal(execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD^{tree}'], { env, encoding: 'utf8' }).trim(), repo.git('rev-parse', `${oids.change}^{tree}`));
});

test('patch under the hostile format.* config: no signature, extra headers, cover letter, sign-off or base; byte-identical twice', async (t) => {
  await world(t);
  const a = decode(await op('diff.patch', { source: commit('HEAD~1') }));
  const text = a.toString();
  assert.equal(text.includes('\n-- \n'), false);
  assert.doesNotMatch(text, /^(X-|To:|Cc:)/m);
  assert.doesNotMatch(text, /\*\*\* SUBJECT HERE \*\*\*|PATCH 0\//);
  assert.equal(text.includes('Signed-off-by:'), false);
  assert.equal(text.includes('base-commit:'), false);
  assert.equal(text.match(/^From [0-9a-f]{40} /gm).length, 1);
  const b = decode(await op('diff.patch', { source: commit('HEAD~1') }));
  assert.ok(a.equals(b));
});

test('patch of a merge-free contiguous series has one From per commit; a merge commit is a plain diff', async (t) => {
  const { oids } = await world(t);
  const series = await op('diff.patch', { source: { kind: 'commits', oids: [oids.tail, oids.change] } });
  assert.equal(decode(series).toString().match(/^From [0-9a-f]{40} /gm).length, 2);
  assert.equal(series.filename, `${oids.merge.slice(0, 7)}..${oids.tail.slice(0, 7)}.patch`);
  const merge = decode(await op('diff.patch', { source: commit(oids.merge) })).toString();
  assert.ok(merge.startsWith('diff --git a/topic.txt b/topic.txt'));
  const withMerge = decode(await op('diff.patch', { source: { kind: 'commits', oids: [oids.change, oids.merge] } })).toString();
  assert.ok(withMerge.startsWith('diff --git '));
  const root = decode(await op('diff.patch', { source: commit(oids.root) })).toString();
  assert.equal(root.match(/^From [0-9a-f]{40} /gm).length, 1);
});

test('patch of unstaged changes applies on HEAD; paths limit the files; binary changes are a GIT binary patch', async (t) => {
  const { repo } = await world(t);
  const wip = await op('diff.patch', { source: { kind: 'unstaged' } });
  assert.equal(wip.filename, 'diffs-unstaged.patch');
  const file = path.join(repo.root, 'wip.patch');
  fs.writeFileSync(file, decode(wip));
  const clone = path.join(repo.root, 'clone');
  const env = hermeticEnv(repo.home);
  execFileSync('git', ['clone', '-q', repo.dir, clone], { env });
  execFileSync('git', ['-C', clone, 'apply', '--check', file], { env });
  const limited = decode(await op('diff.patch', { source: commit('HEAD~1'), paths: ['w.txt', 'bin.dat'] })).toString();
  assert.deepEqual([...limited.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]), ['bin.dat', 'w.txt']);
  assert.match(limited, /^GIT binary patch$/m);
  await assert.rejects(op('diff.patch', { source: commit('HEAD'), paths: ['../x'] }), refused('BAD_PATH'));
  await assert.rejects(op('diff.patch', { source: commit('HEAD'), paths: [] }), refused('BAD_PARAMS'));
});

test('a patch of a rename limited to both its paths pairs it (rename from/to) and applies to the commit tree, mailbox and plain', async (t) => {
  const { repo, oids } = await world(t);
  const env = hermeticEnv(repo.home);
  const ren = ['old/name.js', 'new/name.js'];
  const sources = [['mailbox', commit(oids.change), 'am'], ['plain', { kind: 'pair', old: { type: 'tree', oid: oids.merge }, new: { type: 'tree', oid: oids.change } }, 'apply']];
  for (const [form, source, how] of sources) {
    const text = decode(await op('diff.patch', { source, paths: ren })).toString();
    assert.equal(text.startsWith('From '), form === 'mailbox', form);
    assert.match(text, /^rename from old\/name\.js$/m, form);
    assert.match(text, /^rename to new\/name\.js$/m, form);
    const clone = path.join(repo.root, `clone-${form}`);
    execFileSync('git', ['clone', '-q', '--no-checkout', repo.dir, clone], { env });
    execFileSync('git', ['-C', clone, 'checkout', '-q', oids.merge], { env });
    const file = path.join(repo.root, `${form}.patch`);
    fs.writeFileSync(file, text);
    execFileSync('git', ['-C', clone, how, ...(how === 'apply' ? ['--index'] : ['-q']), file], { env });
    const blob = (rev, p) => execFileSync('git', ['-C', clone, 'rev-parse', `${rev}:${p}`], { env, encoding: 'utf8' }).trim();
    const tree = how === 'am' ? 'HEAD' : '';
    assert.equal(blob(tree, 'new/name.js'), repo.git('rev-parse', `${oids.change}:new/name.js`), form);
    assert.throws(() => blob(tree, 'old/name.js'), undefined, `${form}: the old path is gone`);
  }
});

test('patch filenames: staged / worktree name the project (sanitised, capped), a compare names both ends', async (t) => {
  const { cc, oids } = await world(t);
  const odd = 'my proj_..é';
  cc.state.projects[odd] = cc.state.projects.diffs;
  assert.equal((await op('diff.patch', { source: { kind: 'staged' } }, { project: odd })).filename, 'my_proj_.._-staged.patch');
  assert.equal((await op('diff.patch', { source: { kind: 'worktree', rev: 'HEAD' } })).filename, 'diffs-worktree.patch');
  const long = 'p'.repeat(150);
  cc.state.projects[long] = cc.state.projects.diffs;
  assert.equal((await op('diff.patch', { source: { kind: 'unstaged' } }, { project: long })).filename, `${'p'.repeat(80)}-unstaged.patch`);
  const cmp = await op('diff.patch', { source: { kind: 'compare', from: 'main', to: 'side', mode: '..' } });
  assert.equal(cmp.filename, `${oids.tail.slice(0, 7)}..${oids.s2.slice(0, 7)}.patch`);
});
