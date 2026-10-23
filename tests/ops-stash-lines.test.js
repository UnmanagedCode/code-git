import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { noViolations, refused } from './_ops.js';
import { blob, read, runs, stashList, stashWorld } from './_stash.js';

// stash.pushLines: the request C4's line staging sends, stashed instead of staged.

const nums = (n) => Array.from({ length: n }, (_, i) => `l${i + 1}`);
const text = (ls) => ls.map((l) => `${l}\n`).join('');
const BASE = nums(30);
const EDITED = BASE.map((l, i) => (i === 1 ? 'L2' : i === 24 ? 'L25' : l));

async function world(t) {
  const w = await stashWorld(t, { 'f.txt': text(BASE), 'g.txt': 'g\n' });
  w.repo.write('f.txt', text(EDITED));
  return w;
}
const shown = (w, p = 'f.txt', context = 3) => w.op('diff.file', { source: { kind: 'unstaged' }, path: p, context, whitespace: 'none' });
function request(fd, picks) {
  return picks.map(([hi, idx]) => {
    const h = fd.hunks[hi];
    const indices = idx === 'all' ? h.lines.flatMap((l, i) => (l.kind === 'context' ? [] : [i])) : idx;
    return { header: h.header, lines: indices.map((i) => ({ index: i, text: h.lines[i].text })) };
  });
}
async function pushLines(w, picks, extra = {}, p = 'f.txt', context = 3) {
  const fd = await shown(w, p, context);
  return w.op('stash.pushLines', { path: p, context, hunks: request(fd, typeof picks === 'function' ? picks(fd) : picks), ...extra });
}
const indexFile = (w) => fs.readFileSync(path.join(w.repo.dir, '.git', 'index'));

test('pushLines whole hunk: W = HEAD + hunk, the worktree loses exactly the hunk, the index is untouched and byte-identical', async (t) => {
  const w = await world(t);
  w.repo.write('g.txt', 'g staged\n');
  w.repo.git('add', 'g.txt');
  const before = indexFile(w);
  const r = await pushLines(w, [[0, 'all']], { message: 'first hunk' });
  const withHunk = text(BASE.map((l, i) => (i === 1 ? 'L2' : l)));
  assert.equal(`${blob(w, `${r.oid}:f.txt`)}\n`, withHunk);
  assert.equal(`${blob(w, `${r.oid}^2:f.txt`)}\n`, text(BASE));
  assert.equal(blob(w, `${r.oid}:g.txt`), 'g');
  assert.equal(w.repo.git('rev-parse', `${r.oid}^1`), w.base);
  assert.equal(read(w, 'f.txt'), text(BASE.map((l, i) => (i === 24 ? 'L25' : l))));
  assert.deepEqual(indexFile(w), before);
  assert.deepEqual(w.status(), { 'f.txt': ' M', 'g.txt': 'M ' });
  assert.deepEqual(stashList(w), [{ oid: r.oid, message: 'On main: first hunk' }]);
  assert.equal(w.repo.git('log', '-1', '--format=%s', r.oid), 'On main: first hunk');
  assert.match(w.repo.git('log', '-1', '--format=%s', `${r.oid}^2`), /^index on main: [0-9a-f]{7,} base$/);
  assert.deepEqual(r.undo.stashes, [{ oid: r.oid, old: null, new: { message: 'On main: first hunk' }, restore: 'pop' }]);
  assert.equal(r.selector, 'stash@{0}');
  noViolations(w.cc);
});

test('pushLines without a message gets git\'s WIP subject', async (t) => {
  const w = await world(t);
  const r = await pushLines(w, [[1, 'all']]);
  assert.match(stashList(w)[0].message, /^WIP on main: [0-9a-f]{7,} base$/);
  assert.equal(w.repo.git('log', '-1', '--format=%s', r.oid), stashList(w)[0].message);
});

