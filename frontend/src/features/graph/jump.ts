import { createStore } from '@/state/store';
import { tabKey, type Tab } from '@/state/tabs';
import type { RowId } from './types';

// Requests the graph panel acts on: jump to a row (paging until its commit is loaded) and show the details of the
// selection (a dialog on narrow screens). Menus, the refs panel and the details panel raise them.

export interface JumpRequest { seq: number; key: string; oid: string; rowId: RowId }
export const jumpStore = createStore<JumpRequest | null>(null);
export const detailsRequestStore = createStore<{ seq: number; key: string } | null>(null);
let seq = 0;

/** Jump to the row `rowId` (default: the commit itself) once commit `oid` is loaded, and select it. */
export function requestJump(tab: Tab, oid: string, rowId: RowId = oid): void {
  jumpStore.set({ seq: ++seq, key: tabKey(tab), oid, rowId });
}
export function requestDetails(tab: Tab): void {
  detailsRequestStore.set({ seq: ++seq, key: tabKey(tab) });
}
export function resetJump(): void {
  jumpStore.set(null);
  detailsRequestStore.set(null);
}
