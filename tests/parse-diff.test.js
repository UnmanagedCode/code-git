import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLfs, parseFilePatch, parseRawNumstat } from '../src/git/parse/diff.js';

const O1 = '1'.repeat(40);
const O2 = '2'.repeat(40);
const Z = '0'.repeat(40);
const rec = (m1, m2, o1, o2, s, ...paths) => [`:${m1} ${m2} ${o1} ${o2} ${s}`, ...paths];
const nul = (...fields) => `${fields.join('\0')}\0`;

test('parseRawNumstat: modify, add, delete, rename with score, binary, mode change; joined by record order', () => {
  const out = nul(
    ...rec('100644', '100644', O1, O2, 'M', 'a.txt'),
    ...rec('000000', '100644', Z, O2, 'A', 'new.txt'),
    ...rec('100644', '000000', O1, Z, 'D', 'gone.txt'),
    ...rec('100644', '100644', O1, O2, 'R087', 'old/x.js', 'new/x.js'),
    ...rec('100644', '100644', O1, O2, 'M', 'bin.dat'),
    ...rec('100644', '100755', O1, O1, 'M', 'run.sh'),
    '3\t1\ta.txt', '2\t0\tnew.txt', '0\t4\tgone.txt', '1\t1\t', 'old/x.js', 'new/x.js', '-\t-\tbin.dat', '0\t0\trun.sh',
  );
  const files = parseRawNumstat(out);
  assert.deepEqual(files.map((f) => [f.path, f.oldPath, f.status, f.similarity, f.added, f.deleted, f.binary]), [
    ['a.txt', null, 'M', null, 3, 1, false],
    ['new.txt', null, 'A', null, 2, 0, false],
    ['gone.txt', null, 'D', null, 0, 4, false],
    ['new/x.js', 'old/x.js', 'R', 87, 1, 1, false],
    ['bin.dat', null, 'M', null, null, null, true],
    ['run.sh', null, 'M', null, 0, 0, false],
  ]);
  assert.deepEqual([files[1].oldMode, files[1].newMode, files[1].oldOid, files[1].newOid], [null, '100644', null, O2]);
  assert.deepEqual([files[2].newMode, files[2].newOid], [null, null]);
  assert.deepEqual([files[5].oldMode, files[5].newMode], ['100644', '100755']);
  assert.equal(files.some((f) => f.submodule), false);
});

test('parseRawNumstat: paths with a space, a tab, a newline and a leading colon are taken from NUL fields verbatim', () => {
  const odd = ['a b.txt', 'tab\there', 'new\nline', ':colon'];
  const out = nul(...odd.flatMap((p) => rec('100644', '100644', O1, O2, 'M', p)), ...odd.map((p) => `1\t1\t${p}`));
  assert.deepEqual(parseRawNumstat(out).map((f) => f.path), odd);
});

test('parseRawNumstat: a gitlink on either side is a submodule; an empty output is no files', () => {
  const out = nul(...rec('160000', '160000', O1, O2, 'M', 'vendor/lib'), ...rec('000000', '160000', Z, O2, 'A', 'vendor/new'), '1\t1\tvendor/lib', '1\t0\tvendor/new');
  assert.deepEqual(parseRawNumstat(out).map((f) => f.submodule), [true, true]);
  assert.deepEqual(parseRawNumstat(''), []);
});

test('parseRawNumstat: an unmerged path listed twice (U then M) keeps only its U entry', () => {
  const out = nul(
    ...rec('000000', '100644', Z, Z, 'U', 'c.txt'), ...rec('100644', '100644', O1, Z, 'M', 'c.txt'), ...rec('100644', '100644', O1, Z, 'M', 'other.txt'),
    '0\t0\tc.txt', '4\t0\tc.txt', '1\t1\tother.txt',
  );
  const files = parseRawNumstat(out);
  assert.deepEqual(files.map((f) => [f.path, f.status, f.added]), [['c.txt', 'U', 0], ['other.txt', 'M', 1]]);
});

test('parseRawNumstat: raw and numstat record counts that disagree throw instead of misjoining', () => {
  assert.throws(() => parseRawNumstat(nul(...rec('100644', '100644', O1, O2, 'M', 'a'))), /numstat/);
  assert.throws(() => parseRawNumstat(nul('garbage')), /malformed/);
});

const patch = (...lines) => `${lines.join('\n')}\n`;

