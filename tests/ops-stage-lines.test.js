import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv } from './_git.js';
import { hostile, noViolations, opWorld, refused } from './_ops.js';

// Hunk and line staging against real git, under a hostile .git/config. Each test reads the file's diff with diff.file
// (as the UI does), selects by (hunk, line index) with the shown texts, and asserts the exact index / worktree bytes.

const nums = (n, f = (i) => `l${i}`) => Array.from({ length: n }, (_, i) => f(i + 1));
const text = (ls, eol = '\n') => ls.map((l) => l + eol).join('');

async function world(t, files) {
  const w = await opWorld(t);
  w.repo.commit(files);
  hostile(w.repo);
  return w;
}
const worktree = (w, p) => fs.readFileSync(path.join(w.repo.dir, p));
/** The file's diff as the UI loads it: unstaged (index → worktree) or staged (HEAD → index). */
const shown = (w, kind, p, context = 3) => w.op('diff.file', { source: { kind }, path: p, context, whitespace: 'none' });
/** A request for `picks` = [[hunk index, [line indices] | 'all']] over the shown FileDiff. */
function request(fd, picks) {
  return picks.map(([hi, idx]) => {
    const h = fd.hunks[hi];
    const indices = idx === 'all' ? h.lines.flatMap((l, i) => (l.kind === 'context' ? [] : [i])) : idx;
    return { header: h.header, lines: indices.map((i) => ({ index: i, text: h.lines[i].text })) };
  });
}
/** Index of the line in hunk `hi` with `kind` and `t`. */
const at = (fd, hi, kind, t) => {
  const i = fd.hunks[hi].lines.findIndex((l) => l.kind === kind && l.text === t);
  assert.notEqual(i, -1, `${kind} ${t}`);
  return i;
};
async function stageLines(w, p, picks, context = 3, op = 'stage.stageLines', kind = 'unstaged') {
  const fd = await shown(w, kind, p, context);
  return w.op(op, { path: p, context, hunks: request(fd, typeof picks === 'function' ? picks(fd) : picks) });
}

test('a whole hunk stages exactly that hunk; the second hunk then completes the file', async (t) => {
  const base = nums(30);
  const w = await world(t, { 'f.txt': text(base) });
  const edited = base.map((l, i) => (i === 1 ? 'L2' : i === 24 ? 'L25' : l));
  w.repo.write('f.txt', text(edited));
  await stageLines(w, 'f.txt', [[0, 'all']]);
  assert.equal(w.indexBlob('f.txt').toString(), text(base.map((l, i) => (i === 1 ? 'L2' : l))));
  assert.equal(worktree(w, 'f.txt').toString(), text(edited));
  await stageLines(w, 'f.txt', [[0, 'all']]);
  assert.equal(w.indexBlob('f.txt').toString(), text(edited));
  noViolations(w.cc);
});

test('added-only: one of two added lines is staged where it was added', async (t) => {
  const w = await world(t, { 'f.txt': text(nums(10)) });
  w.repo.write('f.txt', text([...nums(5), 'x', 'y', ...nums(10).slice(5)]));
  await stageLines(w, 'f.txt', (fd) => [[0, [at(fd, 0, 'add', 'y')]]]);
  assert.equal(w.indexBlob('f.txt').toString(), text([...nums(5), 'y', ...nums(10).slice(5)]));
});

test('removed-only: one of two removed lines is staged', async (t) => {
  const w = await world(t, { 'f.txt': text(nums(10)) });
  w.repo.write('f.txt', text(nums(10).filter((l) => l !== 'l3' && l !== 'l4')));
  await stageLines(w, 'f.txt', (fd) => [[0, [at(fd, 0, 'del', 'l4')]]]);
  assert.equal(w.indexBlob('f.txt').toString(), text(nums(10).filter((l) => l !== 'l4')));
});

test('a mixed partial pair: staging c → C out of c,d → C,D gives C then d', async (t) => {
  const w = await world(t, { 'f.txt': text(['a', 'b', 'c', 'd', 'e', 'f']) });
  w.repo.write('f.txt', text(['a', 'b', 'C', 'D', 'e', 'f']));
  await stageLines(w, 'f.txt', (fd) => [[0, [at(fd, 0, 'del', 'c'), at(fd, 0, 'add', 'C')]]]);
  assert.equal(w.indexBlob('f.txt').toString(), text(['a', 'b', 'C', 'd', 'e', 'f']));
  // The remaining pair stages on top.
  await stageLines(w, 'f.txt', (fd) => [[0, 'all']]);
  assert.equal(w.indexBlob('f.txt').toString(), text(['a', 'b', 'C', 'D', 'e', 'f']));
});

