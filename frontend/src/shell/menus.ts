import { DIFF_FILE_ACTIONS } from '@/features/diff/actions';
import { GRAPH_ACTIONS } from '@/features/graph/actions';
import { TAB_ACTIONS } from '@/features/tabs/actions';
import { RESTORE_ACTION, WORKDIR_FILE_ACTIONS } from '@/features/workdir/actions';

// The context-menu action registry. A feature adds its actions in its own folder and one entry in ACTIONS;
// <ActionMenuItems context="…" ctx={…}> renders the ones for a context (docs/architecture.md → Extension points).

export interface MenuAction<C = unknown> {
  id: string;
  /** Where the action is offered: 'tab', the graph's contexts (features/graph/contexts.ts), … */
  context: string;
  /** A function to inline names: "Reset main to this commit". */
  label: string | ((ctx: C) => string);
  when?: (ctx: C) => boolean;
  /** Absent when `children` is set. */
  run?: (ctx: C) => void | Promise<void>;
  /** A submenu (Soft / Mixed / Hard); children inherit the context. Hidden when every child is filtered out. */
  children?: MenuAction<C>[];
  /** A separator goes between consecutive actions of different groups. */
  group?: string;
  /** Sort key, default 500; ties keep registration order. Convention in docs/architecture.md. */
  order?: number;
  destructive?: boolean;
}

const ACTIONS: MenuAction<never>[] = [...TAB_ACTIONS, ...DIFF_FILE_ACTIONS, ...GRAPH_ACTIONS, ...WORKDIR_FILE_ACTIONS, RESTORE_ACTION];

/** `list` resolved for one context menu: filtered by `when`, stably sorted by order; submenus resolved too, empty ones dropped. */
export function resolveActions<C>(list: readonly MenuAction<C>[], context: string | null, ctx: C): MenuAction<C>[] {
  return list
    .filter((a) => (context === null || a.context === context) && (a.when?.(ctx) ?? true))
    .map((a) => (a.children ? { ...a, children: resolveActions(a.children, null, ctx) } : a))
    .filter((a) => !a.children || a.children.length > 0)
    .sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
}

export function actionsFor<C>(context: string, ctx: C): MenuAction<C>[] {
  return resolveActions(ACTIONS as unknown as MenuAction<C>[], context, ctx);
}

export const labelOf = <C>(a: MenuAction<C>, ctx: C): string => (typeof a.label === 'function' ? a.label(ctx) : a.label);
