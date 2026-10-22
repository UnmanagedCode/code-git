import { useEffect } from 'react';
import type { CommitItem, Checkout, PageResult, RefsResult, Stat } from '@/features/graph/types';
import { resolveVisibility } from '@/features/graph/visibility';
import { ApiError } from '@/lib/api';
import { listWorktrees, runOp, type Target } from '@/lib/endpoints';
import { mapLimit } from '@/lib/limit';
import { getPrefs, graphPrefsStore } from './graphPrefs';
import { createStore, useStore } from './store';
import { tabKey, type Tab } from './tabs';
import { activityStore } from './useActivity';
import { loadSummary, summaryStore } from './useRepoSummary';

// The commit graph's data per checkout (docs/graph.md → Snapshot and refresh). Pages are read from a frozen tip set
// (the snapshot); a refresh replaces it only when the tips moved, swapping the rows in one store update.

/** Rows per page; within PAGE_MAX of src/git/ops/graph.js. */
export const PAGE = 500;
/** Largest page a reload asks for at once: PAGE_MAX of src/git/ops/graph.js. */
export const RELOAD_CHUNK = 1000;
/** Oids per stats request; within STATS_MAX of src/git/ops/graph.js. */
export const STATS_CHUNK = 100;
/** Summaries of other checkouts fetched at once. */
export const SUMMARY_CONCURRENCY = 4;
/** Focus refreshes at most this often. */
export const FOCUS_THROTTLE_MS = 2000;

export interface ErrInfo { message: string; code: string | null }

export interface GraphData {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The last refresh's failure; rows already shown stay. */
  error: ErrInfo | null;
  refs: RefsResult | null;
  /** Changes whenever anything a label shows changes. */
  refsKey: string;
  tips: string[];
  tipsKey: string;
  /** Bumped on every snapshot swap; a page answer for an older generation is dropped. */
  generation: number;
  commits: CommitItem[];
  nextSkip: number | null;
  pageLoading: boolean;
  pageError: ErrInfo | null;
  /** The project's cc checkouts (main + worktrees) with their HEAD and change counts. */
  checkouts: Checkout[];
  stats: ReadonlyMap<string, Stat | null>;
}

export const EMPTY_GRAPH: GraphData = {
  status: 'idle', error: null, refs: null, refsKey: '', tips: [], tipsKey: '', generation: 0,
  commits: [], nextSkip: null, pageLoading: false, pageError: null, checkouts: [], stats: new Map(),
};

export const graphStore = createStore<ReadonlyMap<string, GraphData>>(new Map());

let epoch = 0;
const runs = new Map<string, { promise: Promise<void>; again: boolean }>();
const statsInFlight = new Set<string>();

export function resetGraph(): void {
  epoch++;
  runs.clear();
  statsInFlight.clear();
  graphStore.set(new Map());
}

export const getGraph = (tab: Tab): GraphData => graphStore.get().get(tabKey(tab)) ?? EMPTY_GRAPH;
const put = (tab: Tab, f: (g: GraphData) => GraphData, at = epoch) => {
  if (at !== epoch) return;
  const key = tabKey(tab);
  graphStore.set((m) => new Map(m).set(key, f(m.get(key) ?? EMPTY_GRAPH)));
};
const errInfo = (e: unknown): ErrInfo => ({ message: e instanceof Error ? e.message : String(e), code: e instanceof ApiError ? e.code ?? null : null });
const cancelled = (e: unknown, signal?: AbortSignal) => signal?.aborted || e instanceof ResetError || (e instanceof ApiError && e.code === 'CANCELLED');
/** The store was reset (tests) while a load ran: the load stops without another request. */
class ResetError extends Error {}

/** First show of a checkout's graph: loads it unless it already has data. */
export function openGraph(tab: Tab): Promise<void> {
  return getGraph(tab).status === 'idle' ? refreshGraph(tab, 'open') : Promise.resolve();
}

export type RefreshReason = 'open' | 'manual' | 'write' | 'focus' | 'prefs' | 'page-error';

/**
 * Re-reads refs and every checkout's summary; reloads the rows only if the tips moved. Concurrent calls coalesce into
 * the one running plus at most one rerun after it.
 */
export function refreshGraph(tab: Tab, reason: RefreshReason): Promise<void> {
  const key = tabKey(tab);
  const running = runs.get(key);
  if (running) {
    running.again = true;
    return running.promise;
  }
  const at = epoch;
  const run = { again: false, promise: Promise.resolve() };
  run.promise = (async () => {
    try {
      let why = reason;
      do {
        run.again = false;
        await refreshOnce(tab, why, at);
        why = 'manual';
      } while (run.again && at === epoch);
    } finally {
      if (runs.get(key) === run) runs.delete(key);
    }
  })();
  runs.set(key, run);
  return run.promise;
}

