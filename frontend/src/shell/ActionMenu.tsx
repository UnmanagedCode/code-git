import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { actionsFor, labelOf, type ResolvedAction } from './menus';

/** The leading icon column: the action's icon, or a blank as wide, so labels align. A direct child of the item: the
 *  destructive tint (`*:[svg]` in dropdown-menu.tsx) reaches only direct children. */
function lead(Icon: LucideIcon | undefined): ReactNode {
  return Icon
    ? <Icon aria-hidden data-slot="menu-item-icon" />
    : <span aria-hidden data-slot="menu-item-icon" className="size-4 shrink-0" />;
}

function items<C>(list: ResolvedAction<C>[], ctx: C): ReactNode[] {
  const out: ReactNode[] = [];
  list.forEach((a, i) => {
    if (i > 0 && (a.group ?? '') !== (list[i - 1].group ?? '')) out.push(<DropdownMenuSeparator key={`sep:${a.id}`} />);
    const label = labelOf(a, ctx);
    out.push(a.children ? (
      <DropdownMenuSub key={a.id}>
        <DropdownMenuSubTrigger>{lead(a.icon)}{label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{items(a.children, ctx)}</DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenuItem key={a.id} variant={a.destructive ? 'destructive' : 'default'} onSelect={() => void a.run?.(ctx)}>
        {lead(a.icon)}{label}
      </DropdownMenuItem>
    ));
  });
  return out;
}

/** The registered actions for `context`, as items of an open DropdownMenuContent: ordered, grouped, with submenus. */
export function ActionMenuItems<C>({ context, ctx }: { context: string; ctx: C }) {
  return <>{items(actionsFor(context, ctx), ctx)}</>;
}
