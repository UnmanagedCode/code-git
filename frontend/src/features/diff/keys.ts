import type { Shortcut } from '@/shell/shortcuts';

// The diff's keys (the catalog: shell/shortcuts.ts), while focus is inside the diff panel.

const ANY = 'any' as const;
export const DIFF_FIND_KEY: Shortcut = { id: 'diff.find', label: 'Find in the file', scope: 'Diff', combos: [{ key: 'f', mod: true }] };
export const DIFF_CHANGE_KEY: Shortcut = { id: 'diff.change', label: 'Next / previous change', scope: 'Diff', combos: [{ key: 'ArrowDown', alt: true, shift: ANY }, { key: 'ArrowUp', alt: true, shift: ANY }] };
export const DIFF_ESCAPE_KEY: Shortcut = { id: 'diff.close', label: 'Close the search, else the diff', scope: 'Diff', combos: [{ key: 'Escape', shift: ANY }] };
export const DIFF_SEARCH_NEXT_KEY: Shortcut = { id: 'diff.searchNext', label: 'Next / previous match (in the find box)', scope: 'Diff', combos: [{ key: 'Enter', mod: ANY, alt: ANY }, { key: 'Enter', shift: true, mod: ANY, alt: ANY }] };
export const DIFF_SEARCH_CLOSE_KEY: Shortcut = { id: 'diff.searchClose', label: 'Close the find box', scope: 'Diff', combos: [{ key: 'Escape', mod: ANY, shift: ANY, alt: ANY }] };
export const DIFF_FILE_MOVE_KEY: Shortcut = { id: 'diff.fileMove', label: 'Previous / next file (in the file list)', scope: 'Diff', combos: [{ key: 'ArrowUp', mod: ANY, shift: ANY }, { key: 'ArrowDown', mod: ANY, shift: ANY }] };
export const DIFF_KEYS: Shortcut[] = [DIFF_FIND_KEY, DIFF_CHANGE_KEY, DIFF_ESCAPE_KEY, DIFF_SEARCH_NEXT_KEY, DIFF_SEARCH_CLOSE_KEY, DIFF_FILE_MOVE_KEY];
