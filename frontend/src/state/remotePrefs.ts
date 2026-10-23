import { useMemo } from 'react';
import type { PullMode } from '@/features/remotes/api';
import { getItem, setItem } from '@/lib/storage';
import { createStore, useStore } from './store';

// Per-project remote preferences, persisted under `remotes:<project>`: a project's worktrees share its remotes.

export const PULL_MODES: PullMode[] = ['ff', 'ffOnly', 'rebase'];
/** Auto-fetch intervals offered, in minutes; 0 = off. */
export const AUTO_FETCH_MINUTES = [0, 1, 5, 15, 30, 60] as const;

export interface RemotePrefs {
  /** What the Pull button runs. */
  pullMode: PullMode;
  /** 0: auto-fetch is off. */
  autoFetchMinutes: number;
  /** Push the branch after every commit from the commit box. */
  pushAfterCommit: boolean;
}

export const DEFAULT_REMOTE_PREFS: RemotePrefs = { pullMode: 'ff', autoFetchMinutes: 0, pushAfterCommit: false };

/** A stored record made safe: each field kept only when it is one of its allowed values. */
export function validateRemotePrefs(raw: unknown): RemotePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_REMOTE_PREFS;
  const r = raw as Record<string, unknown>;
  return {
    pullMode: PULL_MODES.includes(r.pullMode as PullMode) ? (r.pullMode as PullMode) : DEFAULT_REMOTE_PREFS.pullMode,
    autoFetchMinutes: (AUTO_FETCH_MINUTES as readonly unknown[]).includes(r.autoFetchMinutes) ? (r.autoFetchMinutes as number) : DEFAULT_REMOTE_PREFS.autoFetchMinutes,
    pushAfterCommit: typeof r.pushAfterCommit === 'boolean' ? r.pushAfterCommit : DEFAULT_REMOTE_PREFS.pushAfterCommit,
  };
}

const key = (project: string) => `remotes:${project}`;

function loadRemotePrefs(project: string): RemotePrefs {
  try {
    return validateRemotePrefs(JSON.parse(getItem(key(project)) ?? 'null'));
  } catch {
    return DEFAULT_REMOTE_PREFS;
  }
}

export const remotePrefsStore = createStore<ReadonlyMap<string, RemotePrefs>>(new Map());
export const resetRemotePrefs = (): void => remotePrefsStore.set(new Map());

export function getRemotePrefs(project: string): RemotePrefs {
  return remotePrefsStore.get().get(project) ?? loadRemotePrefs(project);
}

export function updateRemotePrefs(project: string, change: Partial<RemotePrefs>): void {
  const next = validateRemotePrefs({ ...getRemotePrefs(project), ...change });
  remotePrefsStore.set((m) => new Map(m).set(project, next));
  setItem(key(project), JSON.stringify(next));
}

export function useRemotePrefs(project: string): RemotePrefs {
  const m = useStore(remotePrefsStore);
  const stored = useMemo(() => loadRemotePrefs(project), [project]);
  return m.get(project) ?? stored;
}
