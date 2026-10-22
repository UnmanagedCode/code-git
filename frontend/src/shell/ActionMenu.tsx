import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { actionsFor } from './menus';

/** The registered actions for `context`, as items of an open DropdownMenuContent. */
export function ActionMenuItems<C>({ context, ctx }: { context: string; ctx: C }) {
  return (
    <>
      {actionsFor(context, ctx).map((a) => (
        <DropdownMenuItem key={a.id} variant={a.destructive ? 'destructive' : 'default'} onSelect={() => void a.run(ctx)}>
          {a.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}
