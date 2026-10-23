import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBlame, unquoteC } from '../src/git/parse/history.js';

// Invariant: unquoteC reverses git's C quoting (\" \\ \t \n and the other single-letter escapes, octal \nnn bytes decoded
// as UTF-8) and leaves an unquoted value as it is.
test('unquoteC: escapes and octal bytes; an unquoted value unchanged', () => {
  assert.equal(unquoteC('plain name.txt'), 'plain name.txt');
  assert.equal(unquoteC('"q\\"uote.txt"'), 'q"uote.txt');
  assert.equal(unquoteC('"back\\\\slash"'), 'back\\slash');
  assert.equal(unquoteC('"a\\tb\\nc"'), 'a\tb\nc');
  assert.equal(unquoteC('"bell\\a vt\\v ff\\f cr\\r bs\\b"'), 'bell\x07 vt\x0b ff\x0c cr\r bs\b');
  assert.equal(unquoteC('"ctl\\001x"'), 'ctl\x01x');
  assert.equal(unquoteC('"caf\\303\\251"'), 'café');
  assert.equal(unquoteC('"🎉 \\"x\\" é"'), '🎉 "x" é', 'characters outside the BMP and unescaped non-ASCII pass through');
  assert.equal(unquoteC('"x"y'), '"x"y', 'not a whole quoted value: as it is');
});

// Invariant: parseBlame unquotes a quoted `filename` and the path of `previous`.
test('parseBlame unquotes filename and previous', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const out = `${a} 1 1 1\nauthor A\nsummary s\nprevious ${b} "q\\"old.txt"\nfilename "q\\"new.txt"\n\tline\n`;
  const { commits } = parseBlame(out);
  assert.deepEqual([commits[a].filename, commits[a].previous, commits[a].previousPath], ['q"new.txt', b, 'q"old.txt']);
});
