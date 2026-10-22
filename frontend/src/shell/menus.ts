import { TAB_ACTIONS } from '@/features/tabs/actions';

// The context-menu action registry. A feature adds its actions in its own folder and one entry in ACTIONS;
// <ActionMenuItems context="…" ctx={…}> renders the ones for a context.

export interface MenuAction<C = unknown> {
  id: string;
  /** Where the action is offered, e.g. 'tab'; later cards add 'commit', 'branch', 'file', 'branch-drop'. */
  context: string;
  label: string;
  when?: (ctx: C) => boolean;
  run: (ctx: C) => void | Promise<void>;
  destructive?: boolean;
}

const ACTIONS: MenuAction<never>[] = [...TAB_ACTIONS];

export function actionsFor<C>(context: string, ctx: C): MenuAction<C>[] {
  return (ACTIONS as unknown as MenuAction<C>[]).filter((a) => a.context === context && (a.when?.(ctx) ?? true));
}
