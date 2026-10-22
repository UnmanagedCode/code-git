import type { GraphRow, RowId } from '@/features/graph/types';
import type { Target } from '@/lib/endpoints';
import { createStore, useStore } from './store';
import { tabKey, type Tab } from './tabs';

// The graph's selection per checkout, and the file a user opened from the details panel. Public: the diff viewer
// subscribes to both (docs/architecture.md → Extension points).

export type SelectedRow = { kind: 'commit'; oid: string } | { kind: 'stash'; oid: string } | { kind: 'wip'; checkout: Target };

export interface GraphSelection {
  /** Selected rows, top to bottom. */
  ids: RowId[];
  /** Where a Shift-click range starts. */
  anchor: RowId | null;
  /** The keyboard position. */
  focus: RowId | null;
  /** `ids` resolved, top to bottom. */
  items: SelectedRow[];
}

export type SelectionAction =
  | { type: 'click' | 'toggle' | 'range' | 'move'; id: RowId; rows: GraphRow[] }
  | { type: 'clear' }
  | { type: 'prune'; rows: GraphRow[] };

export const NO_SELECTION: GraphSelection = { ids: [], anchor: null, focus: null, items: [] };

/** A row as the selection lists it. */
export const toSelected = (r: GraphRow): SelectedRow => (r.kind === 'commit' ? { kind: 'commit', oid: r.id } : r.kind === 'stash' ? { kind: 'stash', oid: r.stash.oid } : { kind: 'wip', checkout: r.checkout.target });

function withIds(sel: Omit<GraphSelection, 'items'>, rows: GraphRow[]): GraphSelection {
  const want = new Set(sel.ids);
  const ordered = rows.filter((r) => want.has(r.id));
  return { ...sel, ids: ordered.map((r) => r.id), items: ordered.map(toSelected) };
}

/**
 * Click selects one row (clicking the only selected row again deselects it); toggle (Ctrl/⌘) adds or removes one;
 * range (Shift) selects anchor…row in row order; move (keyboard) selects only its target; prune drops rows gone after
 * a reload.
 */
export function selectionReducer(sel: GraphSelection, a: SelectionAction): GraphSelection {
  switch (a.type) {
    case 'click':
      if (sel.ids.length === 1 && sel.ids[0] === a.id) return { ids: [], anchor: null, focus: a.id, items: [] };
      return withIds({ ids: [a.id], anchor: a.id, focus: a.id }, a.rows);
    case 'move':
      return withIds({ ids: [a.id], anchor: a.id, focus: a.id }, a.rows);
    case 'toggle': {
      const ids = sel.ids.includes(a.id) ? sel.ids.filter((x) => x !== a.id) : [...sel.ids, a.id];
      return withIds({ ids, anchor: a.id, focus: a.id }, a.rows);
    }
    case 'range': {
      const ids = a.rows.map((r) => r.id);
      const from = sel.anchor === null ? -1 : ids.indexOf(sel.anchor);
      const to = ids.indexOf(a.id);
      if (to === -1) return sel;
      if (from === -1) return withIds({ ids: [a.id], anchor: a.id, focus: a.id }, a.rows);
      return withIds({ ids: ids.slice(Math.min(from, to), Math.max(from, to) + 1), anchor: sel.anchor, focus: a.id }, a.rows);
    }
    case 'clear':
      return sel.ids.length ? { ...NO_SELECTION, focus: sel.focus } : sel;
    case 'prune': {
      const present = new Set(a.rows.map((r) => r.id));
      const next = withIds({
        ids: sel.ids.filter((x) => present.has(x)),
        anchor: sel.anchor !== null && present.has(sel.anchor) ? sel.anchor : null,
        focus: sel.focus !== null && present.has(sel.focus) ? sel.focus : null,
      }, a.rows);
      const same = next.ids.length === sel.ids.length && next.anchor === sel.anchor && next.focus === sel.focus
        && next.ids.every((x, i) => x === sel.ids[i]);
      return same ? sel : next;
    }
  }
}

export const graphSelectionStore = createStore<ReadonlyMap<string, GraphSelection>>(new Map());

export const getSelection = (tab: Tab): GraphSelection => graphSelectionStore.get().get(tabKey(tab)) ?? NO_SELECTION;
export function dispatchSelection(tab: Tab, a: SelectionAction): void {
  const key = tabKey(tab);
  const cur = getSelection(tab);
  const next = selectionReducer(cur, a);
  if (next !== cur) graphSelectionStore.set((m) => new Map(m).set(key, next));
}
export const useGraphSelection = (tab: Tab): GraphSelection => useStore(graphSelectionStore).get(tabKey(tab)) ?? NO_SELECTION;
/** The selected rows of a checkout's graph, top to bottom. */
export const selectedRows = (tab: Tab): SelectedRow[] => getSelection(tab).items;

/** A file the user opened from a commit's file list. `seq` increases with every request. */
export interface FileOpenIntent {
  seq: number;
  tab: Tab;
  commit: string;
  /** The side it is compared against: the first parent, or null for a root commit. */
  parent: string | null;
  path: string;
  oldPath: string | null;
  selection: SelectedRow[];
}

export const fileIntentStore = createStore<FileOpenIntent | null>(null);
let seq = 0;
export function requestFileOpen(i: Omit<FileOpenIntent, 'seq' | 'selection'>): void {
  fileIntentStore.set({ ...i, seq: ++seq, selection: selectedRows(i.tab) });
}

export function resetGraphSelection(): void {
  graphSelectionStore.set(new Map());
  fileIntentStore.set(null);
}
