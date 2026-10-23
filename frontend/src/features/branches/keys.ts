import type { Shortcut } from '@/shell/shortcuts';

// The branch keys (the catalog: shell/shortcuts.ts).

/** Opens Create branch from HEAD, unless focus is in a text field or a branch dialog is open. */
export const CREATE_BRANCH_KEY: Shortcut = { id: 'branches.create', label: 'Create a branch from HEAD', scope: 'Global', combos: [{ key: 'b', mod: true }] };
export const BRANCH_KEYS: Shortcut[] = [CREATE_BRANCH_KEY];
