import { useCallback, useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { runOp, type RepoSummary } from '@/lib/endpoints';
import { createStore, useStore } from './store';
import { tabKey, type Tab } from './tabs';

export interface SummaryState {
  summary: RepoSummary | null;
  loading: boolean;
  error: { message: string; code: string | null; detail: string | null } | null;
}

const EMPTY: SummaryState = { summary: null, loading: false, error: null };
/** Per checkout, keyed by tabKey. */
export const summaryStore = createStore<ReadonlyMap<string, SummaryState>>(new Map());
export const resetSummaries = (): void => summaryStore.set(new Map());

const put = (key: string, f: (s: SummaryState) => SummaryState) =>
  summaryStore.set((m) => new Map(m).set(key, f(m.get(key) ?? EMPTY)));

export async function loadSummary(tab: Tab): Promise<void> {
  const key = tabKey(tab);
  put(key, (s) => ({ ...s, loading: true }));
  try {
    const summary = await runOp<RepoSummary>('repo.summary', tab);
    put(key, () => ({ summary, loading: false, error: null }));
  } catch (e) {
    const body = e instanceof ApiError ? (e.body as { detail?: unknown } | undefined) : undefined;
    put(key, (s) => ({
      ...s, loading: false,
      error: {
        message: e instanceof Error ? e.message : String(e),
        code: e instanceof ApiError ? e.code ?? null : null,
        detail: typeof body?.detail === 'string' ? body.detail : null,
      },
    }));
  }
}

/** The active checkout's summary: loaded when the tab is first shown; `refresh` reloads it. */
export function useRepoSummary(tab: Tab | null): SummaryState & { refresh: () => void } {
  const map = useStore(summaryStore);
  const key = tab ? tabKey(tab) : null;
  useEffect(() => {
    if (tab && key && !summaryStore.get().has(key)) void loadSummary(tab);
  }, [key]); // keyed by tabKey: `tab` is a fresh object on every render
  const refresh = useCallback(() => { if (tab) void loadSummary(tab); }, [key]);
  return { ...(key ? map.get(key) ?? { ...EMPTY, loading: true } : EMPTY), refresh };
}
