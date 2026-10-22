import type { DiffSource } from '@/features/diff/api';
import { openDiff } from '@/features/diff/openDiff';
import type { Target } from '@/lib/endpoints';
import { getGraph } from '@/state/graph';
import { fileIntentStore, getSelection, type SelectedRow } from '@/state/graphSelection';
import { dispatchTabs, tabKey, type Tab } from '@/state/tabs';
import type { Checkout } from './types';

// The graph's hand-off to the diff viewer (features/diff/openDiff.ts; docs/graph.md → Diffs).

/** A checkout's work in progress: unstaged changes, or the staged ones when nothing else is pending. */
export function wipSource(c: Checkout | undefined): DiffSource {
  const n = c?.counts;
  return n && n.unstaged + n.untracked + n.conflicted === 0 && n.staged > 0 ? { kind: 'staged' } : { kind: 'unstaged' };
}

/**
 * The diff a selection opens, and in which checkout: one commit or stash → that commit against its first parent;
 * one WIP row → its checkout's work in progress; several commits (with, at most, the own checkout's WIP) → the
 * combined `commits` source. Null for anything else (stashes or another checkout's WIP in a multi-selection).
 */
export function selectionDiff(tab: Tab, items: SelectedRow[], checkouts: Checkout[]): { target: Target; source: DiffSource } | null {
  if (items.length === 1) {
    const it = items[0];
    if (it.kind !== 'wip') return { target: tab, source: { kind: 'commit', rev: it.oid } };
    return { target: it.checkout, source: wipSource(checkouts.find((c) => tabKey(c.target) === tabKey(it.checkout))) };
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

/** Opens the diff of the tab's current selection (Enter, the details panel's button); false when it has none. */
export function openSelectionDiff(tab: Tab): boolean {
  const d = selectionDiff(tab, getSelection(tab).items, getGraph(tab).checkouts);
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
