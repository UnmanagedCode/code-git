import { useEffect } from 'react';
import { pruneClosedTabs } from '@/state/shownPanel';
import { createStore, useStore } from '@/state/store';
import { tabKey, tabsStore, type Tab } from '@/state/tabs';
import { onSettledWrite, writeRunning } from '@/state/settledWrites';
import { listSubmodules, type SubmoduleList } from './api';

// Each tab's submodule list, keyed by tabKey. One request in flight per tab, plus one rerun when asked again meanwhile.

export interface SubmodulesState { status: 'idle' | 'loading' | 'ready' | 'error'; list: SubmoduleList | null; error: string | null }
const IDLE: SubmodulesState = { status: 'idle', list: null, error: null };

export const submodulesStore = createStore<ReadonlyMap<string, SubmodulesState>>(new Map());
tabsStore.subscribe(() => pruneClosedTabs(submodulesStore));
const runs = new Map<string, { again: boolean }>();
let epoch = 0;

export function resetSubmodules(): void {
  epoch++;
  runs.clear();
  submodulesStore.set(new Map());
}

const put = (key: string, f: (s: SubmodulesState) => SubmodulesState) => submodulesStore.set((m) => new Map(m).set(key, f(m.get(key) ?? IDLE)));
export const getSubmodules = (tab: Tab): SubmodulesState => submodulesStore.get().get(tabKey(tab)) ?? IDLE;

/** Reads the tab's submodules; a call while one runs schedules one rerun. A failure keeps the last list beside its error. */
export async function loadSubmodules(tab: Tab): Promise<void> {
  const key = tabKey(tab);
  const running = runs.get(key);
  if (running) { running.again = true; return; }
  const at = epoch;
  const run = { again: false };
  runs.set(key, run);
  put(key, (s) => ({ ...s, status: s.list ? s.status : 'loading' }));
  try {
    do {
      run.again = false;
      try {
        const list = await listSubmodules(tab);
        if (at !== epoch) return;
        put(key, () => ({ status: 'ready', list, error: null }));
      } catch (e) {
        if (at !== epoch) return;
        put(key, (s) => ({ ...s, status: s.list ? 'ready' : 'error', error: e instanceof Error ? e.message : String(e) }));
      }
    } while (run.again && at === epoch);
  } finally {
    if (at === epoch) runs.delete(key);
  }
}

/**
 * The tab's submodules, read when shown and again when a write op run on the project ends (onSettledWrite, as the graph
 * watches it) or when the window regains focus outside one, for as long as a consumer is mounted.
 */
export function useSubmodules(tab: Tab): SubmodulesState {
  const key = tabKey(tab);
  useEffect(() => {
    void loadSubmodules(tab);
    const unsub = onSettledWrite(tab.project, () => true, () => void loadSubmodules(tab));
    // During a write run its end reads the list again: a focus read now would see the write half-done.
    const onFocus = () => { if (document.visibilityState !== 'hidden' && !writeRunning(tab.project)) void loadSubmodules(tab); };
    window.addEventListener('focus', onFocus);
    return () => {
      unsub();
      window.removeEventListener('focus', onFocus);
    };
  }, [key]);
  return useStore(submodulesStore).get(key) ?? IDLE;
}
