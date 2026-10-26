import { afterEach, expect, test } from 'vitest';
import { jumpStore } from '@/features/graph/jump';
import { fileHistoryStore } from '@/features/history/state';
import { EMPTY_GRAPH, graphStore, type GraphData } from '@/state/graph';
import { shownPanelStore, showPanel } from '@/state/shownPanel';
import { tabKey } from '@/state/tabs';
import { stubFetch } from '@/test/stubFetch';
import { cancelLink, followLink } from './inbound';

const T = { project: 'app', worktree: null };
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

afterEach(() => cancelLink());

const setStatus = (status: GraphData['status']) => graphStore.set(new Map([[tabKey(T), { ...EMPTY_GRAPH, status }]]));
const jumped = () => { const j = jumpStore.get(); return j && { key: j.key, oid: j.oid }; };

test('a commit link waits for the graph: no jump while idle or loading, the jump once it is ready', () => {
  setStatus('idle');
  followLink(T, { commit: A });
  expect(jumpStore.get()).toBeNull();
  setStatus('loading');
  expect(jumpStore.get()).toBeNull();
  setStatus('ready');
  expect(jumped()).toEqual({ key: tabKey(T), oid: A });
});

test('a commit link on a ready graph jumps at once', () => {
  setStatus('ready');
  followLink(T, { commit: A });
  expect(jumped()).toEqual({ key: tabKey(T), oid: A });
});

test('a graph that fails ends the wait: no jump then or after', () => {
  setStatus('loading');
  followLink(T, { commit: A });
  setStatus('error');
  expect(jumpStore.get()).toBeNull();
  setStatus('ready');
  expect(jumpStore.get()).toBeNull();
});

test('a commit link hides a panel shown in the graph\'s place', () => {
  showPanel(T, 'history');
  setStatus('idle');
  followLink(T, { commit: A });
  expect(shownPanelStore.get().has(tabKey(T))).toBe(false);
});

test('a path link opens the file\'s history from the commit, without waiting for the graph', () => {
  stubFetch({ 'POST api/ops/history.file': { ok: true, result: { items: [], nextCursor: null, truncated: false } } });
  setStatus('idle');
  followLink(T, { commit: A, path: 'src/a.ts' });
  expect(fileHistoryStore.get().get(tabKey(T))).toMatchObject({ path: 'src/a.ts', rev: A });
  expect(shownPanelStore.get().get(tabKey(T))).toBe('history');
  setStatus('ready');
  expect(jumpStore.get()).toBeNull();
});

test('a newer link replaces a pending one: only its commit is jumped to', () => {
  setStatus('idle');
  followLink(T, { commit: A });
  followLink(T, { commit: B });
  setStatus('ready');
  expect(jumped()).toEqual({ key: tabKey(T), oid: B });
});
