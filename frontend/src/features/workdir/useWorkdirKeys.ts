import { useEffect } from 'react';
import { matches } from '@/shell/shortcuts';
import { tabKey, type Tab } from '@/state/tabs';
import { stageAll, unstageAll } from './actions';
import { openWorkingTree } from './entry';
import { FOCUS_COMMIT_KEY, STAGE_ALL_KEY, UNSTAGE_ALL_KEY } from './keys';

/**
 * The Changes panel's global keys, while focus is inside the plugin frame: Ctrl/⌘+Shift+S stage all, Ctrl/⌘+Shift+U
 * unstage all, Ctrl/⌘+Shift+M the commit summary. Row keys (S / U) and the commit keys live on their elements.
 */
export function useWorkdirKeys(tab: Tab | null): void {
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (matches(e, STAGE_ALL_KEY)) { e.preventDefault(); void stageAll(tab); }
      else if (matches(e, UNSTAGE_ALL_KEY)) { e.preventDefault(); void unstageAll(tab); }
      else if (matches(e, FOCUS_COMMIT_KEY)) { e.preventDefault(); openWorkingTree(tab); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab && tabKey(tab)]);
}
