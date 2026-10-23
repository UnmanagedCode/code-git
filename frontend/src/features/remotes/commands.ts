import type { Command } from '@/shell/commands';
import { headOf } from '@/features/branches/refInfo';
import { getRemotePrefs } from '@/state/remotePrefs';
import { pushHead } from './pushFlow';
import { fetchFlow, PULL_LABEL, pullFlow } from './run';

// The palette's remote commands (shell/commands.ts): the same flows as the graph toolbar's Fetch, Pull and Push.

export const REMOTE_COMMANDS: Command[] = [
  { id: 'remotes.fetch', title: 'Fetch all remotes', group: 'Remotes', run: (tab) => fetchFlow(tab, null) },
  { id: 'remotes.pull', title: 'Pull', group: 'Remotes', when: (tab) => !!headOf(tab).branch, run: (tab) => pullFlow(tab, getRemotePrefs(tab.project).pullMode) },
  ...(['ff', 'ffOnly', 'rebase'] as const).map((mode): Command => ({
    id: `remotes.pull.${mode}`, title: PULL_LABEL[mode], group: 'Remotes', when: (tab) => !!headOf(tab).branch, run: (tab) => pullFlow(tab, mode),
  })),
  { id: 'remotes.push', title: 'Push', group: 'Remotes', when: (tab) => !!headOf(tab).branch && !!headOf(tab).oid, run: (tab) => pushHead(tab) },
];
