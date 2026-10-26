import { act } from '@testing-library/react';
import { expect, test } from 'vitest';
import { entry, json, opRun, summary } from '@/test/fixtures';
import { commit, oid, ref } from '@/test/graphData';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import {
  getGraph, graphStore, loadNextPage, loadStats, loadUntil, openGraph, PAGE, refreshGraph, STATS_CHUNK, SUMMARY_CONCURRENCY, setGraphClock,
} from './graph';
import { updatePrefs } from './graphPrefs';
import { dispatchTabs } from './tabs';
import { activityStore } from './useActivity';
import { summaryStore } from './useRepoSummary';

const TAB = { project: 'app', worktree: null };
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

test('open: refs, then pages from the tips of refs + prefs at skip 0; other checkouts summarised, the own one reused', async () => {
  const world = linearWorld(1200);
  world.refs.refs.push(ref('refs/heads/old', oid(5)), ref('refs/tags/hidden', oid(7)));
  world.worktrees = [{ worktreeName: 'wt', branch: 'code-conductor/wt', baseBranch: 'main', locked: false }];
  world.summaries.wt = summary({ head: { oid: oid(3), branch: 'code-conductor/wt', unborn: false } });
  updatePrefs('app', (p) => ({ ...p, hiddenSections: ['tags'] }));
  const fetch = stubGraph(world);
  await openGraph(TAB);
  expect(paramsOf(fetch, 'POST api/ops/graph.page')).toEqual([{ tips: [oid(5), oid(1200)], skip: 0, limit: PAGE }]);
  expect(fetch.calls.filter((c) => c.url.pathname === '/api/ops/repo.summary').map((c) => c.body)).toEqual([{ target: { project: 'app', worktree: 'wt' } }]);
  const g = getGraph(TAB);
  expect(g.status).toBe('ready');
  expect(g.commits.length).toBe(PAGE);
  expect(g.nextSkip).toBe(PAGE);
  expect(g.checkouts.map((c) => [c.name, c.isOwn, c.branch, c.headOid])).toEqual([
    ['app', true, null, null], ['wt', false, 'refs/heads/code-conductor/wt', oid(3)],
  ]);
  await openGraph(TAB);
  expect(fetch.count('POST api/ops/graph.refs')).toBe(1);
});

test('refresh with unchanged tips updates refs and checkouts without reloading a page', async () => {
  const world = linearWorld(10);
  const fetch = stubGraph(world);
  await openGraph(TAB);
  world.refs.refs.push(ref('refs/tags/same', oid(10)));
  const gen = getGraph(TAB).generation;
  await refreshGraph(TAB, 'manual');
  expect(fetch.count('POST api/ops/graph.page')).toBe(1);
  expect(getGraph(TAB).refs!.refs.map((r) => r.short)).toEqual(['main', 'same']);
  expect(getGraph(TAB).generation).toBe(gen);
  expect(fetch.count('POST api/ops/repo.summary')).toBe(1);
});

test('refresh with moved tips reloads max(PAGE, loaded) rows and swaps them in one update, bumping the generation', async () => {
  const world = linearWorld(2000);
  const fetch = stubGraph(world);
  await openGraph(TAB);
  await loadNextPage(TAB);
  await loadNextPage(TAB);
  expect(getGraph(TAB).commits.length).toBe(1500);
  const before = getGraph(TAB);
  world.commits.unshift(commit(oid(2001), [oid(2000)]));
  world.refs.refs[0] = ref('refs/heads/main', oid(2001), { isHead: true });
  world.refs.head.oid = oid(2001);
  const lengths: number[] = [];
  const unsub = graphStore.subscribe(() => lengths.push(getGraph(TAB).commits.length));
  await refreshGraph(TAB, 'write');
  unsub();
  expect(paramsOf(fetch, 'POST api/ops/graph.page').slice(-2)).toEqual([
    { tips: [oid(2001)], skip: 0, limit: 1000 }, { tips: [oid(2001)], skip: 1000, limit: 500 },
  ]);
  expect(lengths.every((n) => n === 1500)).toBe(true);
  const after = getGraph(TAB);
  expect(after.commits[0].oid).toBe(oid(2001));
  expect(after.generation).toBe(before.generation + 1);
  expect(after.tipsKey).toBe(oid(2001));
});

