import type { RefCtx } from '@/features/graph/contexts';
import { headOf, shortBranch } from '@/features/branches/refInfo';
import { REPO_CONTEXT, type RepoCtx } from '@/features/repoMenu/context';
import type { MenuAction } from '@/shell/menus';
import { openFlowDialog } from '@/state/flowDialog';
import type { Tab } from '@/state/tabs';
import { FLOW_TYPES, type FlowType } from './api';
import { flowBranchOf, getFlow } from './state';
import { FlagIcon, GitBranchPlusIcon, Settings2Icon, WorkflowIcon } from 'lucide-react';

// The git-flow menu items (docs/gitflow.md): a "Git-flow" submenu in the repository menu, and Finish on a flow branch's
// menu (order 335: after the history-rewriting items, before Delete).

const TYPE_LABEL: Record<FlowType, string> = { feature: 'feature', release: 'release', hotfix: 'hotfix' };
const initialized = (tab: Tab) => !!getFlow(tab)?.initialized;

/** HEAD's branch when it is a flow branch: what "Finish ‹branch›…" finishes. */
function headFlowBranch(tab: Tab) {
  const { branch, oid } = headOf(tab);
  if (!branch || !oid) return null;
  const short = shortBranch(branch);
  const f = flowBranchOf(getFlow(tab), short);
  return f && { ...f, branch: short, expect: oid };
}

/** Opens the finish dialog for HEAD's flow branch; false when HEAD is not one. */
export function finishHead(tab: Tab): boolean {
  const f = headFlowBranch(tab);
  if (!f) return false;
  openFlowDialog({ kind: 'finish', tab, ...f });
  return true;
}

const branchFlow = (c: RefCtx) => (c.ref.kind === 'local' && c.ref.oid ? flowBranchOf(getFlow(c.tab), c.ref.short) : null);

export const FLOW_ACTIONS: MenuAction<never>[] = [
  {
    id: 'flow.repo', icon: WorkflowIcon, context: REPO_CONTEXT, label: 'Git-flow', group: 'flow', order: 100,
    when: (c: RepoCtx) => headOf(c.tab).oid !== null,
    children: (c: RepoCtx): MenuAction<RepoCtx>[] => {
      const f = headFlowBranch(c.tab);
      return [
        { id: 'flow.repo.init', icon: Settings2Icon, context: REPO_CONTEXT, label: initialized(c.tab) ? 'Git-flow settings…' : 'Initialize…', group: 'init', run: (x) => openFlowDialog({ kind: 'init', tab: x.tab }) },
        ...FLOW_TYPES.map((type): MenuAction<RepoCtx> => ({
          id: `flow.repo.start.${type}`, context: REPO_CONTEXT, icon: GitBranchPlusIcon, label: `Start ${TYPE_LABEL[type]}…`, group: 'start',
          when: (x) => initialized(x.tab), run: (x) => openFlowDialog({ kind: 'start', tab: x.tab, type }),
        })),
        ...(f ? [{ id: 'flow.repo.finish', icon: FlagIcon, context: REPO_CONTEXT, label: `Finish ${f.branch}…`, group: 'finish', destructive: true, run: (x: RepoCtx) => { finishHead(x.tab); } }] : []),
      ];
    },
  },
  {
    id: 'flow.branch.finish', icon: FlagIcon, context: 'branch', group: 'flow', order: 335, destructive: true,
    label: (c: RefCtx) => `Finish ${TYPE_LABEL[branchFlow(c)?.type ?? 'feature']}…`,
    when: (c: RefCtx) => branchFlow(c) !== null,
    run: (c: RefCtx) => {
      const f = branchFlow(c);
      if (f) openFlowDialog({ kind: 'finish', tab: c.tab, ...f, branch: c.ref.short, expect: c.ref.oid! });
    },
  },
];
