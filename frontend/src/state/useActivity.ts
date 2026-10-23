import { useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { cancelActivity, listActivity, type ActivityEntry, type OpRun } from '@/lib/endpoints';
import { subscribeActivity } from '@/lib/sse';
import { createStore, useStore } from './store';

/** `runs`: the write op runs (state/settledWrites.ts reads them). */
export interface ActivityState { entries: ActivityEntry[]; runs: OpRun[]; error: string | null }

const INITIAL: ActivityState = { entries: [], runs: [], error: null };
export const activityStore = createStore<ActivityState>(INITIAL);
export const resetActivity = (): void => activityStore.set(INITIAL);

export async function refreshActivity(): Promise<void> {
  try {
    const { entries, runs } = await listActivity();
    activityStore.set({ entries, runs, error: null });
  } catch (e) {
    activityStore.set((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
  }
}

/** The activity log, refetched whenever the backend signals a change (an SSE event is a signal, never data). */
export function useActivity(): ActivityState {
  useEffect(() => {
    void refreshActivity();
    return subscribeActivity(() => void refreshActivity());
  }, []);
  return useStore(activityStore);
}

/** Cancels a running entry. Losing the race with its own finish (NOT_RUNNING) is not an error. */
export async function cancelEntry(id: number): Promise<void> {
  try {
    await cancelActivity(id);
    await refreshActivity();
  } catch (e) {
    await refreshActivity();
    if (!(e instanceof ApiError && e.code === 'NOT_RUNNING')) {
      activityStore.set((s) => ({ ...s, error: `Cancel failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }
}
