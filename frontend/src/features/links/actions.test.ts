import { afterEach, expect, test } from 'vitest';
import type { CommitCtx, CommitsCtx } from '@/features/graph/contexts';
import type { GraphRow } from '@/features/graph/types';
import { ACTIONS, labelOf, resolveActions, type MenuAction } from '@/shell/menus';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { integrationsStore, resetIntegrations } from '@/state/integrations';
import { tabKey, type Tab } from '@/state/tabs';
import { frameInCc, unframe } from '@/test/fakeHost';
import { commit, oid, refsResult } from '@/test/graphData';

const T: Tab = { project: 'app', worktree: null };
const SUB: Tab = { ...T, sub: ['lib'] };
const C = (n: number, parents: number[]) => commit(oid(n), parents.map(oid));
const ITEMS = { 1: C(1, []), 2: C(2, [1]), 3: C(3, [2]) };
const row = (n: 1 | 2 | 3): GraphRow => ({ kind: 'commit', id: oid(n), item: ITEMS[n] });

afterEach(() => { unframe(); resetIntegrations(); });

function world() {
  const top = frameInCc({ pathname: '/', search: '' });
  integrationsStore.set({ codeReview: 'code-review' });
  graphStore.set(new Map([[tabKey(T), {
    ...EMPTY_GRAPH, status: 'ready', refs: refsResult({ head: { oid: oid(3), branch: 'refs/heads/main', detached: false, unborn: false } }),
  }]]));
  return top;
}
const all = ACTIONS as unknown as MenuAction<unknown>[];
const find = (context: string, ctx: unknown, label: string) => resolveActions(all, context, ctx).find((a) => labelOf(a, ctx) === label);
const one = (tab: Tab, n: 1 | 2 | 3): CommitCtx => ({ tab, commit: ITEMS[n], refs: [], selection: [oid(n)] });
const many = (tab: Tab, ...ns: (1 | 2 | 3)[]): CommitsCtx => ({ tab, rows: ns.map(row) });

test('a commit\'s menu offers "Review in code-review", which navigates cc to code-review\'s sha view', () => {
  const top = world();
  const a = find('commit', one(T, 2), 'Review in code-review');
  expect(a).toBeTruthy();
  void a!.run!(one(T, 2));
  expect(top.location.assign).toHaveBeenCalledExactlyOnceWith(`/#plugin/code-review/?project=app&view=new&sha=${oid(2)}`);
});

test('a selection\'s menu offers the range only for a chain ending at HEAD', () => {
  const top = world();
  const a = find('commits', many(T, 3, 2), 'Review range in code-review');
  expect(a).toBeTruthy();
  void a!.run!(many(T, 3, 2));
  expect(top.location.assign).toHaveBeenCalledExactlyOnceWith(`/#plugin/code-review/?project=app&view=new&range=${oid(1)}...${oid(3)}`);
  expect(find('commits', many(T, 2, 1), 'Review range in code-review'), 'not at HEAD, ends at a root').toBeUndefined();
});

test('neither item is offered without code-review or on a submodule tab', () => {
  world();
  expect(find('commit', one(SUB, 2), 'Review in code-review')).toBeUndefined();
  expect(find('commits', many(SUB, 3, 2), 'Review range in code-review')).toBeUndefined();
  resetIntegrations();
  expect(find('commit', one(T, 2), 'Review in code-review')).toBeUndefined();
  expect(find('commits', many(T, 3, 2), 'Review range in code-review')).toBeUndefined();
});

test('neither item is offered standalone', () => {
  world();
  unframe();
  expect(find('commit', one(T, 2), 'Review in code-review')).toBeUndefined();
  expect(find('commits', many(T, 3, 2), 'Review range in code-review')).toBeUndefined();
});
