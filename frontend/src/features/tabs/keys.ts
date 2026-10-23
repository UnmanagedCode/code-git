import type { Shortcut } from '@/shell/shortcuts';

// The tab bar's keys (the catalog: shell/shortcuts.ts). They act while focus is anywhere in the plugin frame.

export const TAB_KEYS = [
  { id: 'tabs.activate', label: 'Go to tab 1–8', scope: 'Tabs', combos: ['1', '2', '3', '4', '5', '6', '7', '8'].map((key) => ({ key, mod: true })) },
  { id: 'tabs.last', label: 'Go to the last tab', scope: 'Tabs', combos: [{ key: '9', mod: true }] },
] as const satisfies readonly Shortcut[];
export const [TAB_ACTIVATE, TAB_LAST] = TAB_KEYS;
