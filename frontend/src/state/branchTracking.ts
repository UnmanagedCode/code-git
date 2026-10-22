import { useEffect } from 'react';
import { loadTracking, type Tracking, type TrackingResult } from '@/features/branches/api';
import { createStore, useStore } from './store';
import { useGraphData } from './graph';
import type { Tab } from './tabs';

// Ahead/behind of each local branch against its upstream, per project (worktrees share refs). Refetched whenever a
// tab's graph refs change; one request in flight per project, plus one rerun when refs changed meanwhile.

export interface TrackingState { data: TrackingResult | null; loading: boolean }
const EMPTY: TrackingState = { data: null, loading: false };

export const trackingStore = createStore<ReadonlyMap<string, TrackingState>>(new Map());
const runs = new Map<string, { again: boolean }>();
/** Per project, the graph refs object the last fetch was started for: many badges share one fetch. */
const seen = new Map<string, object>();
let epoch = 0;

export function resetTracking(): void {
  epoch++;
  runs.clear();
  seen.clear();
  trackingStore.set(new Map());
}

const put = (project: string, f: (s: TrackingState) => TrackingState) =>
  trackingStore.set((m) => new Map(m).set(project, f(m.get(project) ?? EMPTY)));

export const getTracking = (tab: Tab): TrackingState => trackingStore.get().get(tab.project) ?? EMPTY;
/** One local branch's tracking (full refname), or null when unknown. */
export const trackingOf = (tab: Tab, ref: string): Tracking | null => getTracking(tab).data?.branches[ref] ?? null;

/** Fetches the project's tracking; a call while one runs schedules one rerun. A failure keeps the last data. */
export async function refreshTracking(tab: Tab): Promise<void> {
  const running = runs.get(tab.project);
  if (running) { running.again = true; return; }
  const at = epoch;
  const run = { again: false };
  runs.set(tab.project, run);
  put(tab.project, (s) => ({ ...s, loading: true }));
  try {
    do {
      run.again = false;
      try {
        const data = await loadTracking({ project: tab.project, worktree: tab.worktree });
        if (at !== epoch) return;
        put(tab.project, (s) => ({ ...s, data }));
      } catch {
        // The badges are an aid: without data they show nothing; the next refs change retries.
      }
    } while (run.again && at === epoch);
  } finally {
    if (at === epoch) {
      runs.delete(tab.project);
      put(tab.project, (s) => ({ ...s, loading: false }));
    }
  }
}

/** The project's tracking, fetched again whenever this tab's graph refs change. */
export function useTracking(tab: Tab): TrackingState {
  const refs = useGraphData(tab).refs;
  useEffect(() => {
    if (!refs || seen.get(tab.project) === refs) return;
    seen.set(tab.project, refs);
    void refreshTracking(tab);
  }, [refs, tab]);
  return useStore(trackingStore).get(tab.project) ?? EMPTY;
}
