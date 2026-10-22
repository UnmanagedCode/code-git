import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { runOp } from '@/lib/endpoints';
import type { Tab } from '@/state/tabs';
import type { SearchResult } from './types';

export type SearchMode = 'commits' | 'path';
/** Typing pause before a search runs, ms. */
export const SEARCH_DEBOUNCE_MS = 300;

export interface GraphSearch {
  query: string;
  setQuery(q: string): void;
  mode: SearchMode;
  setMode(m: SearchMode): void;
  /** Matching commit oids (reachable from the snapshot, loaded or not); null when no search is active. */
  matches: ReadonlySet<string> | null;
  truncated: boolean;
  searching: boolean;
  error: string | null;
}

/**
 * The search box's state: git answers (graph.search over the snapshot's tips), debounced; a newer query aborts the
 * request of the previous one, which cancels its read.
 */
export function useGraphSearch(tab: Tab, tips: string[], tipsKey: string, initial?: { query: string; mode: SearchMode }): GraphSearch {
  const [query, setQuery] = useState(initial?.query ?? '');
  const [mode, setMode] = useState<SearchMode>(initial?.mode ?? 'commits');
  const [result, setResult] = useState<{ matches: ReadonlySet<string>; truncated: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tipsRef = useRef(tips);
  tipsRef.current = tips;
  useEffect(() => {
    const q = query.trim();
    setError(null);
    if (!q) {
      setResult(null);
      setSearching(false);
      return;
    }
    const ac = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      runOp<SearchResult>('graph.search', tab, { mode, query: q, tips: tipsRef.current }, { signal: ac.signal })
        .then((r) => { if (!ac.signal.aborted) setResult({ matches: new Set(r.matches), truncated: r.truncated }); })
        .catch((e) => {
          if (ac.signal.aborted || (e instanceof ApiError && e.code === 'CANCELLED')) return;
          setResult({ matches: new Set(), truncated: false });
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => { if (!ac.signal.aborted) setSearching(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, mode, tipsKey, tab.project, tab.worktree]);
  return { query, setQuery, mode, setMode, matches: result?.matches ?? null, truncated: result?.truncated ?? false, searching, error };
}
