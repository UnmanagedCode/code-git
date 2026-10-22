import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asShown, buildSelectionPatch } from '../src/git/stage/selection.js';

// Pure: one file's diff text (latin1, as the op decodes it) + a selection → the exact patch text.

const HEAD = ['diff --git a/f b/f', 'index 1111111..2222222 100644', '--- a/f', '+++ b/f'];
const KEPT = ['diff --git a/f b/f', '--- a/f', '+++ b/f'];
const diff = (...hunks) => `${[...HEAD, ...hunks.flat()].join('\n')}\n`;
const patch = (...lines) => `${[...KEPT, ...lines].join('\n')}\n`;
/** A request selecting `indices` of the hunk with `header` in `text`, with the texts as the UI was shown them. */
const pick = (header, lines) => ({ header, lines: lines.map(([index, text]) => ({ index, text })) });
const refused = (code) => (e) => { assert.equal(e.code, code, e.message); return true; };

const MIXED = ['@@ -1,6 +1,6 @@ fn', ' a', ' b', '-c', '-d', '+C', '+D', ' e', ' f'];

test('forward: a selected −/+ pair is kept, the unselected del becomes context, the unselected add is dropped', () => {
  const out = buildSelectionPatch(diff(MIXED), [pick('@@ -1,6 +1,6 @@ fn', [[2, 'c'], [4, 'C']])], 'forward');
  // Old side a b c d e f (git's start and count); new side a b C d e f.
  assert.equal(out, patch('@@ -1,6 +1,6 @@', ' a', ' b', '-c', '+C', ' d', ' e', ' f'));
});

test('forward: the second pair alone lands after the kept first line', () => {
  const out = buildSelectionPatch(diff(MIXED), [pick('@@ -1,6 +1,6 @@ fn', [[3, 'd'], [5, 'D']])], 'forward');
  assert.equal(out, patch('@@ -1,6 +1,6 @@', ' a', ' b', ' c', '-d', '+D', ' e', ' f'));
});

test('reverse: a selected −/+ pair is kept, the unselected add becomes context, the unselected del is dropped', () => {
  const out = buildSelectionPatch(diff(MIXED), [pick('@@ -1,6 +1,6 @@ fn', [[2, 'c'], [4, 'C']])], 'reverse');
  // New side a b C D e f (git's); old side (the result of -R) a b c D e f.
  assert.equal(out, patch('@@ -1,6 +1,6 @@', ' a', ' b', '-c', '+C', ' D', ' e', ' f'));
});

test('forward counts: an added-only selection grows the new side; later hunks start after the growth', () => {
  const text = diff(['@@ -1,2 +1,4 @@', ' a', '+x', '+y', ' b'], ['@@ -10,2 +12,3 @@', ' j', '+z', ' k']);
  const out = buildSelectionPatch(text, [pick('@@ -1,2 +1,4 @@', [[2, 'y']]), pick('@@ -10,2 +12,3 @@', [[1, 'z']])], 'forward');
  assert.equal(out, patch('@@ -1,2 +1,3 @@', ' a', '+y', ' b', '@@ -10,2 +11,3 @@', ' j', '+z', ' k'));
});

test('forward: an unrequested earlier hunk shifts nothing', () => {
  const text = diff(['@@ -1,2 +1,4 @@', ' a', '+x', '+y', ' b'], ['@@ -10,2 +12,3 @@', ' j', '+z', ' k']);
  const out = buildSelectionPatch(text, [pick('@@ -10,2 +12,3 @@', [[1, 'z']])], 'forward');
  assert.equal(out, patch('@@ -10,2 +10,3 @@', ' j', '+z', ' k'));
});

test('reverse counts: the new side keeps git numbers, the old side shifts by earlier hunks', () => {
  const text = diff(['@@ -1,2 +1,4 @@', ' a', '+x', '+y', ' b'], ['@@ -10,3 +12,2 @@', ' j', '-q', ' k']);
  const out = buildSelectionPatch(text, [pick('@@ -1,2 +1,4 @@', [[1, 'x']]), pick('@@ -10,3 +12,2 @@', [[1, 'q']])], 'reverse');
  // Hunk 1: new a x y b (4), old a y b (3) → delta −1; hunk 2 old start = 12 − 1 + (−1) + 1 = 11.
  assert.equal(out, patch('@@ -1,3 +1,4 @@', ' a', '+x', ' y', ' b', '@@ -11,3 +12,2 @@', ' j', '-q', ' k'));
});

test('a removed-only selection, both directions', () => {
  const text = diff(['@@ -1,4 +1,2 @@', ' a', '-x', '-y', ' b']);
  const req = [pick('@@ -1,4 +1,2 @@', [[2, 'y']])];
  assert.equal(buildSelectionPatch(text, req, 'forward'), patch('@@ -1,4 +1,3 @@', ' a', ' x', '-y', ' b'));
  assert.equal(buildSelectionPatch(text, req, 'reverse'), patch('@@ -1,3 +1,2 @@', ' a', '-y', ' b'));
});

