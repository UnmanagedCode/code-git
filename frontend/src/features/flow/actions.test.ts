import { expect, test } from 'vitest';
import type { RefCtx } from '@/features/graph/contexts';
import type { Ref } from '@/features/graph/types';
import { actionsFor, labelOf, type ResolvedAction } from '@/shell/menus';
import { flowDialogStore } from '@/state/flowDialog';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { tabKey } from '@/state/tabs';
import { oid, ref, refsResult } from '@/test/graphData';
import type { FlowConfigResult } from './api';
import { flowStore } from './state';

const T = { project: 'app', worktree: null };
const MAIN = ref('refs/heads/main', oid(1));
const FEATURE = ref('refs/heads/feature/login', oid(2));
const RELEASE = ref('refs/heads/release/1.0', oid(3));
const PLAIN = ref('refs/heads/topic', oid(4));
const REMOTE_FEATURE = ref('refs/remotes/origin/feature/login', oid(2));
const BARE_PREFIX = ref('refs/heads/feature/', oid(5));

const CONFIG: FlowConfigResult = {
  initialized: true, main: 'main', develop: 'develop',
  prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: 'v' },
  defaults: { main: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: '' } },
};
const UNSET: FlowConfigResult = { ...CONFIG, initialized: false, main: null, develop: null, prefixes: { feature: null, release: null, hotfix: null, versionTag: null } };

function world(head: Ref, config: FlowConfigResult | null) {
  graphStore.set(new Map([[tabKey(T), {
    ...EMPTY_GRAPH, status: 'ready',
    refs: refsResult({ head: { oid: head.oid, branch: head.name, detached: false, unborn: false }, refs: [MAIN, FEATURE, RELEASE, PLAIN, REMOTE_FEATURE] }),
  }]]));
  flowStore.set(config ? new Map([['app', config]]) : new Map());
}

function labels<C>(list: ResolvedAction<C>[], ctx: C): string[] {
  return list.flatMap((a) => (a.children ? labels(a.children, ctx).map((l) => `${labelOf(a, ctx)} › ${l}`) : [labelOf(a, ctx)]));
}
const menu = (context: string, ctx: unknown) => labels(actionsFor(context, ctx), ctx);
const branch = (r: Ref): RefCtx => ({ tab: T, ref: r });

test('a local branch under a configured prefix offers "Finish ‹type›…" between the rewrite items and Delete; no other branch does', () => {
  world(MAIN, CONFIG);
  expect(menu('branch', branch(FEATURE))).toContain('Finish feature…');
  expect(menu('branch', branch(RELEASE))).toContain('Finish release…');
  const items = menu('branch', branch(FEATURE));
  expect(items.indexOf('Finish feature…')).toBeLessThan(items.indexOf('Delete feature/login…'));
  expect(items.indexOf('Finish feature…')).toBeGreaterThan(items.findIndex((l) => l.startsWith('Reset main to here')));
  for (const r of [PLAIN, REMOTE_FEATURE, BARE_PREFIX, MAIN]) expect(menu('branch', branch(r)).some((l) => l.startsWith('Finish'))).toBe(false);
});

test('Finish is never offered when git-flow is not initialized or its settings are not loaded', () => {
  world(MAIN, UNSET);
  expect(menu('branch', branch(FEATURE)).some((l) => l.startsWith('Finish'))).toBe(false);
  world(MAIN, null);
  expect(menu('branch', branch(FEATURE)).some((l) => l.startsWith('Finish'))).toBe(false);
});

test('the branch Finish opens the finish dialog with the branch, its type and name, and its oid as expect', () => {
  world(MAIN, CONFIG);
  const a = actionsFor('branch', branch(RELEASE)).find((x) => labelOf(x, branch(RELEASE)) === 'Finish release…')!;
  void a.run!(branch(RELEASE));
  expect(flowDialogStore.get()).toEqual({ kind: 'finish', tab: T, type: 'release', name: '1.0', branch: 'release/1.0', expect: oid(3) });
});

test('repository menu: Initialize… only until initialized; then the settings and the Start items; Finish ‹HEAD›… when HEAD is a flow branch', () => {
  world(MAIN, UNSET);
  expect(menu('repo', { tab: T })).toEqual(['Git-flow › Initialize…', 'LFS…']);
  world(MAIN, CONFIG);
  expect(menu('repo', { tab: T })).toEqual([
    'Git-flow › Git-flow settings…', 'Git-flow › Start feature…', 'Git-flow › Start release…', 'Git-flow › Start hotfix…', 'LFS…',
  ]);
  world(FEATURE, CONFIG);
  expect(menu('repo', { tab: T })).toContain('Git-flow › Finish feature/login…');
});
