import type { Shortcut } from '@/shell/shortcuts';
import { ACTION_KEY, ACTION_LABEL } from './model';

// The interactive-rebase editor's keys on a focused row (the catalog: shell/shortcuts.ts).

const ANY = 'any' as const;
export const REBASE_FOCUS_KEY: Shortcut = { id: 'rebase.focus', label: 'Previous / next row', scope: 'Rebase editor', combos: [{ key: 'ArrowUp', shift: ANY, mod: ANY }, { key: 'ArrowDown', shift: ANY, mod: ANY }] };
export const REBASE_MOVE_KEY: Shortcut = { id: 'rebase.move', label: 'Move the row up / down', scope: 'Rebase editor', combos: [{ key: 'ArrowUp', alt: true, shift: ANY, mod: ANY }, { key: 'ArrowDown', alt: true, shift: ANY, mod: ANY }] };
/** One per action: P, R, E, S, F, D. */
export const REBASE_ACTION_KEYS: Shortcut[] = Object.entries(ACTION_KEY).map(([key, action]) => ({
  id: `rebase.${action}`, label: ACTION_LABEL[action], scope: 'Rebase editor', combos: [{ key, shift: ANY }],
}));
export const REBASE_KEYS: Shortcut[] = [REBASE_FOCUS_KEY, REBASE_MOVE_KEY, ...REBASE_ACTION_KEYS];