for (const context of [0, 3, 'full']) {
  test(`two hunks, context ${context}: lines from both stage with the later hunk shifted by the earlier`, async (t) => {
    const base = nums(40);
    const w = await world(t, { 'f.txt': text(base) });
    // Hunk 1 adds two lines after l3; hunk 2 replaces l30.
    const edited = [...base.slice(0, 3), 'x', 'y', ...base.slice(3)].map((l) => (l === 'l30' ? 'L30' : l));
    w.repo.write('f.txt', text(edited));
    await stageLines(w, 'f.txt', (fd) => {
      const last = fd.hunks.length - 1;
      return context === 'full'
        ? [[0, [at(fd, 0, 'add', 'x'), at(fd, 0, 'del', 'l30'), at(fd, 0, 'add', 'L30')]]]
        : [[0, [at(fd, 0, 'add', 'x')]], [last, 'all']];
    }, context);
    assert.equal(w.indexBlob('f.txt').toString(), text([...base.slice(0, 3), 'x', ...base.slice(3)].map((l) => (l === 'l30' ? 'L30' : l))));
  });
}

test('CRLF lines and a non-UTF-8 byte are staged byte for byte', async (t) => {
  const crlf = (ls) => Buffer.from(ls.map((l) => `${l}\r\n`).join(''), 'latin1');
  const w = await world(t, { 'f.txt': crlf(['one', 'caf\xe9', 'two', 'three']) });
  w.repo.write('f.txt', crlf(['one', 'CAF\xc9', 'two', 'THREE']));
  // The shown text of `CAF\xc9` is `CAF�\r`; the request carries exactly that.
  await stageLines(w, 'f.txt', (fd) => {
    const h = fd.hunks[0];
    return [[0, [h.lines.findIndex((l) => l.text === 'caf�\r'), h.lines.findIndex((l) => l.text === 'CAF�\r')]]];
  });
  assert.deepEqual(w.indexBlob('f.txt'), crlf(['one', 'CAF\xc9', 'two', 'three']));
});

test('no newline at EOF: losing and gaining the final newline stage as a pair; half of it is SELECTION_UNSUPPORTED', async (t) => {
  const w = await world(t, { 'lose.txt': 'a\nb\n', 'gain.txt': 'a\nb', 'swap.txt': 'a\nb' });
  w.repo.write('lose.txt', 'a\nB');
  w.repo.write('gain.txt', 'a\nb\n');
  w.repo.write('swap.txt', 'a\nc');
  await stageLines(w, 'lose.txt', [[0, 'all']]);
  assert.equal(w.indexBlob('lose.txt').toString(), 'a\nB');
  await stageLines(w, 'gain.txt', [[0, 'all']]);
  assert.equal(w.indexBlob('gain.txt').toString(), 'a\nb\n');
  await assert.rejects(stageLines(w, 'swap.txt', (fd) => [[0, [at(fd, 0, 'add', 'c')]]]), refused('SELECTION_UNSUPPORTED'));
  assert.equal(w.indexBlob('swap.txt').toString(), 'a\nb');
  // The removal alone is fine: the index keeps `a\n`.
  await stageLines(w, 'swap.txt', (fd) => [[0, [at(fd, 0, 'del', 'b')]]]);
  assert.equal(w.indexBlob('swap.txt').toString(), 'a\n');
});

test('unstage lines: one line of a staged change goes back to HEAD\'s version; the worktree is untouched', async (t) => {
  const w = await world(t, { 'f.txt': text(nums(10)) });
  const edited = [...nums(4), 'x', 'y', ...nums(10).slice(4)];
  w.repo.write('f.txt', text(edited));
  w.repo.git('add', 'f.txt');
  await stageLines(w, 'f.txt', (fd) => [[0, [at(fd, 0, 'add', 'x')]]], 3, 'stage.unstageLines', 'staged');
  assert.equal(w.indexBlob('f.txt').toString(), text([...nums(4), 'y', ...nums(10).slice(4)]));
  assert.equal(worktree(w, 'f.txt').toString(), text(edited));
});

