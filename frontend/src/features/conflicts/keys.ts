import type { Shortcut } from '@/shell/shortcuts';

// The merge tool's keys (the catalog: shell/shortcuts.ts), while focus is inside the tool.

const ANY = 'any' as const;
export const CONFLICT_BLOCK_KEY: Shortcut = { id: 'conflicts.block', label: 'Previous / next conflict', scope: 'Merge tool', combos: [{ key: 'ArrowUp', alt: true, mod: ANY, shift: ANY }, { key: 'ArrowDown', alt: true, mod: ANY, shift: ANY }] };
export const CONFLICT_SAVE_KEY: Shortcut = { id: 'conflicts.save', label: 'Save the output to the file', scope: 'Merge tool', combos: [{ key: 's', mod: true, shift: ANY, alt: ANY }] };
export const CONFLICT_KEYS: Shortcut[] = [CONFLICT_BLOCK_KEY, CONFLICT_SAVE_KEY];
