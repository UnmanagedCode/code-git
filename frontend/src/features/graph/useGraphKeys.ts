import type { KeyboardEvent } from 'react';
import type { GraphRow, LayoutRow } from './types';

export interface GraphKeyActions {
  rows: GraphRow[];
  layout: LayoutRow[];
  /** Index of the focused row, -1 when none. */
  focus: number;
  /** Selects only row `i` and scrolls it into view. */
  moveTo(i: number): void;
  /** Called when a move runs past the last loaded row. */
  loadMore(): void;
  clear(): void;
  openMenu(i: number): void;
  focusSearch(): void;
  cancelSeek(): boolean;
  /** Opens the selection's diff. */
  openDiff(): void;
}

const inField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/**
 * The graph's keys (docs/graph.md → Keyboard): j/k or arrows move, Shift+J/K stay in the lane, Ctrl/⌘+Home/End jump to
 * the ends, Esc clears (or cancels a running seek), Enter opens the selection's diff, Shift+F10 / ContextMenu open the row
 * menu, Ctrl/⌘+F or / search.
 */
export function graphKeyHandler(a: GraphKeyActions) {
  return (e: KeyboardEvent) => {
    if (inField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const n = a.rows.length;
    const step = (by: number) => {
      const to = a.focus === -1 ? 0 : a.focus + by;
      if (to >= n) { a.loadMore(); return; }
      if (to >= 0) a.moveTo(to);
    };
    const lane = (by: number) => {
      if (a.focus === -1) return step(by);
      const col = a.layout[a.focus]?.col;
      for (let i = a.focus + by; i >= 0 && i < n; i += by) if (a.layout[i]?.col === col) return a.moveTo(i);
      if (by > 0) a.loadMore();
    };
    let handled = true;
    if (mod && (e.key === 'f' || e.key === 'F')) a.focusSearch();
    else if (e.key === '/' && !mod) a.focusSearch();
    else if (mod && e.key === 'Home') { if (n) a.moveTo(0); }
    else if (mod && e.key === 'End') { if (n) a.moveTo(n - 1); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { if (a.focus !== -1) a.openMenu(a.focus); }
    else if (e.key === 'Escape') { if (!a.cancelSeek()) a.clear(); }
    else if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey) a.openDiff();
    else if (mod || e.altKey) handled = false;
    else if (e.key === 'J' || (e.shiftKey && e.key === 'ArrowDown')) lane(1);
    else if (e.key === 'K' || (e.shiftKey && e.key === 'ArrowUp')) lane(-1);
    else if (e.key === 'j' || e.key === 'ArrowDown') step(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') step(-1);
    else handled = false;
    if (handled) e.preventDefault();
  };
}
