import { useEffect } from 'react';
import type { ActivityEntry, Target } from '@/lib/endpoints';
import { subscribeActivity } from '@/lib/sse';
import { loadUndoState, type UndoState } from '@/features/undo/api';
import { createStore, useStore } from './store';
import { tabKey, type Tab } from './tabs';

// Per checkout (tabKey): the backend journal's two slots as `undo.state` last answered. Refetched when the tab is
// shown, when the window regains focus, and when the activity stream reports a finished write in this checkout —
// every write clears or fills the slots, so no op wrapper has to know about undo.

export interface UndoView { data: UndoState | null; error: string | null }
const EMPTY: UndoView = { data: null, error: null };

export const undoStore = createStore<ReadonlyMap<string, UndoView>>(new Map());
const runs = new Map<string, { again: boolean }>();
let epoch = 0;

export function resetUndo(): void {
  epoch++;
  runs.clear();
  undoStore.set(new Map());
}

export const undoOf = (tab: Tab): UndoView => undoStore.get().get(tabKey(tab)) ?? EMPTY;

/** Refetches `tab`'s slots; a call while one runs schedules one rerun. A failure keeps the last answer. */
export async function refreshUndo(tab: Tab): Promise<void> {
  const key = tabKey(tab);
  const run = runs.get(key);
  if (run) { run.again = true; return; }
  const mine = { again: false };
  runs.set(key, mine);
  const at = epoch;
  try {
    do {
      mine.again = false;
      try {
        const data = await loadUndoState(tab);
        if (at !== epoch) return;
        undoStore.set((m) => new Map(m).set(key, { data, error: null }));
      } catch (e) {
        if (at !== epoch) return;
        undoStore.set((m) => new Map(m).set(key, { data: m.get(key)?.data ?? null, error: e instanceof Error ? e.message : String(e) }));
      }
    } while (mine.again);
  } finally {
    if (runs.get(key) === mine) runs.delete(key);
  }
}

const sameTarget = (a: Target, b: Tab) =>
  a.project === b.project && (a.worktree ?? null) === (b.worktree ?? null) && (a.sub ?? []).join('\0') === (b.sub ?? []).join('\0');

/** Whether an activity event is a finished write in `tab`'s checkout. */
export const writeFinishedIn = (e: ActivityEntry | undefined, tab: Tab): boolean =>
  !!e && e.kind === 'write' && e.status !== 'running' && sameTarget(e.target, tab);

/** `tab`'s slots, kept fresh while mounted. */
export function useUndo(tab: Tab): UndoView {
  const key = tabKey(tab);
  useEffect(() => {
    void refreshUndo(tab);
    const onFocus = () => void refreshUndo(tab);
    window.addEventListener('focus', onFocus);
    const stop = subscribeActivity((e) => { if (e === undefined || writeFinishedIn(e, tab)) void refreshUndo(tab); });
    return () => { stop(); window.removeEventListener('focus', onFocus); };
  }, [key]); // keyed by tabKey: `tab` is a fresh object on every render
  return useStore(undoStore).get(key) ?? EMPTY;
}