test('concurrent refreshes coalesce into the running one plus one rerun', async () => {
  const world = linearWorld(5);
  const fetch = stubGraph(world);
  await openGraph(TAB);
  await Promise.all([refreshGraph(TAB, 'write'), refreshGraph(TAB, 'focus'), refreshGraph(TAB, 'write'), refreshGraph(TAB, 'manual')]);
  expect(fetch.count('POST api/ops/graph.refs')).toBe(3);
});

test('other checkouts are summarised at most SUMMARY_CONCURRENCY at a time, into the shared summary store', async () => {
  const world = linearWorld(3);
  world.worktrees = Array.from({ length: 9 }, (_, i) => ({ worktreeName: `w${i}`, branch: null, baseBranch: null, locked: false }));
  let inFlight = 0;
  let peak = 0;
  const fetch = stubGraph(world);
  const routes = fetch.fn.getMockImplementation()!;
  fetch.fn.mockImplementation(async (input, init) => {
    if (!String(input).endsWith('repo.summary')) return routes(input, init);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return json({ ok: true, result: summary() });
  });
  await openGraph(TAB);
  expect(peak).toBe(SUMMARY_CONCURRENCY);
  expect(summaryStore.get().get('app\0w8')?.summary).toEqual(summary());
});

test('a page answer for an older snapshot is dropped', async () => {
  const world = linearWorld(1000);
  let release: (() => void) | null = null;
  const fetch = stubGraph(world);
  await openGraph(TAB);
  world.page = (p) => (p.skip === PAGE
    ? new Promise((r) => { release = () => r({ ok: true, result: { items: [commit(oid(99999))], nextCursor: null } }); })
    : { ok: true, result: { items: world.commits.slice(p.skip, p.skip + p.limit), nextCursor: null } });
  const next = loadNextPage(TAB);
  await flush();
  world.refs.refs[0] = ref('refs/heads/main', oid(999), { isHead: true });
  world.refs.head.oid = oid(999);
  await refreshGraph(TAB, 'manual');
  release!();
  await next;
  expect(getGraph(TAB).commits.some((c) => c.oid === oid(99999))).toBe(false);
  expect(fetch.count('POST api/ops/graph.page')).toBe(3);
});

test('a failed page triggers one refresh; when the tips did not move its error stays for Retry', async () => {
  const world = linearWorld(800);
  const fetch = stubGraph(world);
  await openGraph(TAB);
  world.page = () => json({ error: 'bad object', code: 'GIT_FAILED' }, 422);
  await loadNextPage(TAB);
  expect(fetch.count('POST api/ops/graph.refs')).toBe(2);
  expect(getGraph(TAB).pageError).toEqual({ message: 'bad object', code: 'GIT_FAILED' });
  expect(getGraph(TAB).commits.length).toBe(PAGE);
  world.page = undefined;
  await loadNextPage(TAB);
  expect(getGraph(TAB).pageError).toBeNull();
  expect(getGraph(TAB).commits.length).toBe(800);
});

test('loadUntil pages until the commit is loaded, stops at maxPages, at the snapshot end, or when aborted', async () => {
  const world = linearWorld(3000);
  stubGraph(world);
  await openGraph(TAB);
  expect(await loadUntil(TAB, oid(2000))).toBe('found');
  expect(getGraph(TAB).commits.length).toBe(1500);
  expect(await loadUntil(TAB, oid(1), { maxPages: 1 })).toBe('limit');
  expect(getGraph(TAB).commits.length).toBe(2000);
  const ac = new AbortController();
  ac.abort();
  expect(await loadUntil(TAB, oid(1), { signal: ac.signal })).toBe('cancelled');
  expect(await loadUntil(TAB, oid(99999))).toBe('end');
  expect(getGraph(TAB).nextSkip).toBeNull();
});

test('loadStats asks only for commits without stats, at most STATS_CHUNK, one request in flight', async () => {
  const world = linearWorld(300);
  const fetch = stubGraph(world);
  await openGraph(TAB);
  const oids = world.commits.slice(0, 150).map((c) => c.oid);
  await Promise.all([loadStats(TAB, oids), loadStats(TAB, oids)]);
  expect(paramsOf(fetch, 'POST api/ops/graph.stats')).toEqual([{ oids: oids.slice(0, STATS_CHUNK) }]);
  expect(getGraph(TAB).stats.get(oids[0])).toEqual({ files: 1, insertions: 2, deletions: 3 });
  await loadStats(TAB, oids);
  expect(paramsOf(fetch, 'POST api/ops/graph.stats')[1]).toEqual({ oids: oids.slice(STATS_CHUNK) });
  await loadStats(TAB, oids);
  expect(fetch.count('POST api/ops/graph.stats')).toBe(2);
});

