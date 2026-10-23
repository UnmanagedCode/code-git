import type { Shortcut } from '@/shell/shortcuts';

// The commit graph's keys (the catalog: shell/shortcuts.ts; docs/graph.md → Keyboard), checked in this order.

const ANY = 'any' as const;
export const GRAPH_SEARCH_KEY: Shortcut = { id: 'graph.search', label: 'Search commits', scope: 'Graph', combos: [{ key: 'f', mod: true, shift: ANY, alt: ANY }, { key: '/', shift: ANY, alt: ANY }] };
export const GRAPH_FIRST_KEY: Shortcut = { id: 'graph.first', label: 'First row', scope: 'Graph', combos: [{ key: 'Home', mod: true, shift: ANY, alt: ANY }] };
export const GRAPH_LAST_KEY: Shortcut = { id: 'graph.last', label: 'Last loaded row', scope: 'Graph', combos: [{ key: 'End', mod: true, shift: ANY, alt: ANY }] };
export const GRAPH_MENU_KEY: Shortcut = { id: 'graph.menu', label: "The focused row's menu", scope: 'Graph', combos: [{ key: 'ContextMenu', mod: ANY, shift: ANY, alt: ANY }, { key: 'F10', shift: true, mod: ANY, alt: ANY }] };
export const GRAPH_CLEAR_KEY: Shortcut = { id: 'graph.clear', label: 'Clear the selection (or stop a search)', scope: 'Graph', combos: [{ key: 'Escape', mod: ANY, shift: ANY, alt: ANY }] };
export const GRAPH_OPEN_KEY: Shortcut = { id: 'graph.open', label: "Open the selection's diff", scope: 'Graph', combos: [{ key: 'Enter' }] };
export const GRAPH_LANE_KEY: Shortcut = { id: 'graph.lane', label: 'Next / previous commit in the lane', scope: 'Graph', combos: [{ key: 'J', exact: true, shift: ANY }, { key: 'ArrowDown', shift: true }, { key: 'K', exact: true, shift: ANY }, { key: 'ArrowUp', shift: true }] };
export const GRAPH_STEP_KEY: Shortcut = { id: 'graph.step', label: 'Next / previous row', scope: 'Graph', combos: [{ key: 'j', exact: true, shift: ANY }, { key: 'ArrowDown' }, { key: 'k', exact: true, shift: ANY }, { key: 'ArrowUp' }] };
export const GRAPH_SEARCH_NEXT_KEY: Shortcut = { id: 'graph.searchNext', label: 'Next / previous match (in the search box)', scope: 'Graph', combos: [{ key: 'Enter', mod: ANY, alt: ANY }, { key: 'Enter', shift: true, mod: ANY, alt: ANY }] };
export const GRAPH_SEARCH_CLOSE_KEY: Shortcut = { id: 'graph.searchClose', label: 'Clear the search (in the search box)', scope: 'Graph', combos: [{ key: 'Escape', mod: ANY, shift: ANY, alt: ANY }] };
export const DRAG_CANCEL_KEY: Shortcut = { id: 'graph.dragCancel', label: 'Cancel a branch drag', scope: 'Graph', combos: [{ key: 'Escape', mod: ANY, shift: ANY, alt: ANY }] };
export const COLUMN_MENU_KEY: Shortcut = { id: 'graph.columnMenu', label: "A column header's menu", scope: 'Graph', combos: [{ key: 'ContextMenu', mod: ANY, shift: ANY, alt: ANY }, { key: 'F10', shift: true, mod: ANY, alt: ANY }] };
export const GRAPH_KEYS: Shortcut[] = [
  GRAPH_STEP_KEY, GRAPH_LANE_KEY, GRAPH_FIRST_KEY, GRAPH_LAST_KEY, GRAPH_OPEN_KEY, GRAPH_MENU_KEY, GRAPH_CLEAR_KEY, GRAPH_SEARCH_KEY,
  GRAPH_SEARCH_NEXT_KEY, GRAPH_SEARCH_CLOSE_KEY, DRAG_CANCEL_KEY, COLUMN_MENU_KEY,
];
