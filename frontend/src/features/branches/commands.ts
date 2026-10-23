import type { Command } from '@/shell/commands';
import { getGraph } from '@/state/graph';
import { openRefDialog } from '@/state/refDialog';
import { checkout } from './actions';
import { CREATE_BRANCH_KEY } from './keys';
import { headOf, refNamed } from './refInfo';

// The palette's branch commands (shell/commands.ts).

const born = (tab: Parameters<typeof headOf>[0]) => headOf(tab).oid !== null;

export const BRANCH_COMMANDS: Command[] = [
  {
    id: 'branches.create', title: 'Create branch…', group: 'Branches', shortcut: CREATE_BRANCH_KEY, when: born,
    run: (tab) => openRefDialog({ kind: 'createBranch', tab, from: null }),
  },
  {
    id: 'branches.checkout', title: 'Checkout branch…', group: 'Branches', when: (tab) => !!getGraph(tab).refs,
    pick: {
      placeholder: 'Branch to check out',
      // Local branches but HEAD's, then remote branches (not a remote's HEAD alias).
      items: (tab) => (getGraph(tab).refs?.refs ?? [])
        .filter((r) => (r.kind === 'local' && r.name !== headOf(tab).branch) || (r.kind === 'remote' && !r.name.endsWith('/HEAD')))
        .map((r) => ({ id: r.name, label: r.short, detail: r.kind === 'remote' ? 'remote' : undefined })),
      run: (tab, item) => { const r = refNamed(tab, item.id); if (r) checkout(tab, r); },
    },
  },
];