const runningRun = (id: number, over = {}) => opRun({ id, opRunId: `run-${id}`, status: 'running', endedAt: null, ...over });
const endedRun = (id: number, over = {}) => opRun({ id, opRunId: `run-${id}`, ...over });

// Invariant: a write op run of the project refreshes once when it ends — never between its commands (entries closing
// while the run runs), never for another project's run.
test('triggers: one refresh when a write run of the project ends, none while it runs or for another project', async () => {
  const world = linearWorld(5);
  world.worktrees = [{ worktreeName: 'wt', branch: 'code-conductor/wt', baseBranch: 'main', locked: false }];
  const fetch = stubGraph(world);
  activityStore.set({ entries: [], runs: [endedRun(1)], error: null });
  await openGraph(TAB);
  const reads = () => ['graph.refs', 'graph.page', 'repo.summary'].map((op) => fetch.count(`POST api/ops/${op}`));
  const opened = reads();
  activityStore.set({ entries: [entry({ id: 2, kind: 'write', opRunId: 'run-2', status: 'ok' })], runs: [endedRun(1), runningRun(2)], error: null });
  activityStore.set((s) => ({ ...s, entries: [...s.entries, entry({ id: 3, kind: 'write', opRunId: 'run-2', status: 'ok' })] }));
  activityStore.set((s) => ({ ...s, runs: [...s.runs, endedRun(3, { target: { project: 'other', worktree: null } })] }));
  await flush();
  expect(reads()).toEqual(opened);
  activityStore.set((s) => ({ ...s, runs: [endedRun(1), endedRun(2), endedRun(3, { target: { project: 'other', worktree: null } })] }));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(opened[0] + 1);
  // Every checkout's summary: its own and the worktree's.
  expect(fetch.count('POST api/ops/repo.summary')).toBe(opened[2] + 2);
  activityStore.set((s) => ({ ...s, runs: [...s.runs, endedRun(4, { target: { project: 'app', worktree: 'wt' } })] }));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(opened[0] + 2);
  activityStore.set((s) => ({ ...s }));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(opened[0] + 2);
});

// Invariant: a focus while a write run of the project is running reads nothing; the run's end refreshes once.
test('triggers: window focus during a write run reads nothing; the run end refreshes once', async () => {
  const fetch = stubGraph(linearWorld(5));
  dispatchTabs({ type: 'open', tab: TAB });
  setGraphClock(() => 1e9);
  activityStore.set({ entries: [], runs: [runningRun(1)], error: null });
  await openGraph(TAB);
  const before = fetch.count('POST api/ops/graph.refs');
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(before);
  activityStore.set((s) => ({ ...s, runs: [endedRun(1)] }));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(before + 1);
});

// Invariant: closing the tab stops its run watcher: a run ending afterwards reads nothing.
test('triggers: a closed tab does not refresh when a write run ends', async () => {
  const fetch = stubGraph(linearWorld(5));
  dispatchTabs({ type: 'open', tab: TAB });
  activityStore.set({ entries: [], runs: [runningRun(1)], error: null });
  await openGraph(TAB);
  const before = fetch.count('POST api/ops/graph.refs');
  dispatchTabs({ type: 'close', index: 0 });
  activityStore.set((s) => ({ ...s, runs: [endedRun(1)] }));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(before);
});

test('triggers: window focus refreshes the active tab at most once per throttle window; a visibility pref change reloads pages without re-reading refs', async () => {
  const world = linearWorld(5);
  world.refs.refs.push(ref('refs/heads/side', oid(2)));
  const fetch = stubGraph(world);
  dispatchTabs({ type: 'open', tab: TAB });
  let now = 10_000;
  setGraphClock(() => now);
  await openGraph(TAB);
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('focus'));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(2);
  now += 2500;
  window.dispatchEvent(new Event('focus'));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(3);
  updatePrefs('app', (p) => ({ ...p, hidden: ['refs/heads/side'] }));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(3);
  expect(paramsOf(fetch, 'POST api/ops/graph.page').at(-1)).toEqual({ tips: [oid(5)], skip: 0, limit: PAGE });
  updatePrefs('app', (p) => ({ ...p, pinned: ['refs/heads/main'] }));
  await flush();
  expect(fetch.count('POST api/ops/graph.page')).toBe(2);
  dispatchTabs({ type: 'close', index: 0 });
  now += 5000;
  window.dispatchEvent(new Event('focus'));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(3);
});

