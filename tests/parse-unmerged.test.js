import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUnmerged } from '../src/git/parse/unmerged.js';

const B = 'b'.repeat(40);
const O = 'c'.repeat(40);
const T = 'd'.repeat(40);
const rec = (mode, oid, stage, path) => `${mode} ${oid} ${stage}\t${path}\0`;
const side = (mode, oid) => ({ mode, oid });

test('each combination of stages names its conflict kind; absent stages are null', () => {
  const cases = [
    [[1, 2, 3], 'bothModified'], [[2, 3], 'bothAdded'], [[1, 2], 'deletedByThem'], [[1, 3], 'deletedByUs'],
    [[2], 'addedByUs'], [[3], 'addedByThem'], [[1], 'bothDeleted'],
  ];
  const oidOf = { 1: B, 2: O, 3: T };
  for (const [stages, kind] of cases) {
    const out = stages.map((s) => rec('100644', oidOf[s], s, 'f.txt')).join('');
    const [c] = parseUnmerged(out);
    assert.equal(c.kind, kind, stages.join());
    assert.deepEqual([c.base, c.ours, c.theirs], [1, 2, 3].map((s) => (stages.includes(s) ? side('100644', oidOf[s]) : null)), kind);
  }
});

test('modes are kept per side (a symlink against a file, a gitlink), paths in git\'s order, one entry per path', () => {
  const out = rec('120000', B, 1, 'link') + rec('120000', O, 2, 'link') + rec('100755', T, 3, 'link') + rec('160000', O, 2, 'sub') + rec('160000', T, 3, 'sub');
  assert.deepEqual(parseUnmerged(out), [
    { path: 'link', kind: 'bothModified', base: side('120000', B), ours: side('120000', O), theirs: side('100755', T) },
    { path: 'sub', kind: 'bothAdded', base: null, ours: side('160000', O), theirs: side('160000', T) },
  ]);
});

test('paths are NUL-delimited: a newline, a tab, a leading dash and spaces stay in the path', () => {
  const paths = ['a\nb.txt', '-rf', 'with space\tand tab'];
  const out = paths.map((p) => rec('100644', O, 2, p) + rec('100644', T, 3, p)).join('');
  assert.deepEqual(parseUnmerged(out).map((c) => c.path), paths);
});

test('empty output → no conflicts; a 64-hex (sha256) oid parses', () => {
  assert.deepEqual(parseUnmerged(''), []);
  const long = 'e'.repeat(64);
  assert.deepEqual(parseUnmerged(rec('100644', long, 3, 'x')), [{ path: 'x', kind: 'addedByThem', base: null, ours: null, theirs: side('100644', long) }]);
});
