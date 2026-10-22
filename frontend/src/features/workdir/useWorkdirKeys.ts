import { useEffect } from 'react';
import type { Tab } from '@/state/tabs';
import { stageAll, unstageAll } from './actions';
import { openWorkingTree } from './entry';

/**
 * The Changes panel's global keys, while focus is inside the plugin frame: Ctrl/⌘+Shift+S stage all, Ctrl/⌘+Shift+U
 * unstage all, Ctrl/⌘+Shift+M the commit summary. Row keys (S / U) and the commit keys live on their elements.
 */
export function useWorkdirKeys(tab: Tab | null): void {
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); void stageAll(tab); }
      else if (k === 'u') { e.preventDefault(); void unstageAll(tab); }
      else if (k === 'm') { e.preventDefault(); openWorkingTree(tab); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab?.project, tab?.worktree]);
}
