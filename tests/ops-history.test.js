import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HISTORY_LIMITS } from '../src/git/history/limits.js';
import { OPS } from '../src/git/ops/index.js';
import { opWorld, refused } from './_ops.js';

// history.file, history.blame, history.reflog, history.paths against real repos.

/** a.txt → (rename) b.txt → (edit) → (rename) c.txt, then an unrelated commit: HEAD. */
async function renameWorld(t) {
  const w = await opWorld(t);
  const { repo } = w;
  const one = repo.commit({ 'a.txt': 'one\ntwo\nthree\n' }, 'one');
  repo.git('mv', 'a.txt', 'b.txt');
  const toB = repo.commit({}, 'to b');
  const edit = repo.commit({ 'b.txt': 'one\nTWO\nthree\n' }, 'edit b');
  repo.git('mv', 'b.txt', 'c.txt');
  const toC = repo.commit({}, 'to c');
  const head = repo.commit({ 'other.txt': 'x\n' }, 'other');
  return { ...w, oids: { one, toB, edit, toC, head } };
}

/** Sets HISTORY_LIMITS[key] for one test. */
function withLimit(t, key, value) {
  const old = HISTORY_LIMITS[key];
  HISTORY_LIMITS[key] = value;
  t.after(() => { HISTORY_LIMITS[key] = old; });
}

// Invariant: all four history ops are cancellable reads.
test('the history ops are cancellable reads', () => {
  for (const name of ['history.file', 'history.blame', 'history.reflog', 'history.paths']) {
    assert.equal(OPS.get(name)?.kind, 'read', name);
    assert.equal(OPS.get(name).cancellable, true, name);
  }
});

// Invariant: file history follows renames — each item names the file as it was at that commit, a rename carries
// oldPath — and pages are stable slices of the same walk (skip/nextCursor), the last page's nextCursor null.
test('history.file follows two renames and pages by skip', async (t) => {
  const w = await renameWorld(t);
  const { oids } = w;
  const p1 = await w.op('history.file', { rev: oids.head, path: 'c.txt', skip: 0, limit: 2 });
  assert.deepEqual(p1.items.map((i) => [i.oid, i.status, i.path, i.oldPath]), [[oids.toC, 'R100', 'c.txt', 'b.txt'], [oids.edit, 'M', 'b.txt', null]]);
  assert.equal(p1.nextCursor, 2);
  assert.equal(p1.truncated, false);
  const p2 = await w.op('history.file', { rev: oids.head, path: 'c.txt', skip: p1.nextCursor, limit: 2 });
  assert.deepEqual(p2.items.map((i) => [i.oid, i.status, i.path, i.oldPath]), [[oids.toB, 'R100', 'b.txt', 'a.txt'], [oids.one, 'A', 'a.txt', null]]);
  assert.equal(p2.nextCursor, null);
  const item = p1.items[0];
  assert.deepEqual([item.author, item.email, item.subject, item.parents], ['T', 't@example.com', 'to c', [oids.edit]]);
  assert.ok(Number.isInteger(item.time));
  const whole = await w.op('history.file', { rev: oids.head, path: 'c.txt', skip: 0, limit: 10 });
  assert.deepEqual(whole.items, [...p1.items, ...p2.items]);
});

// Invariant: past followMaxCommits the walk stops: the page ends with nextCursor null and truncated true (never a corrupt page).
test('history.file stops at followMaxCommits with truncated', async (t) => {
  const w = await renameWorld(t);
  withLimit(t, 'followMaxCommits', 3);
  const p = await w.op('history.file', { rev: w.oids.head, path: 'c.txt', skip: 2, limit: 2 });
  assert.deepEqual(p.items.map((i) => i.oid), [w.oids.toB]);
  assert.deepEqual([p.nextCursor, p.truncated], [null, true]);
  await assert.rejects(w.op('history.file', { rev: w.oids.head, path: 'c.txt', skip: 3, limit: 1 }), refused('BAD_PARAMS'));
});

// Invariant: paths are literal — a leading `-`, spaces and non-ASCII names work in history, blame and paths.
test('a path with a leading -, spaces and unicode', async (t) => {
  const w = await opWorld(t);
  const name = '-rf dir é/x y.txt';
  const c = w.repo.commit({ [name]: 'l1\nl2\n' }, 'odd');
  const h = await w.op('history.file', { rev: c, path: name, skip: 0, limit: 5 });
  assert.deepEqual(h.items.map((i) => i.path), [name]);
  const b = await w.op('history.blame', { rev: c, path: name, start: 1, count: 10 });
  assert.deepEqual(b.lines.map((l) => l.text), ['l1', 'l2']);
  assert.deepEqual((await w.op('history.paths', { rev: c })).paths, [name]);
});