test('triggers: a background tab misses no focus refresh: it is marked and refreshed when shown again', async () => {
  const OTHER = { project: 'app', worktree: 'wt' };
  const world = linearWorld(3);
  const fetch = stubGraph(world);
  dispatchTabs({ type: 'open', tab: TAB });
  dispatchTabs({ type: 'open', tab: OTHER });
  setGraphClock(() => 1e9);
  await openGraph(TAB);
  const before = fetch.count('POST api/ops/graph.refs');
  window.dispatchEvent(new Event('focus'));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(before);
  await openGraph(TAB);
  expect(fetch.count('POST api/ops/graph.refs')).toBe(before + 1);
  await openGraph(TAB);
  expect(fetch.count('POST api/ops/graph.refs')).toBe(before + 1);
});

test('triggers keep running while the graph panel is unmounted (a diff replaces it): a hide still reloads the snapshot', async () => {
  const world = linearWorld(5);
  world.refs.refs.push(ref('refs/heads/side', oid(2)));
  const fetch = stubGraph(world);
  await openGraph(TAB);
  // No component is mounted here at all: only openGraph's watcher.
  updatePrefs('app', (p) => ({ ...p, soloed: ['refs/heads/side'] }));
  await flush();
  expect(getGraph(TAB).tips).toEqual([oid(2)]);
  expect(paramsOf(fetch, 'POST api/ops/graph.page').at(-1)).toMatchObject({ tips: [oid(2)] });
});

test('triggers ignore a graph that was never opened (its checkout is not a repo)', async () => {
  const fetch = stubGraph(linearWorld(3));
  dispatchTabs({ type: 'open', tab: TAB });
  window.dispatchEvent(new Event('focus'));
  activityStore.set({ entries: [], runs: [endedRun(5)], error: null });
  updatePrefs('app', (p) => ({ ...p, hidden: ['refs/heads/main'] }));
  await flush();
  expect(fetch.count('POST api/ops/graph.refs')).toBe(0);
});

test('a failed first load shows the error; a cancelled one is not an error', async () => {
  const world = linearWorld(3);
  const fetch = stubGraph(world);
  const routes = fetch.fn.getMockImplementation()!;
  let answer = json({ error: 'cancelled', code: 'CANCELLED' }, 409);
  fetch.fn.mockImplementation(async (input, init) => (String(input).endsWith('graph.refs') ? answer.clone() : routes(input, init)));
  await openGraph(TAB);
  expect(getGraph(TAB)).toMatchObject({ status: 'idle', error: null });
  answer = json({ error: 'the System of app is unreachable', code: 'SYSTEM_UNREACHABLE' }, 502);
  await refreshGraph(TAB, 'manual');
  expect(getGraph(TAB)).toMatchObject({ status: 'error', error: { code: 'SYSTEM_UNREACHABLE' } });
  answer = json({ error: 'cancelled', code: 'CANCELLED' }, 409);
  await refreshGraph(TAB, 'manual');
  expect(getGraph(TAB)).toMatchObject({ status: 'error', error: { code: 'SYSTEM_UNREACHABLE' } });
});

/** Holds graph.page answers for the given skips until released. */
function holdPages(world: ReturnType<typeof linearWorld>, skips: number[]) {
  const held: (() => void)[] = [];
  world.page = (p) => {
    const answer = { ok: true, result: { items: world.commits.slice(p.skip, p.skip + p.limit), nextCursor: p.skip + p.limit < world.commits.length ? p.skip + p.limit : null } };
    return skips.includes(p.skip) ? new Promise((r) => held.push(() => r(answer))) : answer;
  };
  return { release: () => { while (held.length) held.shift()!(); }, count: () => held.length };
}

