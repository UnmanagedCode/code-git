import { pruneClosedTabs } from './shownPanel';
import { createStore, useStore } from './store';
import { tabKey, tabsStore, type Tab } from './tabs';

/** Per checkout: the lines selected in the viewed file, valid only for that fileKey and diff list generation. */
export interface LineSel { fileKey: string; generation: number; keys: ReadonlySet<string>; anchor: string | null }

export const lineSelectionStore = createStore<ReadonlyMap<string, LineSel>>(new Map());
tabsStore.subscribe(() => pruneClosedTabs(lineSelectionStore));
export const resetLineSelection = (): void => lineSelectionStore.set(new Map());

const NONE: ReadonlySet<string> = new Set();

/** The selection for `fileKey` at `generation`; another file or a reloaded list reads as empty. */
export function useLineSelection(tab: Tab, fileKey: string | null, generation: number): { keys: ReadonlySet<string>; anchor: string | null } {
  const s = useStore(lineSelectionStore).get(tabKey(tab));
  return s && s.fileKey === fileKey && s.generation === generation ? s : { keys: NONE, anchor: null };
}

export const setLineSelection = (tab: Tab, sel: LineSel): void => lineSelectionStore.set((m) => new Map(m).set(tabKey(tab), sel));
export function clearLineSelection(tab: Tab): void {
  lineSelectionStore.set((m) => {
    if (!m.has(tabKey(tab))) return m;
    const next = new Map(m);
    next.delete(tabKey(tab));
    return next;
  });
}
