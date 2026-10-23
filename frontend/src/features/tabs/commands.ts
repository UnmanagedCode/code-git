import type { Command } from '@/shell/commands';
import { dispatchTabs, tabKey, tabsStore } from '@/state/tabs';
import { tabLabel } from './actions';

// The palette's tab commands (shell/commands.ts).

const indexOf = (key: string) => tabsStore.get().open.findIndex((t) => tabKey(t) === key);

export const TAB_COMMANDS: Command[] = [
  {
    id: 'tabs.goto', title: 'Go to tab…', group: 'Tabs', when: () => tabsStore.get().open.length > 1,
    pick: {
      placeholder: 'Tab',
      items: () => tabsStore.get().open.map((t) => ({ id: tabKey(t), label: tabLabel(t) })),
      run: (_tab, item) => { const i = indexOf(item.id); if (i !== -1) dispatchTabs({ type: 'activateIndex', index: i }); },
    },
  },
  { id: 'tabs.close', title: 'Close tab', group: 'Tabs', run: (tab) => { const i = indexOf(tabKey(tab)); if (i !== -1) dispatchTabs({ type: 'close', index: i }); } },
];
