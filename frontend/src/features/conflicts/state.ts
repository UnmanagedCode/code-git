import type { ConflictRead } from '@/features/sequence/api';
import { pruneClosedTabs } from '@/state/shownPanel';
import { createStore, useStore } from '@/state/store';
import { tabKey, tabsStore, type Tab } from '@/state/tabs';
import type { Region } from './diff3';
import type { Output } from './output';

// The conflict tool's file per checkout (keyed by tabKey). Not persisted: a reload shows the graph; the conflicts stay
// in git (the Changes panel lists them and its banner counts them).

/** Why the three panes are not shown: the conflict.read case, or text the tool cannot merge line by line. */
export type NotText = 'binary' | 'large' | 'symlink' | 'submodule' | 'oneSided' | 'none' | 'notUtf8' | 'tooDifferent';

export interface ToolFile {
  path: string;
  read: ConflictRead;
  /** The sides as text (the text case), else null. */
  sides: { base: string; ours: string; theirs: string } | null;
  notText: NotText | null;
  regions: Region[] | null;
  out: Output;
  /** The worktree file's oid as last read or saved: conflict.save's `expect`. */
  expect: string | null;
  /**
   * The worktree text when the file was read (null once the tool saved it, or when there was none): no conflict marker in
   * it means someone edited it outside the tool.
   */
  worktreeText: string | null;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  /** The conflict the panes and the output last moved to. */
  current: number;
}
export type ToolState = { status: 'loading'; path: string } | { status: 'error'; path: string; message: string } | { status: 'ready'; file: ToolFile };

export const conflictToolStore = createStore<ReadonlyMap<string, ToolState>>(new Map());
tabsStore.subscribe(() => pruneClosedTabs(conflictToolStore));
export const resetConflictTool = (): void => conflictToolStore.set(new Map());

export const toolOf = (tab: Tab): ToolState | null => conflictToolStore.get().get(tabKey(tab)) ?? null;
export const useTool = (tab: Tab | null): ToolState | null => {
  const m = useStore(conflictToolStore);
  return tab ? m.get(tabKey(tab)) ?? null : null;
};
export const setTool = (tab: Tab, s: ToolState): void => conflictToolStore.set((m) => new Map(m).set(tabKey(tab), s));
export function updateFile(tab: Tab, f: (x: ToolFile) => ToolFile): void {
  const cur = toolOf(tab);
  if (cur?.status === 'ready') setTool(tab, { status: 'ready', file: f(cur.file) });
}
export function clearTool(tab: Tab): void {
  conflictToolStore.set((m) => {
    if (!m.has(tabKey(tab))) return m;
    const next = new Map(m);
    next.delete(tabKey(tab));
    return next;
  });
}
