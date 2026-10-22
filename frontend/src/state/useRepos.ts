import { useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { listRepos, type Repo } from '@/lib/endpoints';
import { createStore, useStore } from './store';

export interface ReposState { repos: Repo[] | null; error: string | null; loading: boolean }

const INITIAL: ReposState = { repos: null, error: null, loading: false };
export const reposStore = createStore<ReposState>(INITIAL);
export const resetRepos = (): void => reposStore.set(INITIAL);

export async function loadRepos(): Promise<void> {
  reposStore.set((s) => ({ ...s, loading: true }));
  try {
    reposStore.set({ repos: await listRepos(), error: null, loading: false });
  } catch (e) {
    reposStore.set((s) => ({ ...s, error: e instanceof ApiError || e instanceof Error ? e.message : String(e), loading: false }));
  }
}

/** cc's projects as picker rows; loaded on first use. */
export function useRepos(): ReposState & { reload: () => Promise<void> } {
  const state = useStore(reposStore);
  useEffect(() => {
    if (reposStore.get().repos === null && !reposStore.get().loading) void loadRepos();
  }, []);
  return { ...state, reload: loadRepos };
}

/** Why a repo cannot be opened, or null when it can. */
export function disabledReason(r: Repo): string | null {
  if (r.degraded) return r.degraded;
  if (r.systemUnreachable) return r.systemUnreachable;
  if (r.gitRefusal) return r.gitRefusal;
  if (r.isGitRepo === false) return 'not a git repo';
  return null;
}

/** A non-local System as a short label, e.g. "docker · cc-box"; null for local. */
export const systemLabel = (r: Pick<Repo, 'system' | 'remoteId'>): string | null =>
  r.system === 'local' ? null : r.remoteId ? `${r.system} · ${r.remoteId}` : r.system;
