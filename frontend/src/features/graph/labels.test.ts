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
