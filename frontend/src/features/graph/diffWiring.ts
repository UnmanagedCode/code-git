import type { DiffSource } from '@/features/diff/api';
import { openDiff } from '@/features/diff/openDiff';
import { openWip } from '@/features/workdir/entry';
import type { Target } from '@/lib/endpoints';
import { fileIntentStore, getSelection, type SelectedRow } from '@/state/graphSelection';
import { dispatchTabs, tabKey, type Tab } from '@/state/tabs';

// The graph's hand-off to the diff viewer (features/diff/openDiff.ts; docs/graph.md → Diffs) and, for a WIP row, to the
// Changes panel (features/workdir/entry.ts → openWip).

/**
 * The diff a selection opens, and in which checkout: one commit or stash → that commit against its first parent;
 * several commits (with, at most, the own checkout's WIP) → the combined `commits` source. Null for anything else: a
 * single WIP row (it opens the Changes panel instead: openSelectionDiff), stashes or another checkout's WIP in a
 * multi-selection.
 */
export function selectionDiff(tab: Tab, items: SelectedRow[]): { target: Target; source: DiffSource } | null {
  if (items.length === 1) {
    const it = items[0];
    return it.kind === 'wip' ? null : { target: tab, source: { kind: 'commit', rev: it.oid } };
  }
  const oids = items.flatMap((it) => (it.kind === 'commit' ? [it.oid] : []));
  const wips = items.filter((it) => it.kind === 'wip');
  if (!oids.length || items.some((it) => it.kind === 'stash') || wips.length > 1) return null;
  if (wips.length === 1 && wips[0].kind === 'wip' && tabKey(wips[0].checkout) !== tabKey(tab)) return null;
  return { target: tab, source: { kind: 'commits', oids, wip: wips.length === 1 } };
}

/** Opens a diff, in the checkout's own tab when it is another checkout's. */
export function openIn(tab: Tab, target: Target, source: DiffSource, opts: { path?: string } = {}): void {
  if (tabKey(target) !== tabKey(tab)) dispatchTabs({ type: 'open', tab: target });
  openDiff(target, source, opts);
}

/** Opens the diff of the tab's current selection (Enter, the multi-selection's View combined diff); a single WIP row opens its Changes panel. False when there is nothing to open. */
export function openSelectionDiff(tab: Tab): boolean {
  const items = getSelection(tab).items;
  if (items.length === 1 && items[0].kind === 'wip') {
    openWip(tab, items[0].checkout);
    return true;
  }
  const d = selectionDiff(tab, items);
  if (!d) return false;
  openIn(tab, d.target, d.source);
  return true;
}

// A file clicked in the details panel opens that commit's diff at the file. The commit source's default parent is
// the first, which is what the details panel lists a merge's files against.
let lastSeq = 0;
fileIntentStore.subscribe(() => {
  const i = fileIntentStore.get();
  if (!i || i.seq <= lastSeq) return;
  lastSeq = i.seq;
  openDiff(i.tab, { kind: 'commit', rev: i.commit }, { path: i.path });
});