async function refreshOnce(tab: Tab, reason: RefreshReason, at: number): Promise<void> {
  const prev = getGraph(tab);
  if (!prev.refs) put(tab, (g) => ({ ...g, status: 'loading' }), at);
  let read: { refs: RefsResult; checkouts: Checkout[] };
  try {
    // A visibility change only re-resolves the tips of what is already loaded.
    read = reason === 'prefs' && prev.refs ? { refs: prev.refs, checkouts: prev.checkouts } : await readRefs(tab, reason, at);
  } catch (e) {
    // A cancel the user asked for is not an error: the graph stays as it was.
    if (cancelled(e)) return put(tab, (g) => ({ ...g, status: g.refs ? 'ready' : prev.status }), at);
    return put(tab, (g) => ({ ...g, status: g.refs ? 'ready' : 'error', error: errInfo(e) }), at);
  }
  const { refs, checkouts } = read;
  const { tips } = resolveVisibility(refs, getPrefs(tab.project));
  const tipsKey = tips.join(',');
  const refsKey = JSON.stringify(refs);
  const cur = getGraph(tab);
  if (cur.status === 'ready' && tipsKey === cur.tipsKey) {
    return put(tab, (g) => ({ ...g, refs, refsKey, checkouts, error: null }), at);
  }
  try {
    const target = Math.max(PAGE, cur.commits.length);
    const commits: CommitItem[] = [];
    let skip: number | null = 0;
    while (skip !== null && commits.length < target && tips.length) {
      if (at !== epoch) return;
      const page: PageResult = await runOp<PageResult>('graph.page', tab, { tips, skip, limit: Math.min(RELOAD_CHUNK, target - commits.length) });
      commits.push(...page.items);
      skip = page.nextCursor;
    }
    if (!tips.length) skip = null;
    put(tab, (g) => ({
      ...g, status: 'ready', error: null, pageError: null, refs, refsKey, tips, tipsKey, generation: g.generation + 1,
      commits, nextSkip: skip, pageLoading: false, checkouts,
    }), at);
  } catch (e) {
    if (cancelled(e)) return put(tab, (g) => ({ ...g, status: g.status === 'ready' ? 'ready' : prev.status }), at);
    put(tab, (g) => ({ ...g, status: g.status === 'ready' ? 'ready' : 'error', error: errInfo(e) }), at);
  }
}

/** graph.refs plus every cc checkout's summary (the header's own one is reused on first show). */
async function readRefs(tab: Tab, reason: RefreshReason, at: number): Promise<{ refs: RefsResult; checkouts: Checkout[] }> {
  const [refs, wts] = await Promise.all([
    runOp<RefsResult>('graph.refs', tab),
    // Without cc's worktree list the graph still shows the own checkout.
    listWorktrees(tab.project).catch(() => []),
  ]);
  const targets: Target[] = [{ project: tab.project, worktree: null }, ...wts.map((w) => ({ project: tab.project, worktree: w.worktreeName }))];
  if (at !== epoch) throw new ResetError();
  await mapLimit(targets.filter((t) => reason !== 'open' || tabKey(t) !== tabKey(tab)), SUMMARY_CONCURRENCY, (t) => (at === epoch ? loadSummary(t) : Promise.resolve()));
  return { refs, checkouts: targets.map((t) => toCheckout(t, tab)) };
}

function toCheckout(t: Target, own: Tab): Checkout {
  const s = summaryStore.get().get(tabKey(t))?.summary ?? null;
  return {
    target: t, name: t.worktree ?? t.project, isOwn: tabKey(t) === tabKey(own),
    branch: s?.head.branch ? `refs/heads/${s.head.branch}` : null,
    headOid: s?.head.oid ?? null, counts: s?.counts ?? null,
  };
}

/**
 * Loads the next page of the current snapshot. A failure (say a tip was garbage-collected) triggers one refresh; if
 * the tips did not move, the error stays for Retry.
 */
export async function loadNextPage(tab: Tab, signal?: AbortSignal): Promise<void> {
  const g = getGraph(tab);
  if (g.pageLoading || g.nextSkip === null || g.status !== 'ready') return;
  const { generation, tips, nextSkip, tipsKey } = g;
  const at = epoch;
  put(tab, (x) => ({ ...x, pageLoading: true, pageError: null }), at);
  try {
    const page = await runOp<PageResult>('graph.page', tab, { tips, skip: nextSkip, limit: PAGE }, { signal });
    put(tab, (x) => {
      if (x.generation !== generation) return { ...x, pageLoading: false };
      const have = new Set(x.commits.map((c) => c.oid));
      return { ...x, pageLoading: false, commits: [...x.commits, ...page.items.filter((c) => !have.has(c.oid))], nextSkip: page.nextCursor };
    }, at);
  } catch (e) {
    put(tab, (x) => ({ ...x, pageLoading: false }), at);
    if (cancelled(e, signal)) return;
    if (at !== epoch) return;
    await refreshGraph(tab, 'page-error');
    if (getGraph(tab).tipsKey === tipsKey) put(tab, (x) => ({ ...x, pageError: errInfo(e) }), at);
  }
}

