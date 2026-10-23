import { useEffect } from 'react';
import { listRemotes, type RemoteInfo } from '@/features/remotes/api';
import { createStore, useStore } from './store';
import { useGraphData } from './graph';
import type { Tab } from './tabs';

// Per project (worktrees share remotes): the `remote.list` answer, which remote op is running, and the last
// auto-fetch failure. Refetched whenever a tab's graph refs change and after every remote op.

export type RemoteBusy = 'fetch' | 'pull' | 'push';
export interface RemotesState {
  data: RemoteInfo[] | null;
  busy: Record<RemoteBusy, boolean>;
  /** The last auto-fetch's failure (what the toolbar's warning dot says); null after a success. */
  autoFetchError: string | null;
}
const EMPTY: RemotesState = { data: null, busy: { fetch: false, pull: false, push: false }, autoFetchError: null };

export const remotesStore = createStore<ReadonlyMap<string, RemotesState>>(new Map());
const inFlight = new Map<string, { again: boolean }>();
/** Per project, the graph refs object the last list was fetched for: many tabs share one fetch. */
const seen = new Map<string, object>();
let epoch = 0;

export function resetRemotes(): void {
  epoch++;
  inFlight.clear();
  seen.clear();
  remotesStore.set(new Map());
}

const put = (project: string, f: (s: RemotesState) => RemotesState) => remotesStore.set((m) => new Map(m).set(project, f(m.get(project) ?? EMPTY)));

export const getRemotes = (project: string): RemotesState => remotesStore.get().get(project) ?? EMPTY;
/** The remote named `name` in the project's last list. */
export const remoteInfo = (project: string, name: string): RemoteInfo | undefined => getRemotes(project).data?.find((r) => r.name === name);

export const setRemoteBusy = (project: string, kind: RemoteBusy, on: boolean): void => put(project, (s) => ({ ...s, busy: { ...s.busy, [kind]: on } }));
export const setAutoFetchError = (project: string, error: string | null): void => put(project, (s) => ({ ...s, autoFetchError: error }));

/** Lists the project's remotes; a call while one runs schedules one rerun. A failure keeps the last list. */
export async function refreshRemotes(tab: Tab): Promise<void> {
  const running = inFlight.get(tab.project);
  if (running) { running.again = true; return; }
  const at = epoch;
  const run = { again: false };
  inFlight.set(tab.project, run);
  try {
    do {
      run.again = false;
      try {
        const data = await listRemotes({ project: tab.project, worktree: tab.worktree });
        if (at !== epoch) return;
        put(tab.project, (s) => ({ ...s, data }));
      } catch {
        // The list is an aid (what is offered); the backend checks every remote op again.
      }
    } while (run.again && at === epoch);
  } finally {
    if (at === epoch) inFlight.delete(tab.project);
  }
}

/** The project's remotes, listed again whenever this tab's graph refs change. */
export function useRemotes(tab: Tab): RemotesState {
  const refs = useGraphData(tab).refs;
  useEffect(() => {
    if (!refs || seen.get(tab.project) === refs) return;
    seen.set(tab.project, refs);
    void refreshRemotes(tab);
  }, [refs, tab]);
  return useStore(remotesStore).get(tab.project) ?? EMPTY;
}