// Invariant: blame pages (-L start,+count) concatenate to exactly the full blame; total is the file's line count.
test('history.blame: pages concatenate to the full blame, with each line\'s commit and its headers', async (t) => {
  const w = await opWorld(t);
  const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
  const c1 = w.repo.commit({ 'f.txt': `${lines.join('\n')}\n` }, 'first');
  lines[4] = 'changed 5';
  lines[19] = 'changed 20';
  const c2 = w.repo.commit({ 'f.txt': `${lines.join('\n')}\n` }, 'second');
  const full = await w.op('history.blame', { rev: c2, path: 'f.txt', start: 1, count: 1000 });
  assert.equal(full.total, 25);
  assert.equal(full.lines.length, 25);
  assert.deepEqual(full.lines.map((l) => l.n), lines.map((_, i) => i + 1));
  assert.equal(full.lines[4].oid, c2);
  assert.equal(full.lines[3].oid, c1);
  assert.deepEqual(full.commits[c2], { author: 'T', mail: 't@example.com', time: full.commits[c2].time, summary: 'second', filename: 'f.txt', previous: c1, previousPath: 'f.txt' });
  const pages = [];
  for (let start = 1; start <= 25; start += 7) pages.push(...(await w.op('history.blame', { rev: c2, path: 'f.txt', start, count: 7 })).lines);
  assert.deepEqual(pages, full.lines);
  assert.deepEqual(await w.op('history.blame', { rev: c2, path: 'f.txt', start: 26, count: 5 }), { total: 25, lines: [], commits: {} });
});

// Invariant: blame refuses a binary file (BINARY_FILE), a path that is not a file there (PATH_NOT_IN_COMMIT).
test('history.blame refuses BINARY_FILE and PATH_NOT_IN_COMMIT', async (t) => {
  const w = await opWorld(t);
  const c = w.repo.commit({ 'bin.dat': Buffer.from([0, 1, 2, 0]), 'dir/f.txt': 'f\n' }, 'bin');
  await assert.rejects(w.op('history.blame', { rev: c, path: 'bin.dat' }), refused('BINARY_FILE'));
  await assert.rejects(w.op('history.blame', { rev: c, path: 'missing.txt' }), refused('PATH_NOT_IN_COMMIT'));
  await assert.rejects(w.op('history.blame', { rev: c, path: 'dir' }), refused('PATH_NOT_IN_COMMIT'));
});

// Invariant: the repo's config cannot reshape or break the reads: a missing blame.ignoreRevsFile, log.showSignature, a
// textconv driver and an external diff are all neutralised (the driver never runs).
test('a hostile config is neutralised: ignoreRevsFile, showSignature, textconv, diff.external', async (t) => {
  const w = await opWorld(t);
  const marker = path.join(w.repo.root, 'driver-ran');
  const driver = path.join(w.repo.root, 'driver.sh');
  fs.writeFileSync(driver, `#!/bin/sh\ntouch '${marker}'\ncat "$1"\n`, { mode: 0o755 });
  const c = w.repo.commit({ '.gitattributes': '*.tc diff=hostile\n', 'f.tc': 'a\nb\n' }, 'tc');
  for (const [k, v] of [['blame.ignoreRevsFile', 'missing-file'], ['log.showSignature', 'true'], ['diff.hostile.textconv', driver], ['diff.external', driver]]) w.repo.git('config', k, v);
  const b = await w.op('history.blame', { rev: c, path: 'f.tc' });
  assert.deepEqual([b.total, b.lines.map((l) => l.text)], [2, ['a', 'b']]);
  assert.equal((await w.op('history.file', { rev: c, path: 'f.tc' })).items.length, 1);
  assert.equal((await w.op('history.reflog', { ref: 'HEAD' })).items.length, 1);
  assert.equal(fs.existsSync(marker), false, 'no driver ran');
});

// Invariant: the reflog of HEAD and of a branch, newest first, paged by skip; selectors count from the newest entry.
test('history.reflog of HEAD and of a branch, paged', async (t) => {
  const w = await renameWorld(t);
  const p1 = await w.op('history.reflog', { ref: 'HEAD', skip: 0, limit: 2 });
  assert.deepEqual(p1.items.map((i) => [i.selector, i.oid, i.action]), [['HEAD@{0}', w.oids.head, 'commit: other'], ['HEAD@{1}', w.oids.toC, 'commit: to c']]);
  assert.equal(p1.nextCursor, 2);
  assert.deepEqual(p1.items[0].who, { name: 'T', email: 't@example.com' });
  assert.ok(Number.isInteger(p1.items[0].time) && p1.items[0].time > 0);
  assert.equal(p1.items[0].subject, 'other');
  const rest = await w.op('history.reflog', { ref: 'HEAD', skip: 2, limit: 100 });
  assert.deepEqual(rest.items.map((i) => i.selector), ['HEAD@{2}', 'HEAD@{3}', 'HEAD@{4}']);
  assert.equal(rest.nextCursor, null);
  const branch = await w.op('history.reflog', { ref: 'refs/heads/main', skip: 0, limit: 1 });
  assert.deepEqual(branch.items.map((i) => i.selector), ['main@{0}']);
  w.repo.git('branch', 'quiet');
  fs.rmSync(path.join(w.repo.dir, '.git', 'logs', 'refs', 'heads', 'quiet'));
  assert.deepEqual(await w.op('history.reflog', { ref: 'refs/heads/quiet' }), { items: [], nextCursor: null });
  assert.deepEqual(await w.op('history.reflog', { ref: 'refs/heads/none' }), { items: [], nextCursor: null });
});