test('parseFilePatch: header modes and hunks with line numbers; multiple hunks', () => {
  const p = parseFilePatch(patch(
    'diff --git a/f.txt b/f.txt', 'old mode 100644', 'new mode 100755', 'index 1111111..2222222', '--- a/f.txt', '+++ b/f.txt',
    '@@ -1,3 +1,3 @@ fn top', ' a', '-b', '+B', ' c',
    '@@ -10,2 +10,3 @@', ' x', '+y', ' z',
  ));
  assert.equal(p.oldMode, '100644');
  assert.equal(p.newMode, '100755');
  assert.equal(p.binary, false);
  assert.equal(p.unmerged, false);
  assert.deepEqual(p.hunks.map((h) => [h.header, h.oldStart, h.oldLines, h.newStart, h.newLines]), [
    ['@@ -1,3 +1,3 @@ fn top', 1, 3, 1, 3], ['@@ -10,2 +10,3 @@', 10, 2, 10, 3],
  ]);
  assert.deepEqual(p.hunks[0].lines.map((l) => [l.kind, l.text, l.oldNo, l.newNo]), [
    ['context', 'a', 1, 1], ['del', 'b', 2, null], ['add', 'B', null, 2], ['context', 'c', 3, 3],
  ]);
  assert.deepEqual(p.hunks[1].lines.map((l) => [l.kind, l.oldNo, l.newNo]), [['context', 10, 10], ['add', null, 11], ['context', 11, 12]]);
});

