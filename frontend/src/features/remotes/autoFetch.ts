import { useEffect } from 'react';
import { trackOp } from '@/lib/opToast';
import { refreshGraph } from '@/state/graph';
import { getRemotePrefs, remotePrefsStore } from '@/state/remotePrefs';
import { getRemotes, refreshRemotes, setAutoFetchError, setRemoteBusy } from '@/state/remotes';
import { useStore } from '@/state/store';
import { refsKey, useTabs, type Tab } from '@/state/tabs';
import { activityStore } from '@/state/useActivity';
import { fetchRemotes, isFetchError } from './api';

// Auto-fetch (off by default): one timer per project with an open tab, at the project's `autoFetchMinutes`. A tick
// fetches every remote (never pruning) quietly; the first failure of a streak toasts once and marks the toolbar's Fetch.

/** The timers auto-fetch uses; tests inject one (setRemoteClock) and tick it by hand. */
export interface RemoteClock {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}
const REAL_CLOCK: RemoteClock = {
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id as number),
};
let clock = REAL_CLOCK;
/** Replaces the timers (null: the real ones). Takes effect for timers started afterwards. */
export const setRemoteClock = (c: RemoteClock | null): void => { clock = c ?? REAL_CLOCK; };

/** Projects whose current failure streak already toasted. */
const toasted = new Set<string>();
export const resetAutoFetch = (): void => { toasted.clear(); clock = REAL_CLOCK; };

/** Why a tick does not run now: the page is hidden, a remote op of the checkout is running, or any write of the project is. */
function skipReason(tab: Tab): string | null {
  const { project } = tab;
  if (document.visibilityState !== 'visible') return 'hidden';
  const busy = getRemotes(refsKey(tab)).busy;
  if (busy.fetch || busy.pull || busy.push) return 'busy';
  const writing = activityStore.get().entries.some((e) => e.status === 'running' && e.kind === 'write' && e.target.project === project);
  return writing ? 'writing' : null;
}

/** One auto-fetch of `tab`'s project, unless skipReason says not now. */
export async function autoFetchTick(tab: Tab): Promise<void> {
  if (skipReason(tab)) return;
  setRemoteBusy(refsKey(tab), 'fetch', true);
  const r = await trackOp(() => fetchRemotes(tab, null), { running: 'Fetching all remotes…', done: () => null, toastRunning: false });
  setRemoteBusy(refsKey(tab), 'fetch', false);
  const failure = !r.ok ? r.error.message
    : r.result.remotes.filter(isFetchError).map((x) => `${x.remote}: ${x.error.message}`).join('\n') || null;
  setAutoFetchError(refsKey(tab), failure);
  if (!failure) toasted.delete(tab.project);
  else if (!toasted.has(tab.project)) {
    toasted.add(tab.project);
    void trackOp(async () => failure, { running: '', toastRunning: false, done: (f) => ({ tone: 'warning', title: 'Auto-fetch failed', description: f }) });
  }
  if (r.ok && r.result.remotes.some((x) => !isFetchError(x) && x.changes.length)) void refreshGraph(tab, 'write');
  void refreshRemotes(tab);
}

/** Runs the timers: one per project with an open tab whose auto-fetch is on, restarted when tabs or prefs change. */
export function useAutoFetch(): void {
  const { open } = useTabs();
  const prefs = useStore(remotePrefsStore);
  useEffect(() => {
    const byProject = new Map<string, Tab>();
    // A project's checkout, never a submodule: a submodule tab's project is fetched through its checkout.
    for (const t of open) if (!byProject.has(t.project)) byProject.set(t.project, { project: t.project, worktree: t.worktree });
    const timers: unknown[] = [];
    for (const [project, tab] of byProject) {
      const minutes = getRemotePrefs(project).autoFetchMinutes;
      if (minutes > 0) timers.push(clock.setInterval(() => void autoFetchTick(tab), minutes * 60_000));
    }
    return () => { for (const id of timers) clock.clearInterval(id); };
  }, [open, prefs]);
}
