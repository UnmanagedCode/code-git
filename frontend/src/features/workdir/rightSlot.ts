import type { Stash } from '@/features/graph/types';
import { diffOwnerCommit, diffOwnerPair, samePair, useOpenDiff } from '@/features/diff/binding';
import type { DiffTabState } from '@/state/diff';
import { useGraphData } from '@/state/graph';
import { useGraphSelection, type SelectedRow } from '@/state/graphSelection';
import type { Tab } from '@/state/tabs';

export type RightSlot = 'changes' | 'details' | 'diff-files';

/**
 * What the right slot shows. While a diff is open, the list that drives it: Changes for an unstaged or staged diff, the
 * commit details when the diff is the selected commit's or stash's, or the two-commit diff of the two selected commits,
 * else the Changed files panel. With no diff open, by
 * the graph's selection: Changes for nothing or a single WIP row, else the details.
 */
export function rightSlotFor(items: readonly SelectedRow[], diff: DiffTabState | null, stashes: readonly Stash[]): RightSlot {
  if (diff) {
    if (diff.source.kind === 'unstaged' || diff.source.kind === 'staged') return 'changes';
    const only = items.length === 1 ? items[0] : null;
    if (only && only.kind !== 'wip' && only.oid === diffOwnerCommit(diff, stashes)) return 'details';
    const oids = items.flatMap((it) => (it.kind === 'commit' ? [it.oid] : []));
    if (oids.length === items.length && samePair(diffOwnerPair(diff), oids)) return 'details';
    return 'diff-files';
  }
  return items.length === 0 || (items.length === 1 && items[0].kind === 'wip') ? 'changes' : 'details';
}

/** rightSlotFor for the tab, as a hook. */
export function useRightSlot(tab: Tab): RightSlot {
  const sel = useGraphSelection(tab);
  const diff = useOpenDiff(tab);
  const stashes = useGraphData(tab).refs?.stashes ?? [];
  return rightSlotFor(sel.items, diff, stashes);
}
