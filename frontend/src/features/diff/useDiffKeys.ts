import type { KeyboardEvent } from 'react';

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
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); h.find(); return; }
    if (e.altKey && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      if (e.key === 'ArrowDown') h.nextChange(); else h.prevChange();
      return;
    }
    if (e.key === 'Escape' && !mod && !e.altKey) {
      // An open menu (portalled, but its events bubble through React) closes itself.
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
      e.preventDefault();
      h.escape();
    }
  };
}
