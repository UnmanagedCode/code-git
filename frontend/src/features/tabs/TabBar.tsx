import { useState } from 'react';
import { EllipsisVerticalIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ActionMenuItems } from '@/shell/ActionMenu';
import { dispatchTabs, tabKey, useTabs, type Tab } from '@/state/tabs';
import { tabLabel, type TabMenuCtx } from './actions';

function TabItem({ tab, index, count, active }: { tab: Tab; index: number; count: number; active: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const label = tabLabel(tab);
  const ctx: TabMenuCtx = { tab, index, count };
  return (
    <div
      className={cn(
        'group flex shrink-0 items-center gap-0.5 rounded-t-md border border-b-0 pr-1 text-sm',
        active ? 'bg-background text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="max-w-56 truncate py-1.5 pl-3 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={label}
        onClick={() => dispatchTabs({ type: 'activateIndex', index })}
        onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
      >
        {label}
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Actions for ${label}`}>
            <EllipsisVerticalIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <ActionMenuItems context="tab" ctx={ctx} />
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Close ${label}`} onClick={() => dispatchTabs({ type: 'close', index })}>
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

export function TabBar({ onAdd }: { onAdd: () => void }) {
  const { open, active } = useTabs();
  return (
    <div className="flex items-end gap-1 border-b bg-sidebar px-2 pt-1.5">
      <div role="tablist" aria-label="Open repositories" className="flex min-w-0 items-end gap-1 overflow-x-auto">
        {open.map((t, i) => <TabItem key={tabKey(t)} tab={t} index={i} count={open.length} active={i === active} />)}
      </div>
      <Button variant="ghost" size="icon-sm" className="mb-1 size-7 shrink-0" aria-label="Open repository" onClick={onAdd}>
        <PlusIcon />
      </Button>
    </div>
  );
}