test('a seek while the scroll prefetch is loading waits for that page instead of reporting the end', async () => {
  const world = linearWorld(1500);
  const fetch = stubGraph(world);
  await openGraph(TAB);
  const hold = holdPages(world, [PAGE]);
  const prefetch = loadNextPage(TAB);
  await flush();
  expect(hold.count()).toBe(1);
  const seek = loadUntil(TAB, oid(200));
  await flush();
  expect(paramsOf(fetch, 'POST api/ops/graph.page')).toHaveLength(2);
  hold.release();
  expect(await seek).toBe('found');
  await prefetch;
  expect(paramsOf(fetch, 'POST api/ops/graph.page').map((p) => (p as { skip: number }).skip)).toEqual([0, PAGE, 2 * PAGE]);
});

test('a seek during the first load waits for it', async () => {
  const world = linearWorld(800);
  stubGraph(world);
  const hold = holdPages(world, [0]);
  const opening = openGraph(TAB);
  await flush();
  const seek = loadUntil(TAB, oid(700));
  await flush();
  hold.release();
  expect(await seek).toBe('found');
  await opening;
});

test('a seek whose page fails ends with error, not end', async () => {
  const world = linearWorld(800);
  stubGraph(world);
  await openGraph(TAB);
  world.page = () => json({ error: 'bad object', code: 'GIT_FAILED' }, 422);
  expect(await loadUntil(TAB, oid(10))).toBe('error');
});

test('a prefetch page already loading does not use up the seek\'s maxPages', async () => {
  const world = linearWorld(2500);
  const fetch = stubGraph(world);
  await openGraph(TAB);
  const hold = holdPages(world, [PAGE]);
  void loadNextPage(TAB);
  await flush();
  // oid(1500) is commit index 1000: in the page after the prefetch's, exactly one page of the seek's own.
  const seek = loadUntil(TAB, oid(1500), { maxPages: 1 });
  await flush();
  hold.release();
  expect(await seek).toBe('found');
  expect(paramsOf(fetch, 'POST api/ops/graph.page').map((p) => (p as { skip: number }).skip)).toEqual([0, PAGE, 2 * PAGE]);
  // Without a prefetch the budget binds: oid(1) is two pages away.
  expect(await loadUntil(TAB, oid(1), { maxPages: 1 })).toBe('limit');
});

test("sub tab checkouts = [tab], no listWorktrees call; the project's hides do not apply, its own do", async () => {
  const SUB = { project: 'app', worktree: null, sub: ['libs/a'] };
  const world = linearWorld(5);
  world.refs.refs.push(ref('refs/heads/old', oid(2)));
  world.summaries[''] = summary();
  updatePrefs('app', (p) => ({ ...p, hidden: ['refs/heads/old'] }));
  const fetch = stubGraph(world);
  await openGraph(SUB);
  expect(fetch.count('GET api/repos/app/worktrees')).toBe(0);
  expect(fetch.calls.filter((c) => c.url.pathname.startsWith('/api/ops/')).every((c) => (c.body as { target: unknown }).target
    && JSON.stringify((c.body as { target: unknown }).target) === JSON.stringify({ project: 'app', sub: ['libs/a'] }))).toBe(true);
  const g = getGraph(SUB);
  expect(g.checkouts.map((c) => [c.name, c.isOwn, c.target])).toEqual([['libs/a', true, SUB]]);
  expect(paramsOf(fetch, 'POST api/ops/graph.page')[0]).toMatchObject({ tips: [oid(2), oid(5)] });
  updatePrefs('app\0libs/a', (p) => ({ ...p, hidden: ['refs/heads/old'] }));
  await refreshGraph(SUB, 'prefs');
  expect(paramsOf(fetch, 'POST api/ops/graph.page').at(-1)).toMatchObject({ tips: [oid(5)] });
});

// Invariant: `loadedAt` is the clock at the last successful refresh (open or unchanged-tips refresh) and loading a page leaves it.
test('loadedAt follows the clock of each successful refresh and not a page load', async () => {
  const world = linearWorld(PAGE + 10);
  stubGraph(world);
  dispatchTabs({ type: 'open', tab: TAB });
  let now = 5_000_000;
  setGraphClock(() => now);
  await openGraph(TAB);
  expect(getGraph(TAB).loadedAt).toBe(5_000_000);
  now = 6_000_000;
  await act(async () => { await loadNextPage(TAB); });
  expect(getGraph(TAB).commits.length).toBe(PAGE + 10);
  expect(getGraph(TAB).loadedAt).toBe(5_000_000);
  now = 7_000_000;
  await act(async () => { await refreshGraph(TAB, 'manual'); });
  expect(getGraph(TAB).loadedAt).toBe(7_000_000);
});
