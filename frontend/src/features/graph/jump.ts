import { closeDiff, DIFF_PANEL_ID } from '@/features/diff/openDiff';
import { shownPanelStore } from '@/state/shownPanel';
import { createStore } from '@/state/store';
import { tabKey, type Tab } from '@/state/tabs';
import type { RowId } from './types';

// Requests the graph panel acts on: jump to a row (paging until its commit is loaded) and show the details of the
// selection (a dialog on narrow screens). Menus, the refs panel and the details panel raise them.

export interface JumpRequest { seq: number; key: string; oid: string; rowId: RowId }
export const jumpStore = createStore<JumpRequest | null>(null);
export const detailsRequestStore = createStore<{ seq: number; key: string } | null>(null);
let seq = 0;
/** Per tab, the last jump a graph panel took: a panel mounted after the request still serves it (takeJump). */
const served = new Map<string, number>();

/**
 * Jump to the row `rowId` (default: the commit itself) once commit `oid` is loaded, and select it. A diff shown in
 * the graph's place is closed, so the jump is served and seen.
 */
export function requestJump(tab: Tab, oid: string, rowId: RowId = oid): void {
  const key = tabKey(tab);
  jumpStore.set({ seq: ++seq, key, oid, rowId });
  if (shownPanelStore.get().get(key) === DIFF_PANEL_ID) closeDiff(tab);
}

/** The tab's jump not yet taken, marked taken; null when there is none. */
export function takeJump(key: string): JumpRequest | null {
  const j = jumpStore.get();
  if (!j || j.key !== key || j.seq <= (served.get(key) ?? 0)) return null;
  served.set(key, j.seq);
  return j;
}
export function requestDetails(tab: Tab): void {
  detailsRequestStore.set({ seq: ++seq, key: tabKey(tab) });
}
export function resetJump(): void {
  served.clear();
  jumpStore.set(null);
  detailsRequestStore.set(null);
}