export type SeekResult = 'found' | 'end' | 'limit' | 'cancelled';

/** Pages forward until `oid` is loaded: at most `maxPages` pages, stopping at the snapshot's end or on `signal`. */
export async function loadUntil(tab: Tab, oid: string, { maxPages = 20, signal }: { maxPages?: number; signal?: AbortSignal } = {}): Promise<SeekResult> {
  const at = epoch;
  for (let pages = 0; ; pages++) {
    if (signal?.aborted || at !== epoch) return 'cancelled';
    const g = getGraph(tab);
    if (g.commits.some((c) => c.oid === oid)) return 'found';
    if (g.nextSkip === null || g.status !== 'ready') return 'end';
    if (pages >= maxPages) return 'limit';
    const before = g.commits.length;
    await loadNextPage(tab, signal);
    if (signal?.aborted) return 'cancelled';
    // No progress: the page failed (its error is on the store) or another load is running.
    if (getGraph(tab).commits.length === before) return 'end';
  }
}

/** Fetches change stats for the given commits that lack them; one request in flight per checkout. */
export async function loadStats(tab: Tab, oids: string[]): Promise<void> {
  const key = tabKey(tab);
  if (statsInFlight.has(key)) return;
  const have = getGraph(tab).stats;
  const missing = [...new Set(oids)].filter((o) => !have.has(o)).slice(0, STATS_CHUNK);
  if (!missing.length) return;
  const at = epoch;
  statsInFlight.add(key);
  try {
    const { stats } = await runOp<{ stats: Record<string, Stat | null> }>('graph.stats', tab, { oids: missing });
    put(tab, (g) => {
      const next = new Map(g.stats);
      for (const o of missing) next.set(o, stats[o] ?? null);
      return { ...g, stats: next };
    }, at);
  } catch {
    // Stats are decoration: a failure leaves the column blank (the activity log has the error).
  } finally {
    if (at === epoch) statsInFlight.delete(key);
  }
}

/**
 * Refresh triggers besides the first show and the Refresh button: a finished write on the same project (the activity
 * store, refetched on every SSE event by the always-mounted activity panel) and the window regaining focus or
 * visibility (throttled), which catches agents committing in other checkouts. No timer.
 */
export function watchGraph(tab: Tab, now: () => number = Date.now): () => void {
  // Triggers act only on a graph that was opened (its checkout's summary loaded).
  const opened = () => getGraph(tab).status !== 'idle';
  const seen = () => Math.max(0, ...activityStore.get().entries.filter((e) => e.target.project === tab.project).map((e) => e.id));
  let lastId = seen();
  const unsubActivity = activityStore.subscribe(() => {
    const fresh = activityStore.get().entries.filter((e) => e.target.project === tab.project && e.id > lastId);
    const done = fresh.filter((e) => e.kind === 'write' && e.status !== 'running');
    if (!done.length) return;
    // Advance past finished entries only, so a write still running is seen when it ends.
    lastId = Math.max(...done.map((e) => e.id));
    if (opened()) void refreshGraph(tab, 'write');
  });
  let lastFocus = -Infinity;
  const onFocus = () => {
    if (document.visibilityState === 'hidden' || !opened()) return;
    const t = now();
    if (t - lastFocus < FOCUS_THROTTLE_MS) return;
    lastFocus = t;
    void refreshGraph(tab, 'focus');
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  // A visibility pref change can move the tips: re-resolve them.
  const visKey = () => {
    const p = getPrefs(tab.project);
    return JSON.stringify([p.hidden, p.hiddenRemotes, p.hiddenSections, p.soloed, p.soloedRemotes, p.soloedSections]);
  };
  let lastVis = visKey();
  const unsubPrefs = graphPrefsStore.subscribe(() => {
    const next = visKey();
    if (next === lastVis) return;
    lastVis = next;
    if (opened()) void refreshGraph(tab, 'prefs');
  });
  return () => {
    unsubActivity();
    unsubPrefs();
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  };
}

/** A checkout's graph data, read only (the graph panel opens and watches it). */
export const useGraphData = (tab: Tab): GraphData => useStore(graphStore).get(tabKey(tab)) ?? EMPTY_GRAPH;

/** A checkout's graph data; opens it once the own summary loaded (a failed summary — not a repo — loads nothing). */
export function useGraph(tab: Tab): GraphData {
  const key = tabKey(tab);
  const summaryOk = !!useStore(summaryStore).get(key)?.summary;
  useEffect(() => {
    if (summaryOk) void openGraph(tab);
  }, [key, summaryOk]); // keyed by tabKey: `tab` is a fresh object on every render
  useEffect(() => watchGraph(tab), [key]);
  return useStore(graphStore).get(key) ?? EMPTY_GRAPH;
}