test('parseFilePatch: the mode on the index line fills both modes; new and deleted files set one side', () => {
  assert.deepEqual(Object.values(pick(parseFilePatch(patch('diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '-a', '+b')))), ['100644', '100644']);
  const added = parseFilePatch(patch('diff --git a/n b/n', 'new file mode 100755', 'index 0000000..2', '--- /dev/null', '+++ b/n', '@@ -0,0 +1,2 @@', '+x', '+y'));
  assert.deepEqual(Object.values(pick(added)), [null, '100755']);
  assert.deepEqual(added.hunks[0].lines.map((l) => [l.kind, l.newNo]), [['add', 1], ['add', 2]]);
  const deleted = parseFilePatch(patch('diff --git a/d b/d', 'deleted file mode 100644', 'index 1..0000000', '--- a/d', '+++ /dev/null', '@@ -1 +0,0 @@', '-x'));
  assert.deepEqual(Object.values(pick(deleted)), ['100644', null]);
});
const pick = (p) => ({ oldMode: p.oldMode, newMode: p.newMode });

test('parseFilePatch: hunks are consumed by count, so content reading like a header stays content', () => {
  const p = parseFilePatch(patch(
    'diff --git a/x b/x', 'index 1..2 100644', '--- a/x', '+++ b/x',
    '@@ -1,3 +1,4 @@', '-diff --git a/x b/x', '+@@ -1 +1 @@', '+--- a', '++++ b', ' diff --git a/y b/y', '-@@ -9 +9 @@',
  ));
  assert.equal(p.hunks.length, 1);
  assert.deepEqual(p.hunks[0].lines.map((l) => [l.kind, l.text]), [
    ['del', 'diff --git a/x b/x'], ['add', '@@ -1 +1 @@'], ['add', '--- a'], ['add', '+++ b'], ['context', 'diff --git a/y b/y'], ['del', '@@ -9 +9 @@'],
  ]);
});

test('parseFilePatch: "\\ No newline at end of file" marks the line before it, also after the counts are spent', () => {
  const p = parseFilePatch(patch('diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file'));
  assert.deepEqual(p.hunks[0].lines.map((l) => [l.kind, l.text, l.noNewline]), [['del', 'a', true], ['add', 'b', true]]);
});

test('parseFilePatch: a bare empty line inside a hunk is a blank context line and the numbering stays right', () => {
  const p = parseFilePatch(patch('diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', '@@ -1,4 +1,4 @@', ' a', '', '-b', '+B', ''));
  assert.deepEqual(p.hunks[0].lines.map((l) => [l.kind, l.text, l.oldNo, l.newNo]), [
    ['context', 'a', 1, 1], ['context', '', 2, 2], ['del', 'b', 3, null], ['add', 'B', null, 3], ['context', '', 4, 4],
  ]);
});

test('parseFilePatch: binary, unmerged (diff --cc), and rename-only / mode-only patches have no hunks', () => {
  const bin = parseFilePatch(patch('diff --git a/b b/b', 'index 1..2 100644', 'Binary files a/b and b/b differ'));
  assert.equal(bin.binary, true);
  assert.deepEqual(bin.hunks, []);
  const cc = parseFilePatch(patch('diff --cc c.txt', 'index 1,2..0000000', '--- a/c.txt', '+++ b/c.txt', '@@@ -1,1 -1,1 +1,5 @@@', '++<<<<<<< HEAD', ' +main'));
  assert.equal(cc.unmerged, true);
  assert.deepEqual(cc.hunks, []);
  const ren = parseFilePatch(patch('diff --git a/o b/n', 'similarity index 100%', 'rename from o', 'rename to n'));
  assert.deepEqual(ren.hunks, []);
  const mode = parseFilePatch(patch('diff --git a/s b/s', 'old mode 100644', 'new mode 100755'));
  assert.deepEqual([mode.oldMode, mode.newMode, mode.hunks.length], ['100644', '100755', 0]);
  assert.deepEqual(parseFilePatch('').hunks, []);
});

test('parseFilePatch: only the first file section is read', () => {
  const p = parseFilePatch(patch('diff --git a/a b/a', 'index 1..2 100644', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-1', '+2', 'diff --git a/b b/b', 'index 1..2 100644', '--- a/b', '+++ b/b', '@@ -1 +1 @@', '-x', '+y'));
  assert.equal(p.hunks.length, 1);
  assert.deepEqual(p.hunks[0].lines.map((l) => l.text), ['1', '2']);
});

test('parseFilePatch: a hunk shorter than its counts, or a line that fits no count, throws', () => {
  assert.throws(() => parseFilePatch(patch('diff --git a/f b/f', '@@ -1,3 +1,3 @@', ' a')), /counts/);
  assert.throws(() => parseFilePatch(patch('diff --git a/f b/f', '@@ -1 +1 @@', '-a', '-b')), /counts/);
});

test('parseFilePatch: a gitlink yields submodule pointers (dirty too) and never text hunks', () => {
  const sub = parseFilePatch(patch('diff --git a/v b/v', `index 1111111..2222222 160000`, '--- a/v', '+++ b/v', '@@ -1 +1 @@', `-Subproject commit ${'1'.repeat(40)}`, `+Subproject commit ${'2'.repeat(40)}`));
  assert.deepEqual(sub.submodule, { old: '1'.repeat(40), new: '2'.repeat(40), dirty: false });
  assert.deepEqual(sub.hunks, []);
  const dirty = parseFilePatch(patch('diff --git a/v b/v', 'index 1111111..1111111 160000', '--- a/v', '+++ b/v', '@@ -1 +1 @@', `-Subproject commit ${'1'.repeat(40)}`, `+Subproject commit ${'1'.repeat(40)}-dirty`));
  assert.deepEqual(dirty.submodule, { old: '1'.repeat(40), new: '1'.repeat(40), dirty: true });
  const added = parseFilePatch(patch('diff --git a/v b/v', 'new file mode 160000', 'index 0000000..2222222', '--- /dev/null', '+++ b/v', '@@ -0,0 +1 @@', `+Subproject commit ${'2'.repeat(40)}`));
  assert.deepEqual(added.submodule, { old: null, new: '2'.repeat(40), dirty: false });
  assert.equal(parseFilePatch(patch('diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '-Subproject commit 1', '+x')).submodule, null);
});

const ptr = (c, size) => ['version https://git-lfs.github.com/spec/v1', `oid sha256:${c.repeat(64)}`, `size ${size}`];
const hunkOf = (oldStart, oldText, newStart, newText, common = 0) => {
  const lines = [
    ...oldText.slice(0, common).map((text, i) => ({ kind: 'context', text, oldNo: i + 1, newNo: i + 1, noNewline: false })),
    ...oldText.slice(common).map((text) => ({ kind: 'del', text, oldNo: 0, newNo: null, noNewline: false })),
    ...newText.slice(common).map((text) => ({ kind: 'add', text, oldNo: null, newNo: 0, noNewline: false })),
  ];
  return { header: '@@', oldStart, oldLines: oldText.length, newStart, newLines: newText.length, lines };
};

test('detectLfs: spec v1 pointers on both sides, or on the new side of an added file', () => {
  assert.deepEqual(detectLfs([hunkOf(1, ptr('a', 12), 1, ptr('b', 34), 1)]), { old: { oid: 'a'.repeat(64), size: 12 }, new: { oid: 'b'.repeat(64), size: 34 } });
  assert.deepEqual(detectLfs([hunkOf(0, [], 1, ptr('c', 5))]), { old: null, new: { oid: 'c'.repeat(64), size: 5 } });
});

test('detectLfs: a non-pointer file, a bad oid length, a hunk not starting at line 1, or several hunks → null', () => {
  assert.equal(detectLfs([hunkOf(1, ['a', 'b', 'c'], 1, ['a', 'B', 'c'])]), null);
  const short = ['version https://git-lfs.github.com/spec/v1', `oid sha256:${'a'.repeat(63)}`, 'size 1'];
  assert.equal(detectLfs([hunkOf(1, short, 1, short)]), null);
  assert.equal(detectLfs([hunkOf(2, ptr('a', 1), 2, ptr('b', 2))]), null);
  assert.equal(detectLfs([hunkOf(1, ptr('a', 1), 1, ptr('b', 2)), hunkOf(1, ptr('a', 1), 1, ptr('b', 2))]), null);
  assert.equal(detectLfs([]), null);
});
