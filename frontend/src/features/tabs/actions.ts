import type { MenuAction } from '@/shell/menus';
import { dispatchTabs, type Tab } from '@/state/tabs';

export interface TabMenuCtx { tab: Tab; index: number; count: number }

export const tabLabel = (t: Tab): string => (t.worktree ? `${t.project}/${t.worktree}` : t.project);

export const TAB_ACTIONS: MenuAction<TabMenuCtx>[] = [
  { id: 'tab.close', context: 'tab', label: 'Close', run: ({ index }) => dispatchTabs({ type: 'close', index }) },
  {
    id: 'tab.closeOthers', context: 'tab', label: 'Close others',
    when: ({ count }) => count > 1, run: ({ index }) => dispatchTabs({ type: 'closeOthers', index }),
  },
  { id: 'tab.copyName', context: 'tab', label: 'Copy name', run: ({ tab }) => navigator.clipboard?.writeText(tabLabel(tab)) },
];
