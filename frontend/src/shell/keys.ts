import type { Shortcut } from './shortcuts';

// The shell's own keys (the catalog: shell/shortcuts.ts): the palette and the sheet, and the palette's list keys.

const ANY = 'any' as const;
/** Opens the command palette; preventDefault also keeps the browser from printing. */
export const PALETTE_KEY: Shortcut = { id: 'shell.palette', label: 'Command palette', scope: 'Global', combos: [{ key: 'p', mod: true }] };
/** Shift is free: `/` needs it on some layouts. */
export const SHEET_KEY: Shortcut = { id: 'shell.shortcuts', label: 'Keyboard shortcuts', scope: 'Global', combos: [{ key: '/', mod: true, shift: ANY }] };
export const PALETTE_MOVE_KEY: Shortcut = { id: 'palette.move', label: 'Previous / next command', scope: 'Command palette', combos: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }] };
export const PALETTE_RUN_KEY: Shortcut = { id: 'palette.run', label: 'Run the highlighted command', scope: 'Command palette', combos: [{ key: 'Enter' }] };
export const PALETTE_BACK_KEY: Shortcut = { id: 'palette.back', label: 'Back to the commands (in a pick), else close', scope: 'Command palette', combos: [{ key: 'Escape' }] };
export const PANE_WIDTH_STEP_KEY: Shortcut = { id: 'shell.paneWidthStep', label: "Move a side pane's edge left / right (on its resize handle)", scope: 'Side panes', combos: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }] };
export const PANE_WIDTH_BOUND_KEY: Shortcut = { id: 'shell.paneWidthBound', label: 'Side pane at its minimum / maximum width (on its resize handle)', scope: 'Side panes', combos: [{ key: 'Home' }, { key: 'End' }] };
export const SHELL_KEYS: Shortcut[] = [PALETTE_KEY, SHEET_KEY, PALETTE_MOVE_KEY, PALETTE_RUN_KEY, PALETTE_BACK_KEY, PANE_WIDTH_STEP_KEY, PANE_WIDTH_BOUND_KEY];