test('unstage a mixed partial pair at context 0', async (t) => {
  const w = await world(t, { 'f.txt': text(['a', 'b', 'c', 'd', 'e']) });
  w.repo.write('f.txt', text(['a', 'B', 'C', 'd', 'e']));
  w.repo.git('add', 'f.txt');
  await stageLines(w, 'f.txt', (fd) => [[0, [at(fd, 0, 'del', 'c'), at(fd, 0, 'add', 'C')]]], 0, 'stage.unstageLines', 'staged');
  assert.equal(w.indexBlob('f.txt').toString(), text(['a', 'B', 'c', 'd', 'e']));
});

test('discard lines changes only the worktree, and its returned patch re-applied forward restores the discarded lines', async (t) => {
  const w = await world(t, { 'f.txt': text(nums(10)) });
  const edited = nums(10).map((l) => (l === 'l2' ? 'L2' : l === 'l8' ? 'L8' : l));
  w.repo.write('f.txt', text(edited));
  const r = await stageLines(w, 'f.txt', (fd) => [[0, [at(fd, 0, 'del', 'l2'), at(fd, 0, 'add', 'L2')]]], 3, 'stage.discardLines');
  assert.equal(worktree(w, 'f.txt').toString(), text(nums(10).map((l) => (l === 'l8' ? 'L8' : l))));
  assert.equal(w.indexBlob('f.txt').toString(), text(nums(10)));
  execFileSync('git', ['-C', w.repo.dir, 'apply', '-'], { input: Buffer.from(r.patchB64, 'base64'), env: hermeticEnv(w.repo.home) });
  assert.equal(worktree(w, 'f.txt').toString(), text(edited));
});

test('a hunk of a file whose mode also changed stages the content only: the index keeps the old mode', async (t) => {
  const w = await world(t, { 'run.sh': text(nums(5)) });
  w.repo.write('run.sh', text(nums(5).map((l) => (l === 'l3' ? 'L3' : l))));
  fs.chmodSync(path.join(w.repo.dir, 'run.sh'), 0o755);
  await stageLines(w, 'run.sh', [[0, 'all']]);
  assert.equal(w.indexBlob('run.sh').toString(), text(nums(5).map((l) => (l === 'l3' ? 'L3' : l))));
  assert.match(w.repo.git('ls-files', '-s', '--', 'run.sh'), /^100644 /);
});

test('STALE_DIFF when the file changed after its diff was shown; nothing is staged', async (t) => {
  const w = await world(t, { 'f.txt': text(nums(10)) });
  w.repo.write('f.txt', text(nums(10).map((l) => (l === 'l5' ? 'L5' : l))));
  const fd = await shown(w, 'unstaged', 'f.txt');
  const hunks = request(fd, [[0, 'all']]);
  w.repo.write('f.txt', text(nums(10).map((l) => (l === 'l5' ? 'L5!' : l))));
  await assert.rejects(w.op('stage.stageLines', { path: 'f.txt', context: 3, hunks }), refused('STALE_DIFF'));
  w.repo.write('f.txt', text([...nums(10).map((l) => (l === 'l5' ? 'L5' : l)), 'tail']));
  // Same hunk header? No: the counts moved, so the hunk is gone.
  await assert.rejects(w.op('stage.stageLines', { path: 'f.txt', context: 3, hunks }), refused('STALE_DIFF'));
  assert.equal(w.indexBlob('f.txt').toString(), text(nums(10)));
});

test('a change between the re-read and the apply fails GIT_FAILED with git\'s stderr, writing nothing', async (t) => {
  const w = await world(t, { 'f.txt': text(nums(10)) });
  w.repo.write('f.txt', text(nums(10).map((l) => (l === 'l5' ? 'L5' : l))));
  const fd = await shown(w, 'unstaged', 'f.txt');
  w.cc.state.execHook = (body) => (body.argv.includes('apply') ? 'hold' : undefined);
  const running = w.op('stage.stageLines', { path: 'f.txt', context: 3, hunks: request(fd, [[0, 'all']]) });
  const held = await w.cc.nextHeld();
  // Someone stages another version of the file's context meanwhile.
  const blob = execFileSync('git', ['-C', w.repo.dir, 'hash-object', '-w', '--stdin'], { input: text(nums(10).map((l) => (l === 'l4' ? 'X' : l))), env: hermeticEnv(w.repo.home) }).toString().trim();
  w.repo.git('update-index', '--cacheinfo', `100644,${blob},f.txt`);
  held.release();
  await assert.rejects(running, (e) => e.code === 'GIT_FAILED' && /does not apply|patch failed/.test(e.extra.stderr));
  assert.equal(w.indexBlob('f.txt').toString(), text(nums(10).map((l) => (l === 'l4' ? 'X' : l))));
});

