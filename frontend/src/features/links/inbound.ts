import { requestJump } from '@/features/graph/jump';
import { openFileHistory } from '@/features/history/open';
import type { LinkIntent } from '@/lib/route';
import { getGraph, graphStore } from '@/state/graph';
import { hidePanel } from '@/state/shownPanel';
import type { Tab } from '@/state/tabs';

// Applies a link from another plugin (lib/route.ts → consumeLink) to the tab it opened.

/** The pending commit link's graph wait; a newer link cancels it. */
let waiting: (() => void) | null = null;

export function cancelLink(): void {
  waiting?.();
  waiting = null;
}

/**
 * A `path` opens that file's history from `commit`. A commit alone is jumped to in the graph, with any panel shown in
 * its place hidden, once the tab's graph is ready: a jump served before its first snapshot reads as "not in the graph".
 */
export function followLink(tab: Tab, { commit, path }: LinkIntent): void {
  cancelLink();
  if (path !== undefined) return openFileHistory(tab, { path, rev: commit });
  hidePanel(tab);
  const check = () => {
    const { status } = getGraph(tab);
    if (status === 'error') return cancelLink();
    if (status !== 'ready') return;
    cancelLink();
    requestJump(tab, commit);
  };
  waiting = graphStore.subscribe(check);
  check();
}
