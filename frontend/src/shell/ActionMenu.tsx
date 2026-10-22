import type { ReactNode } from 'react';
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { actionsFor, labelOf, type MenuAction } from './menus';

function items<C>(list: MenuAction<C>[], ctx: C): ReactNode[] {
  const out: ReactNode[] = [];
  list.forEach((a, i) => {
    if (i > 0 && (a.group ?? '') !== (list[i - 1].group ?? '')) out.push(<DropdownMenuSeparator key={`sep:${a.id}`} />);
    const label = labelOf(a, ctx);
    out.push(a.children ? (
      <DropdownMenuSub key={a.id}>
        <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{items(a.children, ctx)}</DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenuItem key={a.id} variant={a.destructive ? 'destructive' : 'default'} onSelect={() => void a.run?.(ctx)}>
        {label}
      </DropdownMenuItem>
    ));
  });
  return out;
}

/** The registered actions for `context`, as items of an open DropdownMenuContent: ordered, grouped, with submenus. */
export function ActionMenuItems<C>({ context, ctx }: { context: string; ctx: C }) {
  return <>{items(actionsFor(context, ctx), ctx)}</>;
}