test('PARTIAL_UNSUPPORTED for added, deleted, renamed, untracked, binary, submodule, conflicted and unborn files', async (t) => {
  const w = await world(t, { 'del.txt': 'd\n', 'ren.txt': 'r\n', 'bin.dat': Buffer.from([0, 1, 2]), 'c.txt': 'base\n' });
  const any = [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }] }];
  const partial = (op, p) => assert.rejects(w.op(op, { path: p, hunks: any }), refused('PARTIAL_UNSUPPORTED'), `${op} ${p}`);
  w.repo.write('new.txt', 'n\n');
  w.repo.git('add', 'new.txt');
  await partial('stage.unstageLines', 'new.txt');
  fs.rmSync(path.join(w.repo.dir, 'del.txt'));
  await partial('stage.stageLines', 'del.txt');
  await partial('stage.discardLines', 'del.txt');
  w.repo.git('mv', 'ren.txt', 'moved.txt');
  await partial('stage.unstageLines', 'moved.txt');
  w.repo.write('untracked.txt', 'u\n');
  await partial('stage.stageLines', 'untracked.txt');
  w.repo.write('bin.dat', Buffer.from([0, 9, 9]));
  await partial('stage.stageLines', 'bin.dat');
  fs.mkdirSync(path.join(w.repo.dir, 'vendor', 'lib'), { recursive: true });
  w.repo.git('update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendor/lib`);
  w.repo.git('commit', '-q', '-m', 'gitlink');
  w.repo.git('update-index', '--cacheinfo', `160000,${'2'.repeat(40)},vendor/lib`);
  await partial('stage.unstageLines', 'vendor/lib');
  w.repo.branch('other');
  w.repo.commit({ 'c.txt': 'theirs\n' }, 'theirs');
  w.repo.checkout('main');
  w.repo.git('reset', '-q');
  w.repo.git('stash', '-q', '-u');
  w.repo.commit({ 'c.txt': 'ours\n' }, 'ours');
  assert.throws(() => w.repo.git('merge', '-q', 'other'));
  await partial('stage.stageLines', 'c.txt');
  const unborn = await opWorld(t, { name: 'unborn' });
  unborn.repo.write('a.txt', 'a\n');
  unborn.repo.git('add', 'a.txt');
  await assert.rejects(unborn.op('stage.unstageLines', { path: 'a.txt', hunks: any }), refused('PARTIAL_UNSUPPORTED'));
});

test('params: path, context and a non-empty, duplicate-free selection', async (t) => {
  const w = await world(t, { 'f.txt': 'a\n' });
  const line = { index: 1, text: 'x' };
  const hunk = { header: '@@ -1 +1 @@', lines: [line] };
  for (const p of [
    { path: 'f.txt', hunks: [] },
    { path: 'f.txt', hunks: [{ header: '@@ -1 +1 @@', lines: [] }] },
    { path: 'f.txt', hunks: [hunk, hunk] },
    { path: 'f.txt', hunks: [{ ...hunk, lines: [line, line] }] },
    { path: 'f.txt', hunks: [{ ...hunk, header: 'not a header' }] },
    { path: 'f.txt', hunks: [{ ...hunk, header: `@@ ${'x'.repeat(4096)}` }] },
    { path: 'f.txt', hunks: [{ ...hunk, lines: [{ index: -1, text: 'x' }] }] },
    { path: 'f.txt', hunks: [{ ...hunk, lines: [{ index: 1.5, text: 'x' }] }] },
    { path: 'f.txt', hunks: [{ ...hunk, lines: [{ index: 1, text: 2 }] }] },
    { path: 'f.txt', hunks: [{ ...hunk, extra: 1 }] },
    { path: 'f.txt', hunks: [hunk], context: 1001 },
    { path: 'f.txt', hunks: [hunk], whitespace: 'all' },
  ]) await assert.rejects(w.op('stage.stageLines', p), refused('BAD_PARAMS'), JSON.stringify(p).slice(0, 80));
  await assert.rejects(w.op('stage.stageLines', { path: '../f', hunks: [hunk] }), refused('BAD_PATH'));
  assert.equal(w.cc.state.execCalls.length, 0);
});