test('context 0: an empty side counts from the line before it (git\'s convention)', () => {
  const adds = diff(['@@ -3,0 +4,2 @@', '+x', '+y']);
  assert.equal(buildSelectionPatch(adds, [pick('@@ -3,0 +4,2 @@', [[1, 'y']])], 'forward'), patch('@@ -3,0 +4,1 @@', '+y'));
  const dels = diff(['@@ -4,2 +3,0 @@', '-x', '-y']);
  assert.equal(buildSelectionPatch(dels, [pick('@@ -4,2 +3,0 @@', [[0, 'x']])], 'forward'), patch('@@ -4,2 +4,1 @@', '-x', ' y'));
  assert.equal(buildSelectionPatch(dels, [pick('@@ -4,2 +3,0 @@', [[0, 'x']])], 'reverse'), patch('@@ -4,1 +3,0 @@', '-x'));
  const atTop = diff(['@@ -0,0 +1,2 @@', '+x', '+y']);
  assert.equal(buildSelectionPatch(atTop, [pick('@@ -0,0 +1,2 @@', [[0, 'x']])], 'forward'), patch('@@ -0,0 +1,1 @@', '+x'));
});

const NL = '\\ No newline at end of file';

test('no newline at EOF: markers follow their lines on every side they belong to', () => {
  const text = diff(['@@ -1,2 +1,2 @@', ' a', '-b', NL, '+c', NL]);
  const both = [pick('@@ -1,2 +1,2 @@', [[1, 'b'], [2, 'c']])];
  assert.equal(buildSelectionPatch(text, both, 'forward'), patch('@@ -1,2 +1,2 @@', ' a', '-b', NL, '+c', NL));
  // The del alone: the new side ends at `a` (with its newline).
  assert.equal(buildSelectionPatch(text, [pick('@@ -1,2 +1,2 @@', [[1, 'b']])], 'forward'), patch('@@ -1,2 +1,1 @@', ' a', '-b', NL));
  // The add alone, reversed: the result keeps `a` and `c`.
  assert.equal(buildSelectionPatch(text, [pick('@@ -1,2 +1,2 @@', [[2, 'c']])], 'reverse'), patch('@@ -1,1 +1,2 @@', ' a', '+c', NL));
});

test('SELECTION_UNSUPPORTED when a no-newline line would stop being its side\'s last line', () => {
  const text = diff(['@@ -1,2 +1,2 @@', ' a', '-b', NL, '+c', NL]);
  // Forward, add only: `b` (no newline) becomes context and `+c` follows it.
  assert.throws(() => buildSelectionPatch(text, [pick('@@ -1,2 +1,2 @@', [[2, 'c']])], 'forward'), refused('SELECTION_UNSUPPORTED'));
  // Reverse, del only: `c` (no newline) becomes context after `-b`.
  assert.throws(() => buildSelectionPatch(text, [pick('@@ -1,2 +1,2 @@', [[1, 'b']])], 'reverse'), refused('SELECTION_UNSUPPORTED'));
  // A file gaining its final newline: `-a⧵ +a`; the add alone, forward.
  const gain = diff(['@@ -1 +1 @@', '-a', NL, '+a']);
  assert.throws(() => buildSelectionPatch(gain, [pick('@@ -1 +1 @@', [[1, 'a']])], 'forward'), refused('SELECTION_UNSUPPORTED'));
  assert.equal(buildSelectionPatch(gain, [pick('@@ -1 +1 @@', [[0, 'a'], [1, 'a']])], 'forward'), patch('@@ -1,1 +1,1 @@', '-a', NL, '+a'));
});

test('bytes survive: CR, latin1 and invalid UTF-8 are matched by their shown text and emitted unchanged', () => {
  // `\xe9` alone is not UTF-8 (shown as U+FFFD); `\xc3\xa9` is é.
  const text = diff(['@@ -1,2 +1,2 @@', ' ok\r', '-caf\xe9\r', '+caf\xc3\xa9\r']);
  assert.equal(asShown('caf\xe9\r'), 'caf�\r');
  assert.equal(asShown('caf\xc3\xa9\r'), 'café\r');
  const out = buildSelectionPatch(text, [pick('@@ -1,2 +1,2 @@', [[1, 'caf�\r'], [2, 'café\r']])], 'forward');
  assert.deepEqual(Buffer.from(out, 'latin1'), Buffer.from(patch('@@ -1,2 +1,2 @@', ' ok\r', '-caf\xe9\r', '+caf\xc3\xa9\r'), 'latin1'));
});

