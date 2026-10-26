import { afterEach, expect, test } from 'vitest';
import type { CommitsCtx } from '@/features/graph/contexts';
import type { CommitItem, GraphRow } from '@/features/graph/types';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { integrationsStore, resetIntegrations } from '@/state/integrations';
import { tabKey, type Tab } from '@/state/tabs';
import { frameInCc, unframe } from '@/test/fakeHost';
import { checkout, commit, oid, refsResult, stash } from '@/test/graphData';
import { rangeToHead, reviewHref, reviewSubpath } from './codeReview';

const MAIN: Tab = { project: 'app', worktree: null };
const WT: Tab = { project: 'app', worktree: 'feat' };
const A = 'a'.repeat(40);

afterEach(() => { unframe(); resetIntegrations(); });

test('reviewSubpath is code-review\'s contract, byte for byte', () => {
  expect(reviewSubpath(MAIN, { sha: A })).toBe(`?project=app&view=new&sha=${A}`);
  expect(reviewSubpath(WT, { sha: A })).toBe(`?project=app&worktree=feat&view=new&sha=${A}`);
  expect(reviewSubpath(WT, { range: [oid(1), oid(4)] })).toBe(`?project=app&worktree=feat&view=new&range=${oid(1)}...${oid(4)}`);
});

test('reviewSubpath: hostile project and worktree names stay inside their own keys', () => {
  for (const v of ['a&view=old', 'a#b', 'a=b', 'a/b', 'a b', '..', 'x&sha=evil']) {
    const q = new URLSearchParams(reviewSubpath({ project: v, worktree: v }, { sha: A }).slice(1));
    expect([...q.keys()], v).toEqual(['project', 'worktree', 'view', 'sha']);
    expect(q.get('project'), v).toBe(v);
    expect(q.get('worktree'), v).toBe(v);
    expect(q.get('sha'), v).toBe(A);
  }
});

test('reviewHref keeps cc\'s path and query and replaces only the hash', () => {
  frameInCc({ pathname: '/app/', search: '?s=1' });
  integrationsStore.set({ codeReview: 'code-review' });
  expect(reviewHref(WT, { sha: A })).toBe(`/app/?s=1#plugin/code-review/?project=app&worktree=feat&view=new&sha=${A}`);
});

test('reviewHref is null standalone, without the bridge, with an unreadable top, on a submodule tab, or without code-review', () => {
  integrationsStore.set({ codeReview: 'code-review' });
  expect(reviewHref(MAIN, { sha: A }), 'standalone').toBeNull();
  frameInCc();
  delete (window as unknown as { ccBridge?: object }).ccBridge;
  expect(reviewHref(MAIN, { sha: A }), 'no bridge').toBeNull();
  unframe();
  frameInCc({ unreadable: true });
  expect(reviewHref(MAIN, { sha: A }), 'unreadable top').toBeNull();
  unframe();
  frameInCc();
  expect(reviewHref(MAIN, { sha: A }), 'framed control').not.toBeNull();
  expect(reviewHref({ ...MAIN, sub: ['lib'] }, { sha: A }), 'submodule tab').toBeNull();
  resetIntegrations();
  expect(reviewHref(MAIN, { sha: A }), 'no code-review').toBeNull();
});

// History: 1 ← 2 ← 3 ← 4 (HEAD); 1 ← 5; a merge 6 of 4 and 5; root 1.
const C = (n: number, parents: number[]) => commit(oid(n), parents.map(oid));
const COMMITS: Record<number, CommitItem> = { 1: C(1, []), 2: C(2, [1]), 3: C(3, [2]), 4: C(4, [3]), 5: C(5, [1]), 6: C(6, [4, 5]) };
const setHead = (n: number) => graphStore.set(new Map([[tabKey(MAIN), {
  ...EMPTY_GRAPH, status: 'ready', refs: refsResult({ head: { oid: oid(n), branch: 'refs/heads/main', detached: false, unborn: false } }),
}]]));
const row = (n: number): GraphRow => ({ kind: 'commit', id: oid(n), item: COMMITS[n] });
const sel = (...rows: GraphRow[]): CommitsCtx => ({ tab: MAIN, rows });

test('rangeToHead: a first-parent chain whose newest commit is HEAD reviews from its oldest commit\'s parent to HEAD\'s oid', () => {
  setHead(4);
  expect(rangeToHead(sel(row(4), row(3), row(2)))).toEqual([oid(1), oid(4)]);
  expect(rangeToHead(sel(row(4), row(3)))).toEqual([oid(2), oid(4)]);
});

test('rangeToHead: no range unless the selection is exactly a chain ending at HEAD', () => {
  setHead(4);
  expect(rangeToHead(sel(row(3), row(2))), 'not at HEAD').toBeNull();
  expect(rangeToHead(sel(row(4), row(2))), 'a gap').toBeNull();
  expect(rangeToHead(sel(row(3), row(2), row(1))), 'a root').toBeNull();
  setHead(6);
  expect(rangeToHead(sel(row(6), row(4))), 'a merge').toBeNull();
  setHead(4);
  expect(rangeToHead(sel({ kind: 'wip', id: 'wip:app', checkout: checkout(null) }, row(4), row(3))), 'a WIP row').toBeNull();
  expect(rangeToHead(sel(row(4), { kind: 'stash', id: 'stash:x', stash: stash(oid(9), oid(4)) })), 'a stash row').toBeNull();
});
