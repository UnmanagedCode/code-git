import { useEffect, useState } from 'react';
import { ArchiveIcon, EllipsisVerticalIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FileViewToggle } from '@/features/diff/FileList';
import { OperationBanner } from '@/features/sequence/OperationBanner';
import { openStashSave } from '@/features/stash/actions';
import { useStore } from '@/state/store';
import { tabKey, type Tab } from '@/state/tabs';
import { useRepoSummary } from '@/state/useRepoSummary';
import { clearOpError, ensureWorkdir, refreshWorkdir, setDialogOpen, workdirOf, workdirStore } from '@/state/workdir';
import { ApplyPatchDialog } from './ApplyPatchDialog';
import { CommitBox } from './CommitBox';
import { DetachedBanner } from './DetachedBanner';
import { FileSection } from './FileSection';

/** The Changes content: detached and operation banners, unstaged and staged lists, the last op's error, the commit box. */
export function WorkdirContent({ tab, instance }: { tab: Tab; instance: 'slot' | 'dialog' }) {
  useStore(workdirStore);
  const state = workdirOf(tab);
  const { summary } = useRepoSummary(tab);
  const [applyOpen, setApplyOpen] = useState(false);
  // Only a checkout whose summary loaded is a repository worth listing (a failed summary already says why).
  const ready = !!summary;
  useEffect(() => { if (ready) void ensureWorkdir(tab); }, [tabKey(tab), ready]);
  if (!ready) return null;
  const changed = !!state.unstaged?.files.length || !!state.staged?.files.length;
  return (
    <div className="flex h-full min-h-0 flex-col text-sm" aria-busy={state.busy || state.loading}>
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        <h2 className="flex-1 text-sm font-semibold">Changes</h2>
        <FileViewToggle />
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Stash changes…" disabled={!changed || state.busy} onClick={() => openStashSave(tab, { mode: 'all' })}>
          <ArchiveIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Reload changes" disabled={state.loading} onClick={() => void refreshWorkdir(tab)}>
          <RefreshCwIcon className={state.loading ? 'animate-spin' : undefined} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Changes menu"><EllipsisVerticalIcon /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void refreshWorkdir(tab)}>Refresh</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setApplyOpen(true)}>Apply patch…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {instance === 'dialog' && (
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Close" onClick={() => setDialogOpen(tab, false)}><XIcon /></Button>
        )}
      </div>
      {/* A rebase detaches HEAD for its whole run: the operation banner says what is going on instead. */}
      {state.operation?.kind !== 'rebase' && <div className="shrink-0"><DetachedBanner summary={summary} /></div>}
      <div className="shrink-0"><OperationBanner tab={tab} state={state} /></div>
      {state.error && <p role="alert" className="shrink-0 px-3 py-2 text-xs break-words text-destructive">{state.error}</p>}
      {state.opError && (
        <div role="alert" className="flex shrink-0 items-start gap-1 border-b px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="break-words text-destructive">{state.opError.message}</p>
            {state.opError.stderr && <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap">{state.opError.stderr}</pre>}
          </div>
          <Button variant="ghost" size="icon-sm" className="size-5" aria-label="Dismiss error" onClick={() => clearOpError(tab)}><XIcon className="size-3.5" /></Button>
        </div>
      )}
      {/* Two tracks sized minmax(0, auto): grid's maximize-tracks step shares the free space equally and freezes a track
          at its content height, so a short section fits and two long ones split evenly; content-start leaves the spare
          room above the commit box. min-h-44 is the floor: two sections x (header + two rows). */}
      <div className="grid min-h-44 flex-1 grid-rows-[minmax(0,auto)_minmax(0,auto)] content-start">
        {!state.unstaged || !state.staged ? (
          !state.error && <p className="px-3 py-2 text-xs text-muted-foreground">Loading changes…</p>
        ) : (
          <>
            <FileSection tab={tab} section="unstaged" files={state.unstaged.files} busy={state.busy} />
            <FileSection tab={tab} section="staged" files={state.staged.files} busy={state.busy} />
          </>
        )}
      </div>
      <CommitBox tab={tab} state={state} summary={summary} instance={instance} />
      <ApplyPatchDialog tab={tab} open={applyOpen} onOpenChange={setApplyOpen} />
    </div>
  );
}
