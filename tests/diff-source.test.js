import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';
import { assertCommitish, pairArgs, parseSource } from '../src/git/diff/source.js';
import { OID_RE } from '../src/git/validate.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const S256 = 'c'.repeat(64);
const code = (c) => (e) => e.code === c;

test('parseSource accepts every kind and fills its defaults', () => {
  assert.deepEqual(parseSource({ kind: 'commit', rev: 'HEAD~1' }), { kind: 'commit', rev: 'HEAD~1', parent: 1 });
  assert.deepEqual(parseSource({ kind: 'commit', rev: 'main', parent: 2 }), { kind: 'commit', rev: 'main', parent: 2 });
  assert.deepEqual(parseSource({ kind: 'unstaged' }), { kind: 'unstaged' });
  assert.deepEqual(parseSource({ kind: 'staged' }), { kind: 'staged' });
  assert.deepEqual(parseSource({ kind: 'compare', from: 'main', to: 'side', mode: '...' }), { kind: 'compare', from: 'main', to: 'side', mode: '...' });
  assert.deepEqual(parseSource({ kind: 'worktree', rev: 'v1.0' }), { kind: 'worktree', rev: 'v1.0' });
  assert.deepEqual(parseSource({ kind: 'commits', oids: [A, S256] }), { kind: 'commits', oids: [A, S256], wip: false });
  assert.deepEqual(parseSource({ kind: 'commits', oids: [A], wip: true }).wip, true);
  for (const [o, n] of [[{ type: 'tree', oid: A }, { type: 'tree', oid: B }], [{ type: 'tree', oid: A }, { type: 'index' }], [{ type: 'tree', oid: A }, { type: 'worktree' }], [{ type: 'index' }, { type: 'worktree' }]]) {
    assert.deepEqual(parseSource({ kind: 'pair', old: o, new: n }), { kind: 'pair', old: o, new: n });
  }
});

test('parseSource refuses unknown kinds and keys, and malformed fields, with BAD_PARAMS', () => {
  const refused = [
    null, [], 'commit', {}, { kind: 'nope' }, { kind: '__proto__' }, { kind: 'toString' },
    { kind: 'unstaged', extra: 1 }, { kind: 'commit', rev: 'HEAD', argv: ['x'] },
    { kind: 'commit', rev: 'HEAD', parent: 0 }, { kind: 'commit', rev: 'HEAD', parent: 1.5 }, { kind: 'commit', rev: 'HEAD', parent: '2' },
    { kind: 'compare', from: 'a', to: 'b' }, { kind: 'compare', from: 'a', to: 'b', mode: '....' },
    { kind: 'commits', oids: [] }, { kind: 'commits', oids: 'x' }, { kind: 'commits', oids: [A.slice(1)] }, { kind: 'commits', oids: ['g'.repeat(40)] },
    { kind: 'commits', oids: [A.toUpperCase()] }, { kind: 'commits', oids: ['main'] }, { kind: 'commits', oids: [A, A] },
    { kind: 'commits', oids: Array.from({ length: DIFF_LIMITS.maxCommits + 1 }, (_, i) => i.toString(16).padStart(40, '0')) },
    { kind: 'commits', oids: [A], wip: 'yes' },
    { kind: 'pair', old: { type: 'index' }, new: { type: 'index' } }, { kind: 'pair', old: { type: 'worktree' }, new: { type: 'tree', oid: A } },
    { kind: 'pair', old: { type: 'tree', oid: 'HEAD' }, new: { type: 'index' } }, { kind: 'pair', old: { type: 'tree', oid: A, x: 1 }, new: { type: 'index' } },
    { kind: 'pair', old: { type: 'index' } }, { kind: 'pair', old: { type: 'blob', oid: A }, new: { type: 'worktree' } },
  ];
  for (const raw of refused) assert.throws(() => parseSource(raw), code('BAD_PARAMS'), JSON.stringify(raw)?.slice(0, 80));
  assert.equal(parseSource({ kind: 'commits', oids: Array.from({ length: DIFF_LIMITS.maxCommits }, (_, i) => i.toString(16).padStart(40, '0')) }).oids.length, DIFF_LIMITS.maxCommits);
});

test('user-typed revisions refuse options, negations, ranges and whitespace with BAD_REF', () => {
  for (const rev of ['-x', '--output=/tmp/x', '^main', 'a..b', 'a...b', 'main..', 'a b', 'a\tb', '', 'x\n']) {
    for (const raw of [{ kind: 'commit', rev }, { kind: 'worktree', rev }, { kind: 'compare', from: rev, to: 'b', mode: '..' }, { kind: 'compare', from: 'a', to: rev, mode: '..' }]) {
      assert.throws(() => parseSource(raw), code('BAD_REF'), JSON.stringify(raw));
    }
  }
  for (const ok of ['HEAD', 'HEAD~2', 'main^2', 'v1.0', 'feature/x', A, 'HEAD@{1}']) assert.equal(assertCommitish(ok), ok);
});

test('OID_RE takes full sha1 and sha256 lowercase hex only', () => {
  assert.ok(OID_RE.test(A) && OID_RE.test(S256));
  for (const bad of [A.slice(1), `${A}0`, 'G'.repeat(40), 'c'.repeat(63)]) assert.equal(OID_RE.test(bad), false);
});

test('pairArgs: options before --end-of-options, every revision after it', () => {
  const t = (oid) => ({ type: 'tree', oid });
  assert.deepEqual(pairArgs({ old: t(A), new: t(B) }), { opts: [], revs: ['--end-of-options', A, B] });
  assert.deepEqual(pairArgs({ old: t(A), new: { type: 'index' } }), { opts: ['--cached'], revs: ['--end-of-options', A] });
  assert.deepEqual(pairArgs({ old: t(A), new: { type: 'worktree' } }), { opts: [], revs: ['--end-of-options', A] });
  assert.deepEqual(pairArgs({ old: { type: 'index' }, new: { type: 'worktree' } }), { opts: [], revs: [] });
  assert.throws(() => pairArgs({ old: { type: 'worktree' }, new: { type: 'index' } }), /unsupported/);
});
