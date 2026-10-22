import type { Target } from '@/lib/endpoints';
import { refreshWorkdir, requestFocus, setAmend, setDialogOpen } from '@/state/workdir';

export { refreshWorkdir };
export { restoreFile } from './actions';

/** Tailwind's `lg`: at and above it the right slot (the Changes panel) is shown; below it the Changes dialog. */
export const WIDE_LG_QUERY = '(min-width: 64rem)';

/**
 * Brings up the working tree's commit box for `target` — the graph's work-in-progress row and "edit HEAD message" call
 * it. Wide: focuses the panel's summary; narrow: opens the Changes dialog focused there. `amend: 'message'` ticks
 * Amend, which loads HEAD's message.
 */
export function openWorkingTree(target: Target, opts: { amend?: 'message' } = {}): void {
  const wide = window.matchMedia(WIDE_LG_QUERY).matches;
  if (!wide) setDialogOpen(target, true);
  requestFocus(target, wide ? 'slot' : 'dialog');
  if (opts.amend === 'message') void setAmend(target, true);
}
