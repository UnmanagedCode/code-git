import { closeDiff, DIFF_PANEL_ID } from '@/features/diff/openDiff';
import { requestJump } from '@/features/graph/jump';
import { openFileHistory } from '@/features/history/open';
import type { LinkIntent } from '@/lib/route';
import { getGraph, graphStore } from '@/state/graph';
import { hidePanel, shownPanelStore } from '@/state/shownPanel';
import { tabKey, tabsStore, type Tab } from '@/state/tabs';
import { summaryStore } from '@/state/useRepoSummary';

// Applies a link from another plugin (lib/route.ts → consumeLink) to the tab it opened.

/** The pending commit link's wait; a newer link, the tab's close, a failed load or App's unmount cancels it. */
let waiting: (() => void) | null = null;

export function cancelLink(): void {
  waiting?.();
  waiting = null;
}

/**
 * A `path` opens that file's history from `commit`. A commit alone is jumped to in the graph, with any panel shown in
 * its place closed, once the tab's graph is ready: a jump served before its first snapshot reads as "not in the graph".
 * The wait ends unserved when the tab closes, its graph fails, or its summary is refused (the graph never starts): a
 * link must not jump later, unasked, when the tab is reopened.
 */
export function followLink(tab: Tab, { commit, path }: LinkIntent): void {
  cancelLink();
  if (path !== undefined) return openFileHistory(tab, { path, rev: commit });
  const key = tabKey(tab);
  if (shownPanelStore.get().get(key) === DIFF_PANEL_ID) closeDiff(tab);
  else hidePanel(tab);
  const check = () => {
    const s = summaryStore.get().get(key);
    const refused = !!s?.error && !s.summary && !s.loading;
    const closed = !tabsStore.get().open.some((t) => tabKey(t) === key);
    const { status } = getGraph(tab);
    if (closed || refused || status === 'error') return cancelLink();
    if (status !== 'ready') return;
    cancelLink();
    requestJump(tab, commit);
  };
  const offs = [graphStore, tabsStore, summaryStore].map((store) => store.subscribe(check));
  waiting = () => offs.forEach((off) => off());
  check();
}
