import type { KeyboardEvent } from 'react';
import { matchCombo, matches } from '@/shell/shortcuts';
import { DIFF_CHANGE_KEY, DIFF_ESCAPE_KEY, DIFF_FIND_KEY } from './keys';

export interface DiffKeyHandlers {
  find: () => void;
  nextChange: () => void;
  prevChange: () => void;
  /** Esc: close the search if open, else the diff. */
  escape: () => void;
}

/** The diff panel's keys, as an onKeyDown for its root: they act only while focus is inside the panel. */
export function useDiffKeys(h: DiffKeyHandlers) {
  return (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (matches(e, DIFF_FIND_KEY)) { e.preventDefault(); h.find(); return; }
    const change = matchCombo(e, DIFF_CHANGE_KEY);
    if (change) {
      e.preventDefault();
      if (change.key === 'ArrowDown') h.nextChange(); else h.prevChange();
      return;
    }
    if (matches(e, DIFF_ESCAPE_KEY)) {
      // An open menu (portalled, but its events bubble through React) closes itself.
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
      e.preventDefault();
      h.escape();
    }
  };
}
