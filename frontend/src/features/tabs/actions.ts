import type { MenuAction } from '@/shell/menus';
import { dispatchTabs, parentTab, tabKey, tabsStore, type Tab } from '@/state/tabs';
import { CopyIcon, CopyXIcon, XIcon } from 'lucide-react';

export interface TabMenuCtx { tab: Tab; index: number; count: number }

/** `project` or `project/worktree`, then ` › path` per submodule of the chain. */
export const tabLabel = (t: Tab): string => [t.worktree ? `${t.project}/${t.worktree}` : t.project, ...(t.sub ?? [])].join(' › ');

/** A submodule tab's way out: its parent repo's tab opened (or activated), then this one closed. */
export function backToParent(t: Tab): void {
  const key = tabKey(t);
  dispatchTabs({ type: 'open', tab: parentTab(t) });
  const index = tabsStore.get().open.findIndex((x) => tabKey(x) === key);
  if (index !== -1) dispatchTabs({ type: 'close', index });
}

export const TAB_ACTIONS: MenuAction<TabMenuCtx>[] = [
  { id: 'tab.close', icon: XIcon, context: 'tab', label: 'Close', run: ({ index }) => dispatchTabs({ type: 'close', index }) },
  {
    id: 'tab.closeOthers', icon: CopyXIcon, context: 'tab', label: 'Close others',
    when: ({ count }) => count > 1, run: ({ index }) => dispatchTabs({ type: 'closeOthers', index }),
  },
  { id: 'tab.copyName', icon: CopyIcon, context: 'tab', label: 'Copy name', run: ({ tab }) => navigator.clipboard?.writeText(tabLabel(tab)) },
];
