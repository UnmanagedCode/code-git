import type { SelectedRow } from '@/state/graphSelection';

/**
 * The right slot holds the Changes panel and the commit details; it shows one of them, by the graph's selection: Changes
 * with nothing selected or a single WIP row selected, the details for a commit, a stash or several rows.
 */
export const changesInRightSlot = (items: readonly SelectedRow[]): boolean => items.length === 0 || (items.length === 1 && items[0].kind === 'wip');