for (const context of [0, 3, 'full']) {
  test(`pushLines selected lines (context ${context}): the stash holds what stage.stageLines would stage, the worktree is what stage.discardLines leaves`, async (t) => {
    // One world at a time: each fake cc takes over CONDUCTOR_URL.
    // The `+L25` alone, without its paired `-l25`.
    const pick = (fd) => {
      const hi = fd.hunks.findIndex((h) => h.lines.some((l) => l.text === 'L25'));
      return [[hi, [fd.hunks[hi].lines.findIndex((l) => l.kind === 'add' && l.text === 'L25')]]];
    };
    const a = await world(t);
    const r = await pushLines(a, pick, {}, 'f.txt', context);
    const other = async (op) => {
      const w = await world(t);
      const fd = await shown(w, 'f.txt', context);
      await w.op(op, { path: 'f.txt', context, hunks: request(fd, pick(fd)) });
      return w;
    };
    const staged = await other('stage.stageLines');
    const discarded = await other('stage.discardLines');
    assert.equal(`${blob(a, `${r.oid}:f.txt`)}\n`, staged.indexBlob('f.txt').toString());
    assert.equal(read(a, 'f.txt'), read(discarded, 'f.txt'));
    assert.equal(read(a, 'f.txt'), text(EDITED.filter((l) => l !== 'L25')));
  });
}

test('pushLines on a file with staged changes → PARTIAL_UNSUPPORTED, nothing stored', async (t) => {
  const w = await world(t);
  w.repo.git('add', 'f.txt');
  w.repo.write('f.txt', `${text(EDITED)}more\n`);
  await assert.rejects(pushLines(w, [[0, 'all']]), refused('PARTIAL_UNSUPPORTED'));
  assert.deepEqual(stashList(w), []);
});

test('pushLines STALE_DIFF when the file changed', async (t) => {
  const w = await world(t);
  const fd = await shown(w);
  w.repo.write('f.txt', text(BASE.map((l, i) => (i === 1 ? 'OTHER' : l))));
  await assert.rejects(w.op('stash.pushLines', { path: 'f.txt', context: 3, hunks: request(fd, [[0, 'all']]) }), refused('STALE_DIFF'));
  assert.deepEqual(stashList(w), []);
  assert.equal(read(w, 'f.txt'), text(BASE.map((l, i) => (i === 1 ? 'OTHER' : l))));
});

test('pushLines never passes --index; apply --cached runs with GIT_INDEX_FILE, apply -R on the worktree without it', async (t) => {
  const w = await world(t);
  await pushLines(w, [[0, 'all']]);
  const applies = w.cc.state.execCalls.filter((b) => runs(w, 'apply').includes(b.argv));
  assert.equal(applies.length, 2);
  for (const b of w.cc.state.execCalls) assert.ok(!b.argv.includes('--index'), b.argv.join(' '));
  const [cached, reverse] = applies;
  assert.ok(cached.argv.includes('--cached'));
  assert.match(cached.env.GIT_INDEX_FILE, /code-git-stash-index$/);
  assert.ok(reverse.argv.includes('-R') && !reverse.argv.includes('--cached'));
  assert.equal(reverse.env.GIT_INDEX_FILE, undefined);
  for (const b of w.cc.state.execCalls.filter((x) => runs(w, 'read-tree').includes(x.argv) || runs(w, 'write-tree').includes(x.argv))) {
    assert.equal(b.env.GIT_INDEX_FILE, cached.env.GIT_INDEX_FILE);
  }
});

test('pushLines with no identity configured uses the git-stash fallback', async (t) => {
  const w = await world(t);
  fs.writeFileSync(path.join(w.repo.home, '.gitconfig'), '[commit]\n\tgpgsign = false\n[user]\n\tuseConfigOnly = true\n');
  const r = await pushLines(w, [[0, 'all']]);
  assert.equal(w.repo.git('log', '-1', '--format=%an <%ae>|%cn <%ce>', r.oid), 'git stash <git@stash>|git stash <git@stash>');
  assert.equal(w.repo.git('log', '-1', '--format=%an <%ae>', `${r.oid}^2`), 'git stash <git@stash>');
});

test('pushLines with an identity uses it', async (t) => {
  const w = await world(t);
  const r = await pushLines(w, [[0, 'all']]);
  assert.equal(w.repo.git('log', '-1', '--format=%an <%ae>', r.oid), 'T <t@example.com>');
});

test('applying a pushLines stash restores exactly the lines: applyFile into the edited file, pop onto a clean one', async (t) => {
  const w = await world(t);
  const r = await pushLines(w, [[1, 'all']]);
  assert.equal(read(w, 'f.txt'), text(BASE.map((l, i) => (i === 1 ? 'L2' : l))));
  await w.op('stash.applyFile', { oid: r.oid, path: 'f.txt' });
  assert.equal(read(w, 'f.txt'), text(EDITED));
  // git's merge refuses a file with local changes, so a whole pop needs the file clean.
  await assert.rejects(w.op('stash.pop', { oid: r.oid }), refused('CHECKOUT_CONFLICT'));
  w.repo.git('checkout', '-q', '--', 'f.txt');
  const popped = await w.op('stash.pop', { oid: r.oid });
  assert.equal(popped.dropped, true);
  assert.equal(read(w, 'f.txt'), text(BASE.map((l, i) => (i === 24 ? 'L25' : l))));
  assert.deepEqual(stashList(w), []);
});