test('header: git\'s diff --git, ---, +++ kept verbatim; index and mode lines dropped', () => {
  const text = `${['diff --git a/sp ace b/sp ace', 'old mode 100644', 'new mode 100755', 'index 1..2', '--- a/sp ace', '+++ b/sp ace', '@@ -1 +1 @@', '-x', '+y'].join('\n')}\n`;
  const out = buildSelectionPatch(text, [pick('@@ -1 +1 @@', [[0, 'x']])], 'forward');
  assert.equal(out, `${['diff --git a/sp ace b/sp ace', '--- a/sp ace', '+++ b/sp ace', '@@ -1,1 +0,0 @@', '-x'].join('\n')}\n`);
});

test('PARTIAL_UNSUPPORTED for added, deleted, renamed, copied, conflicted, binary, gitlink and hunk-less files', () => {
  const req = [pick('@@ -1 +1 @@', [[0, 'x']])];
  const hunk = ['@@ -1 +1 @@', '-x', '+y'];
  const cases = [
    ['diff --git a/f b/f', 'new file mode 100644', '--- /dev/null', '+++ b/f', ...hunk],
    ['diff --git a/f b/f', 'deleted file mode 100644', '--- a/f', '+++ /dev/null', ...hunk],
    ['diff --git a/e b/f', 'similarity index 90%', 'rename from e', 'rename to f', '--- a/e', '+++ b/f', ...hunk],
    ['diff --git a/e b/f', 'similarity index 90%', 'copy from e', 'copy to f', '--- a/e', '+++ b/f', ...hunk],
    ['diff --cc f', 'index 1,2..3', '--- a/f', '+++ b/f', '@@@ -1,1 -1,1 +1,1 @@@'],
    ['diff --git a/f b/f', 'index 1..2 100644', 'Binary files a/f and b/f differ'],
    ['diff --git a/f b/f', 'index 1..2 100644', 'GIT binary patch', 'literal 1', 'zcmV'],
    ['diff --git a/f b/f', 'index 1..2 160000', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '-Subproject commit 1', '+Subproject commit 2'],
    ['diff --git a/f b/f', 'old mode 100644', 'new mode 100755'],
  ];
  for (const c of cases) assert.throws(() => buildSelectionPatch(`${c.join('\n')}\n`, req, 'forward'), refused('PARTIAL_UNSUPPORTED'), c[1]);
});

test('STALE_DIFF: a gone hunk, an index out of range or on context, a different text', () => {
  const text = diff(MIXED);
  for (const req of [
    pick('@@ -1,6 +1,6 @@ other', [[2, 'c']]),
    pick('@@ -1,6 +1,6 @@ fn', [[99, 'c']]),
    pick('@@ -1,6 +1,6 @@ fn', [[0, 'a']]),
    pick('@@ -1,6 +1,6 @@ fn', [[2, 'changed']]),
  ]) assert.throws(() => buildSelectionPatch(text, [req], 'forward'), refused('STALE_DIFF'), JSON.stringify(req));
  // An empty diff (nothing left to stage): the hunk is gone too.
  assert.throws(() => buildSelectionPatch('', [pick('@@ -1 +1 @@', [[0, 'x']])], 'forward'), refused('PARTIAL_UNSUPPORTED'));
});

test('a request made against a context-0 diff is mapped by line number and text onto the apply diff, and built from it', () => {
  const shown = diff(['@@ -3 +3 @@', '-c', '+C']);
  const apply = diff(['@@ -1,5 +1,5 @@', ' a', ' b', '-c', '+C', ' d', ' e']);
  const req = [pick('@@ -3 +3 @@', [[0, 'c'], [1, 'C']])];
  assert.equal(buildSelectionPatch(shown, req, 'forward', apply), patch('@@ -1,5 +1,5 @@', ' a', ' b', '-c', '+C', ' d', ' e'));
  // The add alone: the del becomes context in the apply diff's hunk.
  assert.equal(buildSelectionPatch(shown, [pick('@@ -3 +3 @@', [[1, 'C']])], 'forward', apply), patch('@@ -1,5 +1,6 @@', ' a', ' b', ' c', '+C', ' d', ' e'));
  // A line whose number or text differs in the apply read (the file moved between the reads): STALE_DIFF.
  const moved = diff(['@@ -1,5 +1,5 @@', ' a', ' b', '-x', '+C', ' d', ' e']);
  assert.throws(() => buildSelectionPatch(shown, req, 'forward', moved), refused('STALE_DIFF'));
  const shifted = diff(['@@ -2,5 +2,5 @@', ' a', ' b', '-c', '+C', ' d', ' e']);
  assert.throws(() => buildSelectionPatch(shown, req, 'forward', shifted), refused('STALE_DIFF'));
});
