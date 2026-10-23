import { BRANCH_COMMANDS } from '@/features/branches/commands';
import { REMOTE_COMMANDS } from '@/features/remotes/commands';
import { STASH_COMMANDS } from '@/features/stash/commands';
import { TAB_COMMANDS } from '@/features/tabs/commands';
import { WORKDIR_COMMANDS } from '@/features/workdir/commands';
import { loadSummary } from '@/state/useRepoSummary';
import { refreshGraph } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import { SHEET_KEY } from './keys';
import { openShortcutSheet } from './overlays';
import type { Shortcut } from './shortcuts';

// The command palette's registry (docs/architecture.md → Extension points). A feature adds a `commands.ts` list and one
// entry in COMMANDS; every command calls an entry point the feature already has.

/** One row of a command's second stage (a branch, a file, a tab). */
export interface PickItem { id: string; label: string; detail?: string }

export interface Command {
  id: string;
  title: string;
  /** The palette's section label. */
  group: string;
  /** Shown beside the title, from the catalog. */
  shortcut?: Shortcut;
  /** Offered with no tab open too (then `run` gets null). */
  global?: boolean;
  /** Hidden unless true (no tab, an unborn HEAD, nothing to undo, …). */
  when?: (tab: Tab) => boolean;
  run?: (tab: Tab) => void | Promise<unknown>;
  /** A second stage: pick one of `items`, or (`typed`) the text itself. */
  pick?: {
    placeholder: string;
    items: (tab: Tab) => PickItem[] | Promise<PickItem[]>;
    /** A row for what was typed when no item is it (a path not listed). */
    typed?: (text: string) => PickItem | null;
    run: (tab: Tab, item: PickItem) => void | Promise<unknown>;
  };
}

const SHELL_COMMANDS: Command[] = [
  { id: 'shell.shortcuts', title: 'Show keyboard shortcuts', group: 'Help', shortcut: SHEET_KEY, global: true, run: () => openShortcutSheet() },
  { id: 'shell.refresh', title: 'Refresh', group: 'View', run: (tab) => { void loadSummary(tab); void refreshGraph(tab, 'manual'); } },
];

export const COMMANDS: Command[] = [...SHELL_COMMANDS, ...WORKDIR_COMMANDS, ...BRANCH_COMMANDS, ...REMOTE_COMMANDS, ...STASH_COMMANDS, ...TAB_COMMANDS];

/** Whether `query`'s characters appear in `text` in order (case-insensitive); the empty query matches everything. */
export function subsequence(query: string, text: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length;
}

/** The commands offered for `tab` whose title matches `query`, in registry order. */
export function filterCommands(list: readonly Command[], tab: Tab | null, query: string): Command[] {
  return list.filter((c) => (tab ? (c.when?.(tab) ?? true) : !!c.global) && subsequence(query, c.title));
}

/** A pick's rows matching `query`, then the typed row when it is not one of them. */
export function filterPicks(items: readonly PickItem[], query: string, typed?: (text: string) => PickItem | null): PickItem[] {
  const shown = items.filter((i) => subsequence(query, i.label));
  const own = query.trim() && typed ? typed(query.trim()) : null;
  return own && !items.some((i) => i.label === own.label) ? [...shown, own] : shown;
}
