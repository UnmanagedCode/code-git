import type { Target } from '@/lib/endpoints';
import { endDiff, startDiff } from '@/state/diff';
import { hidePanel, showPanel } from '@/state/shownPanel';
import type { DiffFilesResult, DiffSource } from './api';

/** The id of the center on-demand panel the diff renders in. */
export const DIFF_PANEL_ID = 'diff';

/**
 * Opens the diff of `source` in `target`'s center slot, in place of its default panels (the commit graph).
 * `path` picks the file to show first (default: the first listed). Calling it again replaces the tab's diff,
 * which is how a work-in-progress source is refetched. `preloaded` is a diff.files answer already fetched for `source`.
 */
export function openDiff(target: Target, source: DiffSource, opts: { path?: string; preloaded?: DiffFilesResult } = {}): void {
  startDiff(target, source, opts);
  showPanel(target, DIFF_PANEL_ID);
}

/** Closes the tab's diff: its slot shows its default panels again. */
export function closeDiff(target: Target): void {
  hidePanel(target);
  endDiff(target);
}
