import type { Shortcut } from '@/shell/shortcuts';

// Undo and redo (the catalog: shell/shortcuts.ts). Global, off in text fields (their own undo wins) and dialogs.

export const UNDO_KEY: Shortcut = { id: 'undo.undo', label: 'Undo the last op', scope: 'Global', combos: [{ key: 'z', mod: true }] };
export const REDO_KEY: Shortcut = { id: 'undo.redo', label: 'Redo', scope: 'Global', combos: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }] };
export const UNDO_KEYS: Shortcut[] = [UNDO_KEY, REDO_KEY];
