import { useMemo } from 'react';
import { toggled } from './graphPrefs';
import { pruneClosedTabs } from './shownPanel';
import { createStore, useStore } from './store';
import { tabKey, tabsStore, type Tab } from './tabs';

/**
 * Per checkout, the Tree-view directories collapsed in its file lists (tree paths, no trailing `/`). One set shared by
 * every list of the tab, in memory only: keyed by path, it outlives a list's remount and a refresh of its files.
 */
export const collapsedDirsStore = createStore<ReadonlyMap<string, readonly string[]>>(new Map());
tabsStore.subscribe(() => pruneClosedTabs(collapsedDirsStore));
export const resetCollapsedDirs = (): void => collapsedDirsStore.set(new Map());

const NONE: readonly string[] = [];

export function useCollapsedDirs(tab: Tab): ReadonlySet<string> {
  const dirs = useStore(collapsedDirsStore).get(tabKey(tab)) ?? NONE;
  return useMemo(() => new Set(dirs), [dirs]);
}

export function setDirCollapsed(tab: Tab, dir: string, on: boolean): void {
  collapsedDirsStore.set((m) => {
    const cur = m.get(tabKey(tab)) ?? NONE;
    const next = toggled([...cur], dir, on);
    return next.length === cur.length ? m : new Map(m).set(tabKey(tab), next);
  });
}

/** Expands every collapsed ancestor directory of `filePath`; no change (and no notification) when none is. */
export function revealPath(tab: Tab, filePath: string): void {
  collapsedDirsStore.set((m) => {
    const cur = m.get(tabKey(tab));
    if (!cur) return m;
    const next = cur.filter((dir) => !filePath.startsWith(`${dir}/`));
    return next.length === cur.length ? m : new Map(m).set(tabKey(tab), next);
  });
}
