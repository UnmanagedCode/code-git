import { headOf, shortBranch } from '@/features/branches/refInfo';
import type { Command } from '@/shell/commands';
import { openFlowDialog } from '@/state/flowDialog';
import { FLOW_TYPES } from './api';
import { finishHead } from './actions';
import { flowBranchOf, getFlow } from './state';

// The palette's git-flow commands (shell/commands.ts). No title may hold `create br` or `checkout` as a subsequence:
// the palette's tests pin that those queries find one command.

export const FLOW_COMMANDS: Command[] = [
  { id: 'flow.init', title: 'Git-flow: initialize…', group: 'Git-flow', when: (tab) => headOf(tab).oid !== null, run: (tab) => openFlowDialog({ kind: 'init', tab }) },
  ...FLOW_TYPES.map((type): Command => ({
    id: `flow.start.${type}`, title: `Git-flow: start ${type}…`, group: 'Git-flow',
    when: (tab) => !!getFlow(tab)?.initialized, run: (tab) => openFlowDialog({ kind: 'start', tab, type }),
  })),
  { id: 'flow.finish', title: 'Git-flow: finish…', group: 'Git-flow', when: (tab) => finishable(tab), run: (tab) => { finishHead(tab); } },
];

function finishable(tab: Parameters<typeof finishHead>[0]): boolean {
  const { branch } = headOf(tab);
  return branch !== null && flowBranchOf(getFlow(tab), shortBranch(branch)) !== null;
}
