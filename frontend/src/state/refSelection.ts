import type { Ref } from '@/features/graph/types';
import { createStore, useStore } from './store';
import { pruneClosedTabs } from './shownPanel';
import { tabKey, tabsStore, type Tab } from './tabs';

// The refs panel's multi-selection of branch rows, per checkout (by full refname). Plain clicks jump; Ctrl/⌘-click
// toggles a row and Shift-click selects the displayed range from the anchor.

export interface RefSelection { names: string[]; anchor: string | null }
export type RefSelectionAction =
  | { type: 'toggle'; name: string }
  /** `order`: the branch rows as displayed (after the filter), top to bottom. */
  | { type: 'range'; name: string; order: string[] }
  | { type: 'clear' };

export const NO_SELECTION: RefSelection = { names: [], anchor: null };

export function refSelectionReducer(s: RefSelection, a: RefSelectionAction): RefSelection {
  switch (a.type) {
    case 'toggle':
      return { names: s.names.includes(a.name) ? s.names.filter((n) => n !== a.name) : [...s.names, a.name], anchor: a.name };
    case 'range': {
      const from = s.anchor === null ? -1 : a.order.indexOf(s.anchor);
      const to = a.order.indexOf(a.name);
      if (to === -1) return s;
      // No anchor on display: the click starts a new selection there.
      if (from === -1) return { names: [a.name], anchor: a.name };
      return { names: a.order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor: s.anchor };
    }
    case 'clear':
      return s.names.length || s.anchor !== null ? NO_SELECTION : s;
  }
}

export const refSelectionStore = createStore<ReadonlyMap<string, RefSelection>>(new Map());
export const resetRefSelection = (): void => refSelectionStore.set(new Map());
tabsStore.subscribe(() => pruneClosedTabs(refSelectionStore));

export const getRefSelection = (tab: Tab): RefSelection => refSelectionStore.get().get(tabKey(tab)) ?? NO_SELECTION;
export function dispatchRefSelection(tab: Tab, a: RefSelectionAction): void {
  const prev = getRefSelection(tab);
  const next = refSelectionReducer(prev, a);
  if (next !== prev) refSelectionStore.set((m) => new Map(m).set(tabKey(tab), next));
}

/** The selected refs that still exist in `refs`, in `refs` order: a deleted or renamed branch drops out. */
export function selectedRefs(tab: Tab, refs: readonly Ref[]): Ref[] {
  const names = new Set(getRefSelection(tab).names);
  return refs.filter((r) => names.has(r.name));
}

export function useRefSelection(tab: Tab): RefSelection {
  return useStore(refSelectionStore).get(tabKey(tab)) ?? NO_SELECTION;
}