// Invariant: the reflog takes HEAD or a full local branch only: options, tags and revisions are BAD_REF before any exec.
test('history.reflog: BAD_REF for -x, refs/tags/x, HEAD~1, a short name', async (t) => {
  const w = await opWorld(t);
  w.repo.commit({ 'a.txt': 'a\n' });
  const before = w.cc.state.execCalls.length;
  for (const ref of ['-x', 'refs/tags/x', 'HEAD~1', 'main', 'refs/heads/-x']) await assert.rejects(w.op('history.reflog', { ref }), refused('BAD_REF'), ref);
  assert.equal(w.cc.state.execCalls.length, before);
});

// Invariant: history.paths lists every file of a commit; over its cap it refuses OUTPUT_TOO_LARGE (never a partial list).
test('history.paths: every file of the commit; OUTPUT_TOO_LARGE with a tiny cap', async (t) => {
  const w = await opWorld(t);
  const c = w.repo.commit({ 'a.txt': 'a\n', 'd/b.txt': 'b\n' });
  assert.deepEqual((await w.op('history.paths', { rev: c })).paths, ['a.txt', 'd/b.txt']);
  await assert.rejects(w.op('history.paths', { rev: 'f'.repeat(40) }), refused('REV_UNKNOWN'));
  withLimit(t, 'pathsMaxOutputBytes', 4);
  await assert.rejects(w.op('history.paths', { rev: c }), refused('OUTPUT_TOO_LARGE'));
});

// Invariant: the history ops take a full oid only (never HEAD or a short sha), and bounded skip/limit/count.
test('params: rev a full oid, limits bounded', async (t) => {
  const w = await opWorld(t);
  const c = w.repo.commit({ 'a.txt': 'a\n' });
  for (const [name, params] of [
    ['history.file', { rev: 'HEAD', path: 'a.txt' }], ['history.file', { rev: c, path: 'a.txt', limit: HISTORY_LIMITS.pageMax + 1 }],
    ['history.file', { rev: c, path: '../x' }], ['history.blame', { rev: c.slice(0, 7), path: 'a.txt' }],
    ['history.blame', { rev: c, path: 'a.txt', start: 0 }], ['history.blame', { rev: c, path: 'a.txt', count: HISTORY_LIMITS.blameLinesMax + 1 }],
    ['history.paths', { rev: c, extra: 1 }],
  ]) await assert.rejects(w.op(name, params), (e) => ['BAD_PARAMS', 'BAD_REF', 'BAD_PATH'].includes(e.code), `${name} ${JSON.stringify(params)}`);
});

// Invariant: a blame commit carries `previous` and `previousPath` (porcelain's "previous <oid> <path>"): for a commit that
// renamed the file the old name, for an edit in place the same name; none for the commit that added it.
test('history.blame: previous and previousPath name the commit before and the file\'s name there', async (t) => {
  const w = await opWorld(t);
  const c1 = w.repo.commit({ 'old name.txt': 'a\nb\nc\nd\ne\n' }, 'add');
  w.repo.git('mv', 'old name.txt', 'new name.txt');
  const c2 = w.repo.commit({ 'new name.txt': 'a\nb\nc\nd\nE\n' }, 'rename and edit');
  const b = await w.op('history.blame', { rev: c2, path: 'new name.txt' });
  assert.deepEqual([b.commits[c2].filename, b.commits[c2].previous, b.commits[c2].previousPath], ['new name.txt', c1, 'old name.txt']);
  assert.deepEqual([b.commits[c1].filename, b.commits[c1].previous, b.commits[c1].previousPath], ['old name.txt', null, null]);
});

// Invariant: blame's file names are git's C-quoted porcelain values unquoted: a name holding `"` or a tab comes back as
// the path itself (filename and previousPath), plain or across a rename, and opens in diff.file.
test('history.blame: a quoted path (", tab) comes back unquoted, plain and renamed', async (t) => {
  const w = await opWorld(t);
  const c1 = w.repo.commit({ 'q"uote.txt': 'a\n', 'ta\tb.txt': 't\n' }, 'add');
  w.repo.git('mv', 'q"uote.txt', 'n"ew.txt');
  const c2 = w.repo.commit({ 'n"ew.txt': 'a\nb\n' }, 'rename and edit');
  const plain = await w.op('history.blame', { rev: c2, path: 'ta\tb.txt' });
  assert.equal(plain.commits[c1].filename, 'ta\tb.txt');
  const renamed = await w.op('history.blame', { rev: c2, path: 'n"ew.txt' });
  assert.deepEqual([renamed.commits[c2].filename, renamed.commits[c2].previousPath], ['n"ew.txt', 'q"uote.txt']);
  assert.equal(renamed.commits[c1].filename, 'q"uote.txt');
  const fd = await w.op('diff.file', { source: { kind: 'commit', rev: c2 }, path: renamed.commits[c2].filename, oldPath: renamed.commits[c2].previousPath, context: 3, whitespace: 'none' });
  assert.equal(fd.path, 'n"ew.txt');
});
