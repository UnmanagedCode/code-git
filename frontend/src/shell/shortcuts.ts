import { BRANCH_KEYS } from '@/features/branches/keys';
import { CONFLICT_KEYS } from '@/features/conflicts/keys';
import { DIFF_KEYS } from '@/features/diff/keys';
import { GRAPH_KEYS } from '@/features/graph/keys';
import { REBASE_KEYS } from '@/features/rebase/keys';
import { TAB_KEYS } from '@/features/tabs/keys';
import { UNDO_KEYS } from '@/features/undo/keys';
import { COMMIT_KEYS, WORKDIR_KEYS } from '@/features/workdir/keys';
import { SHELL_KEYS } from './keys';

// The one shortcut catalog (docs/architecture.md → Extension points). Every key handler matches its event against a
// catalog Shortcut here, and the shortcut sheet and the command palette render the same entries, so a binding cannot
// exist without being listed. This is the only module that reads an event's key or modifier fields (guards.test.ts).

/** A modifier's requirement: held, not held (the default), or either. */
export type Mod = boolean | 'any';

export interface Combo {
  /** `KeyboardEvent.key`: a single character (case-insensitive unless `exact`), or a named key (`Enter`, `ArrowUp`, …). */
  key: string;
  /** Ctrl, or ⌘ on macOS. */
  mod?: Mod;
  shift?: Mod;
  alt?: Mod;
  /** Compare a single-character key case-sensitively (`J` is not `j`). */
  exact?: boolean;
}

export interface Shortcut {
  id: string;
  /** What it does, as the sheet and the palette show it. */
  label: string;
  combos: Combo[];
  /** Where it acts: the sheet's section. */
  scope: string;
}

/** The fields of a key or pointer event this module reads. */
interface Mods { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }
type KeyLike = Mods & { key: string };

const held = (want: Mod | undefined, is: boolean) => want === 'any' || (want ?? false) === is;

function keyMatches(c: Combo, key: string): boolean {
  if (key === c.key) return true;
  return !c.exact && c.key.length === 1 && key.length === 1 && key.toLowerCase() === c.key.toLowerCase();
}

/** The first of `s`'s combos `e` presses, or null. */
export function matchCombo(e: KeyLike, s: Shortcut): Combo | null {
  const mod = e.ctrlKey || e.metaKey;
  return s.combos.find((c) => keyMatches(c, e.key) && held(c.mod, mod) && held(c.shift, e.shiftKey) && held(c.alt, e.altKey)) ?? null;
}

/** Whether `e` presses one of `s`'s combos. */
export const matches = (e: KeyLike, s: Shortcut): boolean => matchCombo(e, s) !== null;

/** A pointer event's modifiers, for click semantics (Shift-click extends, Ctrl/⌘-click toggles). */
export const pointerMods = (e: Mods): { shift: boolean; mod: boolean; alt: boolean } => ({ shift: e.shiftKey, mod: e.ctrlKey || e.metaKey, alt: e.altKey });

const KEY_LABEL: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space', ContextMenu: 'Menu key',
};

/** "Ctrl/⌘+Shift+S", "Alt+↓", "J". A modifier that may be either way is not shown. */
export function comboLabel(c: Combo): string {
  const parts: string[] = [];
  if (c.mod === true) parts.push('Ctrl/⌘');
  if (c.alt === true) parts.push('Alt');
  if (c.shift === true || (c.exact && /^[A-Z]$/.test(c.key) && c.shift !== false)) parts.push('Shift');
  parts.push(KEY_LABEL[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key));
  return parts.join('+');
}

const sameMods = (a: Combo, b: Combo) => a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;

/** Every combo of `s`, labelled: "Ctrl/⌘+F or /"; a run of three or more consecutive digits as one: "Ctrl/⌘+1…8". */
export function shortcutLabel(s: Shortcut): string {
  const c = s.combos;
  const digits = c.length >= 3 && c.every((x, i) => /^\d$/.test(x.key) && sameMods(x, c[0]) && (i === 0 || Number(x.key) === Number(c[i - 1].key) + 1));
  if (digits) return `${comboLabel(c[0])}…${c[c.length - 1].key}`;
  return c.map(comboLabel).join(' or ');
}

export interface ShortcutGroup { scope: string; shortcuts: Shortcut[] }

/** The catalog, by scope, in the order the sheet shows it. A feature adds its `keys.ts` list here. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = (() => {
  const all = [...SHELL_KEYS, ...UNDO_KEYS, ...TAB_KEYS, ...BRANCH_KEYS, ...GRAPH_KEYS, ...WORKDIR_KEYS, ...COMMIT_KEYS, ...DIFF_KEYS, ...REBASE_KEYS, ...CONFLICT_KEYS];
  const groups: ShortcutGroup[] = [];
  for (const s of all) {
    const g = groups.find((x) => x.scope === s.scope) ?? groups[groups.push({ scope: s.scope, shortcuts: [] }) - 1];
    g.shortcuts.push(s);
  }
  return groups;
})();
