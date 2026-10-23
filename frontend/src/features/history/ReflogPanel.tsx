import { EllipsisVerticalIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatTime } from '@/features/graph/time';
import { ActionMenuItems } from '@/shell/ActionMenu';
import { useGraphData } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import { REFLOG_CONTEXT, type ReflogEntryCtx } from './actions';
import { closeHistoryPanel, openReflog } from './open';
import { loadMoreReflog, useReflog } from './state';

// Where HEAD or a branch has been: the reflog, newest first, with a row menu (view, branch from, reset to, copy).

function Row({ tab, entry }: { tab: Tab; entry: ReflogEntryCtx['entry'] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex items-center gap-2 border-b px-3 py-1 text-sm" onContextMenu={(e) => { e.preventDefault(); setOpen(true); }} data-reflog-row={entry.selector}>
      <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{entry.selector}</span>
      <span className="w-48 shrink-0 truncate text-xs" title={entry.action}>{entry.action}</span>
      <span className="font-mono text-xs text-muted-foreground">{entry.oid.slice(0, 7)}</span>
      <span className="min-w-0 flex-1 truncate">{entry.subject}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{entry.time === null ? '—' : formatTime(entry.time)}</span>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Actions for ${entry.selector}`}><EllipsisVerticalIcon /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <ActionMenuItems context={REFLOG_CONTEXT} ctx={{ tab, entry } satisfies ReflogEntryCtx} />
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ReflogPanel({ tab }: { tab: Tab | null }) {
  if (!tab) return null;
  return <ReflogFor tab={tab} />;
}

function ReflogFor({ tab }: { tab: Tab }) {
  const s = useReflog(tab);
  const refs = useGraphData(tab).refs?.refs ?? [];
  const locals = refs.filter((r) => r.kind === 'local');
  if (!s) return <p className="p-4 text-sm text-muted-foreground">No reflog open.</p>;
  const p = s.page;
  return (
    <section aria-label="Reflog" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-1.5">
        <h2 className="text-sm font-semibold">Reflog</h2>
        <select aria-label="Reflog of" className="h-7 rounded-md border bg-background px-1 text-xs" value={s.ref} onChange={(e) => openReflog(tab, e.target.value)}>
          <option value="HEAD">HEAD</option>
          {locals.map((r) => <option key={r.name} value={r.name}>{r.short}</option>)}
          {s.ref !== 'HEAD' && !locals.some((r) => r.name === s.ref) && <option value={s.ref}>{s.ref.replace(/^refs\/heads\//, '')}</option>}
        </select>
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => openReflog(tab, s.ref)}>Reload reflog</Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close reflog" onClick={() => closeHistoryPanel(tab)}><XIcon /></Button>
      </header>
      <ul aria-label="Reflog entries" className="min-h-0 flex-1 overflow-y-auto">
        {p.items.map((e) => <Row key={e.selector} tab={tab} entry={e} />)}
      </ul>
      <div className="flex items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
        {p.loading && <span>Loading…</span>}
        {p.error && <span role="alert" className="text-destructive">{p.error}</span>}
        {!p.loading && p.next !== null && p.items.length > 0 && <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => void loadMoreReflog(tab)}>Load more</Button>}
        {!p.loading && p.next === null && !p.error && <span>{p.items.length ? `${p.items.length} entries` : 'No reflog entries'}</span>}
      </div>
    </section>
  );
}
