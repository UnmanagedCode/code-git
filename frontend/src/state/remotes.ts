import { useEffect } from 'react';
import { listRemotes, type RemoteInfo } from '@/features/remotes/api';
import { createStore, useStore } from './store';
import { useGraphData } from './graph';
import { refsKey, type Tab } from './tabs';

// Per refsKey (a project's worktrees share remotes; a submodule has its own): the `remote.list` answer, which remote op is running, and the last
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
/** Per refsKey, the graph refs object the last list was fetched for: many tabs share one fetch. */
const seen = new Map<string, object>();
let epoch = 0;

export function resetRemotes(): void {
  epoch++;
  inFlight.clear();
  seen.clear();
  remotesStore.set(new Map());
}

const put = (key: string, f: (s: RemotesState) => RemotesState) => remotesStore.set((m) => new Map(m).set(key, f(m.get(key) ?? EMPTY)));

/** `key`: refsKey(tab). */
export const getRemotes = (key: string): RemotesState => remotesStore.get().get(key) ?? EMPTY;
/** The remote named `name` in the repo's last list (`key`: refsKey(tab)). */
export const remoteInfo = (key: string, name: string): RemoteInfo | undefined => getRemotes(key).data?.find((r) => r.name === name);

export const setRemoteBusy = (key: string, kind: RemoteBusy, on: boolean): void => put(key, (s) => ({ ...s, busy: { ...s.busy, [kind]: on } }));
export const setAutoFetchError = (key: string, error: string | null): void => put(key, (s) => ({ ...s, autoFetchError: error }));

/** Lists the repo's remotes; a call while one runs schedules one rerun. A failure keeps the last list. */
export async function refreshRemotes(tab: Tab): Promise<void> {
  const key = refsKey(tab);
  const running = inFlight.get(key);
  if (running) { running.again = true; return; }
  const at = epoch;
  const run = { again: false };
  inFlight.set(key, run);
  try {
    do {
      run.again = false;
      try {
        const data = await listRemotes(tab);
        if (at !== epoch) return;
        put(key, (s) => ({ ...s, data }));
      } catch {
        // The list is an aid (what is offered); the backend checks every remote op again.
      }
    } while (run.again && at === epoch);
  } finally {
    if (at === epoch) inFlight.delete(key);
  }
}

/** The repo's remotes, listed again whenever this tab's graph refs change. */
export function useRemotes(tab: Tab): RemotesState {
  const refs = useGraphData(tab).refs;
  useEffect(() => {
    if (!refs || seen.get(refsKey(tab)) === refs) return;
    seen.set(refsKey(tab), refs);
    void refreshRemotes(tab);
  }, [refs, tab]);
  return useStore(remotesStore).get(refsKey(tab)) ?? EMPTY;
}
