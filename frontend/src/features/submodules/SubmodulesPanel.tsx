import { useState, type MouseEvent } from 'react';
import { DownloadIcon, FolderGit2Icon, MoreVerticalIcon, PlusIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { clip } from '@/lib/clip';
import { LG_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { ContextMenuHost, openContextMenu } from '@/shell/ContextMenuHost';
import { runPrimary } from '@/shell/menus';
import { openSubmoduleDialog } from '@/state/submoduleDialog';
import type { Tab } from '@/state/tabs';
import { SUBMODULE_CONTEXT, update, type SubmoduleCtx } from './actions';
import type { SubmoduleEntry } from './api';
import { useSubmodules } from './state';

const HOST = 'submodules';
const short = (oid: string | null) => oid?.slice(0, 7) ?? '';

type Variant = 'warning' | 'info' | 'destructive' | 'outline';
/** The status badges of an entry, in the order shown; each one's text is its accessible name. */
export function statusBadges(e: SubmoduleEntry): { label: string; variant: Variant; title?: string }[] {
  const out: { label: string; variant: Variant; title?: string }[] = [];
  if (e.blocked) out.push({ label: 'Blocked', variant: 'destructive', title: { name: 'Its .gitmodules name is not a safe name', path: 'Its .gitmodules path is not safe, or another entry declares it', escapes: 'Its directory resolves outside the checkout' }[e.blocked] });
  if (!e.initialized) out.push({ label: 'Uninitialised', variant: 'outline' });
  else if (!e.populated) out.push({ label: 'Not cloned', variant: 'outline' });
  if (e.outOfSync) out.push({ label: 'Out of sync', variant: 'warning', title: `Checked out ${short(e.head)}, recorded ${short(e.recorded)}` });
  if (e.modified) out.push({ label: 'Modified', variant: 'warning' });
  if (e.untracked) out.push({ label: 'Untracked', variant: 'info' });
  if (e.added) out.push({ label: 'Added', variant: 'info' });
  if (e.conflicted) out.push({ label: 'Conflicted', variant: 'destructive' });
  if (e.urlProblem) out.push({ label: 'URL refused', variant: 'destructive', title: e.urlProblem });
  return out;
}

function Row({ tab, entry }: { tab: Tab; entry: SubmoduleEntry }) {
  const ctx: SubmoduleCtx = { tab, entry };
  const menuAt = (at: { x: number; y: number }) => openContextMenu({ host: HOST, context: SUBMODULE_CONTEXT, ctx, at });
  const onMenu = (e: MouseEvent) => { e.preventDefault(); menuAt({ x: e.clientX, y: e.clientY }); };
  const badges = statusBadges(entry);
  return (
    <li className="flex flex-col gap-0.5 px-2 py-1" onContextMenu={onMenu}>
      <div className="flex items-center gap-1">
        <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" title={clip(entry.path)} onDoubleClick={() => runPrimary(SUBMODULE_CONTEXT, ctx)}>
          {clip(entry.path)}
        </button>
        <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Actions for ${clip(entry.path)}`}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menuAt({ x: r.left, y: r.bottom }); }}>
          <MoreVerticalIcon />
        </Button>
      </div>
      {badges.length > 0 && (
        <ul className="flex flex-wrap gap-1 pl-5" aria-label={`Status of ${clip(entry.path)}`}>
          {badges.map((b) => <li key={b.label}><Badge variant={b.variant} title={b.title}>{b.label}</Badge></li>)}
        </ul>
      )}
      {(entry.head || entry.recorded) && (
        <p className="pl-5 font-mono text-xs text-muted-foreground">
          {entry.head && <span aria-label="Checked out">{short(entry.head)}</span>}
          {entry.recorded && entry.recorded !== entry.head && <span aria-label="Recorded"> → {short(entry.recorded)}</span>}
        </p>
      )}
    </li>
  );
}

function SubmodulesView({ tab }: { tab: Tab }) {
  const s = useSubmodules(tab);
  const list = s.list?.submodules ?? [];
  const usable = list.filter((e) => !e.blocked).map((e) => e.path);
  return (
    <section className="flex flex-col border-b pb-2 text-sm" aria-label="Submodules">
      <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
        <h2 className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Submodules ({list.length})</h2>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={() => openSubmoduleDialog({ kind: 'add', tab })}>
          <PlusIcon />Add…
        </Button>
        {usable.length > 0 && (
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={() => void update(tab, usable)}>
            <DownloadIcon />Update all
          </Button>
        )}
      </div>
      {!s.list && s.status !== 'error' && <p className="px-3 py-1 text-muted-foreground">Loading submodules…</p>}
      {s.error && <p className="px-3 py-1 text-destructive" role="alert">{s.error}</p>}
      {s.list && !list.length && <p className="px-3 py-1 text-muted-foreground">No submodules</p>}
      {list.length > 0 && <ul aria-label="Submodule list">{list.map((e) => <Row key={e.path} tab={tab} entry={e} />)}</ul>}
      {s.list?.truncated && <p className="px-3 py-1 text-xs text-muted-foreground">Only the first {list.length} are listed.</p>}
      <ContextMenuHost host={HOST} />
    </section>
  );
}

/** The left slot's Submodules panel (wide screens), or its content inside the narrow screens' dialog. */
export function SubmodulesPanel({ tab, inDialog = false }: { tab: Tab | null; inDialog?: boolean }) {
  const wide = useMediaQuery(LG_QUERY);
  if (!tab || (!inDialog && !wide)) return null;
  return <SubmodulesView tab={tab} />;
}

/** Below `lg`, where the left slot is hidden: the graph toolbar's button opening the panel in a dialog. */
export function SubmodulesButton({ tab }: { tab: Tab }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 gap-1 px-2" onClick={() => setOpen(true)}>
        <FolderGit2Icon /> Submodules
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] p-0">
          <DialogTitle className="px-4 pt-4">Submodules</DialogTitle>
          <DialogDescription className="sr-only">This repository's submodules</DialogDescription>
          <div className="max-h-[70dvh] overflow-y-auto"><SubmodulesPanel tab={tab} inDialog /></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
