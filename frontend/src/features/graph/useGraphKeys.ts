import type { KeyboardEvent } from 'react';
import { matchCombo, matches } from '@/shell/shortcuts';
import {
  GRAPH_CLEAR_KEY, GRAPH_FIRST_KEY, GRAPH_LANE_KEY, GRAPH_LAST_KEY, GRAPH_MENU_KEY, GRAPH_OPEN_KEY, GRAPH_SEARCH_KEY, GRAPH_STEP_KEY,
} from './keys';
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
    const down = (c: { key: string }) => c.key === 'J' || c.key === 'j' || c.key === 'ArrowDown';
    const inLane = matchCombo(e, GRAPH_LANE_KEY);
    const stepping = matchCombo(e, GRAPH_STEP_KEY);
    let handled = true;
    if (matches(e, GRAPH_SEARCH_KEY)) a.focusSearch();
    else if (matches(e, GRAPH_FIRST_KEY)) { if (n) a.moveTo(0); }
    else if (matches(e, GRAPH_LAST_KEY)) { if (n) a.moveTo(n - 1); }
    else if (matches(e, GRAPH_MENU_KEY)) { if (a.focus !== -1) a.openMenu(a.focus); }
    else if (matches(e, GRAPH_CLEAR_KEY)) { if (!a.cancelSeek()) a.clear(); }
    else if (matches(e, GRAPH_OPEN_KEY)) a.openDiff();
    else if (inLane) lane(down(inLane) ? 1 : -1);
    else if (stepping) step(down(stepping) ? 1 : -1);
    else handled = false;
    if (handled) e.preventDefault();
  };
}
