import { expect, test } from 'vitest';
import { DEFAULT_PREFS } from '@/state/graphPrefs';
import { labelsByOid, worktreeName } from './labels';
import { checkout, oid, ref, refsResult, stash, worktree } from '@/test/graphData';
import { resolveVisibility } from './visibility';

const M = oid(1);
const F = oid(2);
const S = oid(3);
const D = oid(4);
const X = oid(5);

const base = refsResult({
  head: { oid: M, branch: 'refs/heads/main', detached: false, unborn: false },
  refs: [
    ref('refs/heads/main', M, { isHead: true }), ref('refs/remotes/origin/main', M), ref('refs/remotes/origin/feat', M),
    ref('refs/heads/feat', F), ref('refs/remotes/up/feat', M), ref('refs/tags/v1', M), ref('refs/heads/side', S),
  ],
  stashes: [stash(oid(9), M, 0)],
  worktrees: [
    worktree('/p/app', M, 'refs/heads/main'), worktree('/p/.wt/side-dir', S, 'refs/heads/side'),
    worktree('/p/.wt/det', D, null), worktree('/p/.wt/other', X, null),
  ],
});
const checkouts = [
  checkout(null, { branch: 'refs/heads/main', headOid: M }),
  checkout('side', { branch: 'refs/heads/side', headOid: S }),
  checkout('dt', { branch: null, headOid: D }),
];
const kinds = (m: Map<string, { kind: string; text: string }[]>, at: string) => (m.get(at) ?? []).map((l) => `${l.kind}:${l.text}`);

test('a local branch and the remote of the same name at the same commit share one chip; HEAD first, then remotes, tags, stashes', () => {
  const m = labelsByOid(base, resolveVisibility(base, DEFAULT_PREFS), checkouts);
  expect(kinds(m, M)).toEqual(['head:main', 'remote:origin/feat', 'remote:up/feat', 'tag:v1']);
  const head = m.get(M)![0] as { remotes: { name: string }[] };
  expect(head.remotes.map((r) => r.name)).toEqual(['refs/remotes/origin/main']);
  expect(kinds(m, oid(9))).toEqual(['stash:stash@{0}']);
});

test('other checkouts are labelled "in X": joined by branch, by commit when detached, else the directory name; not the own one', () => {
  const m = labelsByOid(base, resolveVisibility(base, DEFAULT_PREFS), checkouts);
  expect(kinds(m, S)).toEqual(['local:side', 'worktree:in side']);
  expect(kinds(m, D)).toEqual(['worktree:in dt']);
  expect(kinds(m, X)).toEqual(['worktree:in other']);
  expect(kinds(m, M).some((k) => k.startsWith('worktree'))).toBe(false);
  expect(worktreeName(worktree('/p/app', M, 'refs/heads/main'), checkouts).name).toBe('app');
});

test('hidden refs are unlabelled, and so is a worktree on a hidden branch; a detached HEAD gets a bare HEAD chip', () => {
  const prefs = { ...DEFAULT_PREFS, hidden: ['refs/heads/side', 'refs/remotes/up/feat'], hiddenSections: ['tags' as const, 'stashes' as const] };
  const m = labelsByOid(base, resolveVisibility(base, prefs), checkouts);
  expect(m.has(S)).toBe(false);
  expect(kinds(m, M)).toEqual(['head:main', 'remote:origin/feat']);
  expect(m.has(oid(9))).toBe(false);
  const detached = { ...base, head: { oid: F, branch: null, detached: true, unborn: false } };
  expect(kinds(labelsByOid(detached, resolveVisibility(detached, DEFAULT_PREFS), checkouts), F)).toEqual(['head:HEAD', 'local:feat']);
});

/** A ref whose `oid` reads are counted. */
function countedRef(name: string, at: string, counter: { n: number }) {
  const r = ref(name, at);
  const value = r.oid;
  Object.defineProperty(r, 'oid', { get() { counter.n++; return value; }, enumerable: true });
  return r;
}

test('joining local branches to their remote twins is linear: oid reads grow with the refs, not their product', () => {
  const n = 2000;
  const counter = { n: 0 };
  const big = refsResult({
    head: { oid: M, branch: 'refs/heads/b0', detached: false, unborn: false },
    refs: [
      ...Array.from({ length: n }, (_, i) => countedRef(`refs/heads/b${i}`, oid(1000 + i), counter)),
      ...Array.from({ length: n }, (_, i) => countedRef(`refs/remotes/origin/b${i}`, oid(1000 + i), counter)),
    ],
    worktrees: [],
  });
  const vis = resolveVisibility(big, DEFAULT_PREFS);
  counter.n = 0;
  const m = labelsByOid(big, vis, []);
  expect(m.get(oid(1000 + 7))!.map((l) => l.kind)).toEqual(['local']);
  expect((m.get(oid(1000 + 7))![0] as { remotes: unknown[] }).remotes).toHaveLength(1);
  // A pairwise join reads an oid per (local, remote) pair: n² = 4,000,000.
  expect(counter.n).toBeLessThan(10 * 2 * n);
});

test('many labels on one commit are appended, not copied per label', () => {
  const n = 5000;
  const many = refsResult({ refs: Array.from({ length: n }, (_, i) => ref(`refs/tags/t${String(i).padStart(4, '0')}`, M)), worktrees: [] });
  const vis = resolveVisibility(many, DEFAULT_PREFS);
  // Copying the list on every label spreads it once per label: count the array iterations started.
  const original = Array.prototype[Symbol.iterator];
  let iterations = 0;
  Array.prototype[Symbol.iterator] = function (this: unknown[]) { iterations++; return original.call(this); };
  let m: Map<string, unknown[]>;
  try {
    // The counter sees a spread (so a copy-per-label version would count n).
    const probe = [...[1, 2]];
    expect([probe.length, iterations]).toEqual([2, 1]);
    iterations = 0;
    m = labelsByOid(many, vis, []);
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  expect(m.get(M)).toHaveLength(n);
  expect(iterations).toBeLessThan(100);
});
