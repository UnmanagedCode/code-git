import type { Target } from '@/lib/endpoints';
import { LG_QUERY } from '@/lib/useMediaQuery';
import { dispatchSelection, getSelection } from '@/state/graphSelection';
import { dispatchTabs, tabKey, type Tab } from '@/state/tabs';
import { openDiffOf } from '@/features/diff/binding';
import { stashesOf } from '@/features/stash/views';
import { refreshWorkdir, requestFocus, setAmend, setDialogOpen } from '@/state/workdir';
import { rightSlotFor } from './rightSlot';

export { refreshWorkdir };
export { restoreFile } from './actions';

/**
 * Brings up the working tree's Changes panel for `target` — the graph's work-in-progress row and "Edit HEAD message" call
 * it. Wide: the right slot shows Changes (a commit selection, which would show the details there, is cleared) and, unless
 * `focus: false`, its summary takes the focus; narrow, or while a diff other than an unstaged or staged one holds the
 * slot for its file list: the Changes dialog opens. `amend: 'message'` ticks Amend, which loads HEAD's message.
 */
export function openWorkingTree(target: Target, opts: { amend?: 'message'; focus?: boolean } = {}): void {
  const diff = openDiffOf(target);
  const inDialog = !window.matchMedia(LG_QUERY).matches || (!!diff && rightSlotFor([], diff, stashesOf(target)) !== 'changes');
  if (inDialog) setDialogOpen(target, true);
  else if (rightSlotFor(getSelection(target).items, diff, stashesOf(target)) !== 'changes') dispatchSelection(target, { type: 'clear' });
  if (opts.focus !== false || inDialog) requestFocus(target, inDialog ? 'dialog' : 'slot');
  if (opts.amend === 'message') void setAmend(target, true);
}

/** A WIP row opened from tab `tab`: another checkout's opens in that checkout's tab first. */
export function openWip(tab: Tab, checkout: Target, opts: { focus?: boolean } = {}): void {
  if (tabKey(checkout) !== tabKey(tab)) dispatchTabs({ type: 'open', tab: checkout });
  openWorkingTree(checkout, opts);
}
