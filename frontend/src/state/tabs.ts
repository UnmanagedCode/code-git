import type { Target } from '@/lib/endpoints';
import { getItem, setItem } from '@/lib/storage';
import { createStore, useStore } from './store';

/** An open tab: one checkout of a cc project (worktree null = the main checkout), or a submodule inside one (`sub`). */
export type Tab = Target;

export interface TabsState {
  open: Tab[];
  /** Index into `open`; -1 when no tab is open. */
  active: number;
}

export type TabsAction =
  | { type: 'open'; tab: Tab }
  | { type: 'close'; index: number }
  | { type: 'closeOthers'; index: number }
  | { type: 'activateIndex'; index: number }
  | { type: 'move'; from: number; to: number };

/** The most entries a tab's `sub` chain holds (the backend's SUBMODULE_LIMITS.maxDepth refuses more). */
export const MAX_SUB_DEPTH = 8;

/** Whether `v` is a `sub` chain a tab may hold: 1…MAX_SUB_DEPTH non-empty strings (the backend checks each path). */
export const isSubChain = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length >= 1 && v.length <= MAX_SUB_DEPTH && v.every((s) => typeof s === 'string' && s !== '');

/** The key a checkout's per-repo state is stored under; a submodule's appends each path of its chain. */
export const tabKey = (t: Tab): string => `${t.project}\0${t.worktree ?? ''}${(t.sub ?? []).map((s) => `\0${s}`).join('')}`;

/** The repo a submodule tab's repo is a submodule of: one chain entry fewer (the checkout's tab for a top-level one). */
export const parentTab = (t: Tab): Tab => {
  const sub = t.sub?.slice(0, -1) ?? [];
  return { project: t.project, worktree: t.worktree, ...(sub.length ? { sub } : {}) };
};

/** The key a repo's refs-derived state is shared under: the project (its worktrees share refs), a submodule's own tab. */
export const refsKey = (t: Tab): string => (t.sub ? tabKey(t) : t.project);

/**
 * The key of a repo's persisted graph preferences: the bare project name for a checkout (its worktrees share it), else
 * the project then `\0` + path per chain entry — NUL is in no validated name or path, so `['a/b']` and `['a', 'b']` differ.
 */
export const prefsKey = (t: Tab): string => (t.sub ? `${t.project}${t.sub.map((s) => `\0${s}`).join('')}` : t.project);
const same = (a: Tab, b: Tab) => tabKey(a) === tabKey(b);

export const EMPTY: TabsState = { open: [], active: -1 };

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open': {
      const tab: Tab = { project: a.tab.project, worktree: a.tab.worktree ?? null, ...(isSubChain(a.tab.sub) ? { sub: [...a.tab.sub] } : {}) };
      const at = s.open.findIndex((t) => same(t, tab));
      if (at !== -1) return at === s.active ? s : { ...s, active: at };
      return { open: [...s.open, tab], active: s.open.length };
    }
    case 'close': {
      if (a.index < 0 || a.index >= s.open.length) return s;
      const open = s.open.filter((_, i) => i !== a.index);
      // Closing the active tab activates its right neighbour, else its left one.
      const active = !open.length ? -1 : a.index < s.active ? s.active - 1 : a.index === s.active ? Math.min(a.index, open.length - 1) : s.active;
      return { open, active };
    }
    case 'closeOthers':
      if (a.index < 0 || a.index >= s.open.length) return s;
      return { open: [s.open[a.index]], active: 0 };
    case 'activateIndex':
      if (a.index < 0 || a.index >= s.open.length || a.index === s.active) return s;
      return { ...s, active: a.index };
    case 'move': {
      if (a.from === a.to || a.from < 0 || a.to < 0 || a.from >= s.open.length || a.to >= s.open.length) return s;
      const activeTab = s.open[s.active];
      const open = [...s.open];
      const [t] = open.splice(a.from, 1);
      open.splice(a.to, 0, t);
      return { open, active: activeTab ? open.findIndex((x) => same(x, activeTab)) : -1 };
    }
  }
}

const STORAGE_KEY = 'tabs';

/** The persisted tabs, or EMPTY when absent or malformed. */
export function loadTabs(): TabsState {
  try {
    const v = JSON.parse(getItem(STORAGE_KEY) ?? 'null') as TabsState | null;
    if (!v || !Array.isArray(v.open)) return EMPTY;
    const open = v.open.filter((t) => t && typeof t.project === 'string' && t.project && (t.worktree === null || typeof t.worktree === 'string')
      && (t.sub === undefined || isSubChain(t.sub)));
    if (!open.length) return EMPTY;
    const active = Number.isInteger(v.active) && v.active >= 0 && v.active < open.length ? v.active : 0;
    return { open, active };
  } catch {
    return EMPTY;
  }
}

export const tabsStore = createStore<TabsState>(EMPTY);
tabsStore.subscribe(() => setItem(STORAGE_KEY, JSON.stringify(tabsStore.get())));

export const dispatchTabs = (a: TabsAction): void => tabsStore.set((s) => tabsReducer(s, a));
export const useTabs = (): TabsState => useStore(tabsStore);
export const activeTab = (s: TabsState): Tab | null => s.open[s.active] ?? null;
