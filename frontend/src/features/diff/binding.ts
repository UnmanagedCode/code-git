import type { Stash } from '@/features/graph/types';
import { stashViewOf } from '@/features/stash/views';
import { diffStore, type DiffTabState } from '@/state/diff';
import { shownPanelStore, useShownPanel } from '@/state/shownPanel';
import { useStore } from '@/state/store';
import { tabKey, type Tab } from '@/state/tabs';
import { DIFF_PANEL_ID } from './openDiff';

// Which diff a file list beside it is bound to: the tab's diff, while it is the panel shown in the center.

/** The tab's diff while it is shown, else null. */
export function openDiffOf(tab: Tab): DiffTabState | null {
  return shownPanelStore.get().get(tabKey(tab)) === DIFF_PANEL_ID ? diffStore.get().get(tabKey(tab)) ?? null : null;
}

/** openDiffOf as a hook. */
export function useOpenDiff(tab: Tab | null): DiffTabState | null {
  const shown = useShownPanel(tab);
  const diffs = useStore(diffStore);
  return tab && shown === DIFF_PANEL_ID ? diffs.get(tabKey(tab)) ?? null : null;
}

/**
 * The graph row a commit diff belongs to: its commit (the resolved oid once listed, else the rev as given), or the
 * stash whose All / Staged / Untracked view it is. Null for any other source.
 */
export function diffOwnerCommit(state: DiffTabState, stashes: readonly Stash[]): string | null {
  if (state.source.kind !== 'commit') return null;
  const oid = state.list.result?.commit?.oid ?? state.source.rev;
  return stashViewOf(stashes, oid)?.stash.oid ?? oid;
}
