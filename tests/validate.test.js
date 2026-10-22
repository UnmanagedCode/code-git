import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertOid, assertPath, assertRefName, assertRev, assertSubpath, assertTarget } from '../src/git/validate.js';

const refused = (fn, code) => assert.throws(fn, (e) => e.code === code, `expected ${code}`);

test('assertTarget accepts {project} and {project, worktree} and normalises the main checkout to worktree null', () => {
  assert.deepEqual(assertTarget({ project: 'app' }), { project: 'app', worktree: null });
  assert.deepEqual(assertTarget({ project: 'app', worktree: null }), { project: 'app', worktree: null });
  assert.deepEqual(assertTarget({ project: 'app', worktree: 'feat' }), { project: 'app', worktree: 'feat' });
});

test('assertTarget refuses any key beyond project/worktree, so exec form B can never be requested', () => {
  for (const extra of [{ system: 'local' }, { cwd: '/' }, { remoteId: 'x' }, { argv: ['rm'] }]) {
    refused(() => assertTarget({ project: 'app', ...extra }), 'BAD_TARGET');
  }
});

test('assertTarget refuses malformed names', () => {
  for (const t of [null, 'app', [], {}, { project: '' }, { project: 'a/b' }, { project: 'a\0b' }, { project: 'x'.repeat(201) },
    { project: 7 }, { project: 'app', worktree: '' }, { project: 'app', worktree: 'a/b' }, { project: 'app', worktree: 3 }]) {
    refused(() => assertTarget(t), 'BAD_TARGET');
  }
  assert.doesNotThrow(() => assertTarget({ project: 'x'.repeat(200) }));
});

test('assertTarget refuses . and .. as project or worktree names (they would rewrite the cc URL), but allows dotted names', () => {
  for (const t of [{ project: '.' }, { project: '..' }, { project: 'app', worktree: '.' }, { project: 'app', worktree: '..' }]) {
    refused(() => assertTarget(t), 'BAD_TARGET');
  }
  assert.deepEqual(assertTarget({ project: '...', worktree: '.x' }), { project: '...', worktree: '.x' });
  assert.deepEqual(assertTarget({ project: 'a..b' }), { project: 'a..b', worktree: null });
});

test('assertRefName accepts ordinary branch and tag names', () => {
  for (const s of ['main', 'feature/x', 'v1.2.3', 'a-b_c', 'release/2024.01', 'x'.repeat(255)]) assert.equal(assertRefName(s), s);
});

test('assertRefName refuses what git check-ref-format refuses, and option-looking names', () => {
  const bad = ['', '-x', '--upload-pack=x', 'a..b', 'x@{1}', '@', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b',
    'a//b', '/a', 'a/', 'a.', '.a', 'a/.b', 'a.lock', 'a/b.lock/c', 'a\x01b', 'a\x7fb', 'a\0b', 'x'.repeat(256), 'é'.repeat(128), 7];
  for (const s of bad) refused(() => assertRefName(s), 'BAD_REF');
});

test('assertRev accepts revisions and refuses option-looking, whitespace and control input', () => {
  for (const s of ['HEAD', 'HEAD~2', 'main^{commit}', 'a'.repeat(40), 'origin/main', 'x@{1}', 'a..b']) assert.equal(assertRev(s), s);
  for (const s of ['', '-x', '--output=/tmp/x', 'a b', 'a\tb', 'a\nb', 'a\0b', 'a\x01', 'x'.repeat(1025), null]) refused(() => assertRev(s), 'BAD_REF');
  assert.doesNotThrow(() => assertRev('x'.repeat(1024)));
});

test('assertPath accepts repo-relative paths, a leading dash included', () => {
  for (const s of ['a.txt', 'dir/a b.txt', '-rf', ':(glob)*', 'a/./b', '.gitignore', 'a..b']) assert.equal(assertPath(s), s);
});

test('assertPath refuses absolute, traversing, NUL and backslash paths', () => {
  for (const s of ['', '/abs', 'a/../b', '..', '../x', 'a/..', 'a\0b', 'a\\b', '..\\x', 'x'.repeat(4097), 1]) refused(() => assertPath(s), 'BAD_PATH');
});

test('assertSubpath additionally refuses a leading dash (it follows -C)', () => {
  assert.equal(assertSubpath('libs/sub'), 'libs/sub');
  refused(() => assertSubpath('-rf'), 'BAD_PATH');
  refused(() => assertSubpath('../x'), 'BAD_PATH');
});

test('assertOid: 40 or 64 lowercase hex only', () => {
  for (const ok of ['a'.repeat(40), '0123456789abcdef'.repeat(4)]) assert.equal(assertOid(ok), ok);
  for (const bad of ['a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(40), 'g'.repeat(40), `-${'a'.repeat(39)}`, `${'a'.repeat(40)}\n`, 'HEAD', '', null, 40]) {
    assert.throws(() => assertOid(bad), (e) => e.code === 'BAD_REF', String(bad));
  }
});
