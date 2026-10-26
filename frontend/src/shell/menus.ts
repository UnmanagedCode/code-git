import type { LucideIcon } from 'lucide-react';
import { DIFF_FILE_ACTIONS } from '@/features/diff/actions';
import { GRAPH_ACTIONS } from '@/features/graph/actions';
import { STASH_ACTIONS } from '@/features/stash/actions';
import { TAB_ACTIONS } from '@/features/tabs/actions';
import { RESTORE_ACTION, WORKDIR_FILE_ACTIONS, WORKDIR_GRAPH_ACTIONS } from '@/features/workdir/actions';
import { BRANCH_ACTIONS } from '@/features/branches/actions';
import { REMOTE_ACTIONS } from '@/features/remotes/actions';
import { SEQUENCE_ACTIONS } from '@/features/sequence/actions';
import { CONFLICT_FILE_ACTIONS } from '@/features/conflicts/actions';
import { SUBMODULE_ACTIONS } from '@/features/submodules/actions';
import { HISTORY_ACTIONS } from '@/features/history/actions';
import { FLOW_ACTIONS } from '@/features/flow/actions';
import { LFS_ACTIONS } from '@/features/lfs/actions';
import { LINK_ACTIONS } from '@/features/links/actions';

// The context-menu action registry. A feature adds its actions in its own folder and one entry in ACTIONS;
// <ActionMenuItems context="…" ctx={…}> renders the ones for a context (docs/architecture.md → Extension points).

export interface MenuAction<C = unknown> {
  id: string;
  /** Where the action is offered: 'tab', the graph's contexts (features/graph/contexts.ts), … */
  context: string;
  /** A function to inline names: "Reset main to this commit". */
  label: string | ((ctx: C) => string);
  /** Decorative, in the menu's leading icon column (ActionMenu.tsx); the label stays the accessible name. */
  icon?: LucideIcon;
  when?: (ctx: C) => boolean;
  /** Absent when `children` is set. */
  run?: (ctx: C) => void | Promise<void>;
  /**
   * A submenu (Soft / Mixed / Hard); children inherit the context. A function builds them from the ctx (one per
   * remote). Hidden when every child is filtered out.
   */
  children?: MenuAction<C>[] | ((ctx: C) => MenuAction<C>[]);
  /** A separator goes between consecutive actions of different groups. */
  group?: string;
  /** Sort key, default 500; ties keep registration order. Convention in docs/architecture.md. */
  order?: number;
  destructive?: boolean;
  /** The action a double-click on the context's item runs (runPrimary): Checkout for a branch, Jump for a tag. */
  primary?: boolean;
}

export const ACTIONS: MenuAction<never>[] = [...TAB_ACTIONS, ...DIFF_FILE_ACTIONS, ...GRAPH_ACTIONS, ...WORKDIR_FILE_ACTIONS, RESTORE_ACTION, ...WORKDIR_GRAPH_ACTIONS, ...BRANCH_ACTIONS, ...STASH_ACTIONS, ...REMOTE_ACTIONS, ...SEQUENCE_ACTIONS, ...CONFLICT_FILE_ACTIONS, ...SUBMODULE_ACTIONS as MenuAction<never>[], ...HISTORY_ACTIONS, ...FLOW_ACTIONS, ...LFS_ACTIONS, ...LINK_ACTIONS];

/** An action as a menu shows it: its submenu, if any, built and resolved. */
export type ResolvedAction<C> = Omit<MenuAction<C>, 'children'> & { children?: ResolvedAction<C>[] };

/** `list` resolved for one context menu: filtered by `when`, stably sorted by order; submenus resolved too, empty ones dropped. */
export function resolveActions<C>(list: readonly MenuAction<C>[], context: string | null, ctx: C): ResolvedAction<C>[] {
  return list
    .filter((a) => (context === null || a.context === context) && (a.when?.(ctx) ?? true))
    .map((a): ResolvedAction<C> => {
      if (!a.children) return a as ResolvedAction<C>;
      return { ...a, children: resolveActions(typeof a.children === 'function' ? a.children(ctx) : a.children, null, ctx) };
    })
    .filter((a) => !a.children || a.children.length > 0)
    .sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
}

export function actionsFor<C>(context: string, ctx: C): ResolvedAction<C>[] {
  return resolveActions(ACTIONS as unknown as MenuAction<C>[], context, ctx);
}

export const labelOf = <C>(a: Pick<MenuAction<C>, 'label'>, ctx: C): string => (typeof a.label === 'function' ? a.label(ctx) : a.label);

/** Runs the first primary action offered for `context` (after `when`); false when there is none. */
export function runPrimary<C>(context: string, ctx: C): boolean {
  const a = actionsFor(context, ctx).find((x) => x.primary && x.run);
  if (!a) return false;
  void a.run!(ctx);
  return true;
}