test('pushLines whose worktree step fails keeps the stored stash and says so (step removeFromWorktree)', async (t) => {
  const w = await world(t);
  w.cc.state.execHook = (body) => (body.argv.includes('apply') && body.argv.includes('-R')
    ? { status: 200, body: { exitCode: 1, stdout: '', stderr: Buffer.from('error: patch failed\n').toString('base64'), encoding: 'base64', durationMs: 1 } }
    : undefined);
  await assert.rejects(pushLines(w, [[0, 'all']]), (e) => {
    assert.equal(e.code, 'GIT_FAILED');
    assert.equal(e.extra.step, 'removeFromWorktree');
    assert.equal(e.extra.oid, stashList(w)[0].oid);
    return true;
  });
  assert.equal(read(w, 'f.txt'), text(EDITED));
});

test('pushLines on an unborn HEAD → NO_HEAD; bad params → BAD_PARAMS', async (t) => {
  const w = await world(t);
  for (const p of [{ path: 'f.txt', hunks: [] }, { path: 'f.txt', hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }], message: 'a\nb' }, { path: 'f.txt', hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }], extra: 1 }]) {
    await assert.rejects(w.op('stash.pushLines', p), refused('BAD_PARAMS'));
  }
  w.repo.git('checkout', '-q', '--orphan', 'fresh');
  await assert.rejects(w.op('stash.pushLines', { path: 'f.txt', hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }] }), refused('NO_HEAD'));
});

test('pushLines onto a file now a symlink to an outside file: a type change, refused before any write; the outside file is untouched', async (t) => {
  const w = await world(t);
  const fd = await shown(w);
  const outside = path.join(w.repo.root, 'outside-f');
  fs.writeFileSync(outside, 'OUTSIDE\n');
  fs.rmSync(path.join(w.repo.dir, 'f.txt'));
  fs.symlinkSync(outside, path.join(w.repo.dir, 'f.txt'));
  w.cc.state.execCalls.length = 0;
  await assert.rejects(w.op('stash.pushLines', { path: 'f.txt', context: 3, hunks: request(fd, [[0, 'all']]) }), refused('PARTIAL_UNSUPPORTED'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE\n');
  assert.equal(fs.lstatSync(path.join(w.repo.dir, 'f.txt')).isSymbolicLink(), true);
  assert.deepEqual(stashList(w), []);
  assert.deepEqual([...runs(w, 'apply'), ...runs(w, 'stash', 'store')], []);
});

test('pushLines onto a directory or a link to a directory at the path → PATH_BLOCKED before any read or write', async (t) => {
  const w = await world(t);
  const fd = await shown(w);
  fs.rmSync(path.join(w.repo.dir, 'f.txt'));
  const outside = path.join(w.repo.root, 'outside-dir');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.repo.dir, 'f.txt'));
  w.cc.state.execCalls.length = 0;
  await assert.rejects(w.op('stash.pushLines', { path: 'f.txt', context: 3, hunks: request(fd, [[0, 'all']]) }), (e) => e.code === 'PATH_BLOCKED' && e.extra.paths.join() === 'f.txt');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual([...w.execArgv().filter((a) => a.includes('-U3')), ...runs(w, 'apply'), ...runs(w, 'stash', 'store')], []);
});

test('pushLines of a tracked symlink retargeted outside the repo: stashed, the link put back, the outside target untouched', async (t) => {
  const w = await world(t);
  fs.symlinkSync('g.txt', path.join(w.repo.dir, 'ln'));
  w.repo.git('add', 'ln');
  w.repo.git('commit', '-qm', 'add ln');
  const outside = path.join(w.repo.root, 'outside-target');
  fs.writeFileSync(outside, 'OUTSIDE\n');
  fs.rmSync(path.join(w.repo.dir, 'ln'));
  fs.symlinkSync(outside, path.join(w.repo.dir, 'ln'));
  const r = await pushLines(w, [[0, 'all']], {}, 'ln');
  assert.equal(blob(w, `${r.oid}:ln`), outside);
  assert.equal(fs.readlinkSync(path.join(w.repo.dir, 'ln')), 'g.txt');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE\n');
});
