import { pruneClosedTabs } from '@/state/shownPanel';
import { createStore, useStore } from '@/state/store';
import { tabKey, tabsStore, type Tab } from '@/state/tabs';
import type { RebaseSession } from './model';

// The interactive-rebase editor's session per checkout (keyed by tabKey): loading, a load error, or the rows. Not
// persisted: a reload shows the graph; a rebase already started shows in the Changes banner (git's own state).

export type EditorState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; session: RebaseSession };

export const rebaseEditorStore = createStore<ReadonlyMap<string, EditorState>>(new Map());
tabsStore.subscribe(() => pruneClosedTabs(rebaseEditorStore));
export const resetRebaseEditor = (): void => rebaseEditorStore.set(new Map());

export const editorOf = (tab: Tab): EditorState | null => rebaseEditorStore.get().get(tabKey(tab)) ?? null;
export const useEditor = (tab: Tab | null): EditorState | null => {
  const m = useStore(rebaseEditorStore);
  return tab ? m.get(tabKey(tab)) ?? null : null;
};
export const setEditor = (tab: Tab, s: EditorState): void => rebaseEditorStore.set((m) => new Map(m).set(tabKey(tab), s));
export function updateSession(tab: Tab, f: (s: RebaseSession) => RebaseSession): void {
  const cur = editorOf(tab);
  if (cur?.status === 'ready') setEditor(tab, { status: 'ready', session: f(cur.session) });
}
export function clearEditor(tab: Tab): void {
  rebaseEditorStore.set((m) => {
    if (!m.has(tabKey(tab))) return m;
    const next = new Map(m);
    next.delete(tabKey(tab));
    return next;
  });
}
