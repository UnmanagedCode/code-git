import { EllipsisVerticalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { refreshFlow, useFlowLoader } from '@/features/flow/state';
import { ActionMenuItems } from '@/shell/ActionMenu';
import { useGraphData } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import { REPO_CONTEXT, type RepoCtx } from './context';

/**
 * The graph toolbar's "Repository actions" menu: the actions registered under the `repo` context (git-flow, LFS). It
 * keeps the git-flow settings loaded for the tab, which the branch menus read too.
 */
export function RepoMenuButton({ tab }: { tab: Tab }) {
  useFlowLoader(tab);
  // Re-rendered with the graph's refs, so `when` filters see the current HEAD.
  useGraphData(tab);
  const ctx: RepoCtx = { tab };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void refreshFlow(tab); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Repository actions"><EllipsisVerticalIcon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ActionMenuItems context={REPO_CONTEXT} ctx={ctx} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
