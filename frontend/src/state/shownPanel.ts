import { createStore, useStore } from './store';
import { tabKey, tabsStore, type Tab } from './tabs';

/** Per checkout, the on-demand panel shown in its slot (PanelDef.onDemand), by panel id. */
export const shownPanelStore = createStore<ReadonlyMap<string, string>>(new Map());
export const resetShownPanels = (): void => shownPanelStore.set(new Map());

export const showPanel = (tab: Tab, id: string): void => shownPanelStore.set((m) => new Map(m).set(tabKey(tab), id));
export function hidePanel(tab: Tab): void {
  shownPanelStore.set((m) => {
    if (!m.has(tabKey(tab))) return m;
    const next = new Map(m);
    next.delete(tabKey(tab));
    return next;
  });
}

export function useShownPanel(tab: Tab | null): string | null {
  const m = useStore(shownPanelStore);
  return tab ? m.get(tabKey(tab)) ?? null : null;
}

/** Drops the keys of `store`'s map whose tab is no longer open. */
export function pruneClosedTabs<V>(store: { get(): ReadonlyMap<string, V>; set(v: ReadonlyMap<string, V>): void }): void {
  const open = new Set(tabsStore.get().open.map(tabKey));
  const m = store.get();
  if ([...m.keys()].every((k) => open.has(k))) return;
  store.set(new Map([...m].filter(([k]) => open.has(k))));
}

tabsStore.subscribe(() => pruneClosedTabs(shownPanelStore));
