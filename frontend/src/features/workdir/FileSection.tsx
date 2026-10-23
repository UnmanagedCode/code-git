import { useState, type KeyboardEvent } from 'react';
import { EllipsisVerticalIcon, MinusIcon, PlusIcon, Undo2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { DiffFile } from '@/features/diff/api';
import { openConflict } from '@/features/conflicts/open';
import { fileLabel, STATUS_LABEL } from '@/features/diff/FileList';
import { openDiff } from '@/features/diff/openDiff';
import { clip, FILE_RENDER_CAP } from '@/lib/clip';
import { isTextEntry } from '@/lib/textEntry';
import { cn } from '@/lib/utils';
import { ActionMenuItems } from '@/shell/ActionMenu';
import type { Tab } from '@/state/tabs';
import { setDialogOpen } from '@/state/workdir';
import { canDiscard, discardAll, discardFile, stageAll, stageFile, unstageAll, unstageFile, type Section, type WorkdirFileCtx } from './actions';
import { matchCombo, matches } from '@/shell/shortcuts';
import { ROW_MOVE_KEY, ROW_OPEN_KEY, ROW_STAGE_KEY, ROW_UNSTAGE_KEY } from './keys';

const STATUS_CLASS: Record<string, string | undefined> = { A: 'text-success', '?': 'text-success', D: 'text-destructive', U: 'text-destructive', R: 'text-info', C: 'text-info' };
const TITLE: Record<Section, string> = { unstaged: 'Unstaged Files', staged: 'Staged Files' };

function Row({ tab, file, section, busy }: { tab: Tab; file: DiffFile; section: Section; busy: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ctx: WorkdirFileCtx = { tab, file, section };
  const open = () => {
    setDialogOpen(tab, false);
    // A conflicted file has no diff to show: it opens in the merge tool.
    if (file.status === 'U') void openConflict(tab, file.path);
    else openDiff(tab, { kind: section }, { path: file.path });
  };
  return (
    <li
      role="option"
      aria-selected={false}
      tabIndex={0}
      data-path={file.path}
      className="group flex cursor-default items-center gap-2 px-2 py-0.5 text-xs outline-none hover:bg-accent/50 focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
      onClick={open}
      onKeyDown={(e) => { if (matches(e, ROW_OPEN_KEY)) { e.preventDefault(); open(); } }}
      onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
    >
      <span className={cn('w-3 shrink-0 text-center font-mono font-semibold', STATUS_CLASS[file.status])} aria-label={STATUS_LABEL[file.status]} title={STATUS_LABEL[file.status]}>
        {file.status}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono" title={clip(fileLabel(file))}>{clip(fileLabel(file))}</span>
      <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100">
        {section === 'unstaged' ? (
          <>
            {canDiscard(file) && (
              <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Discard ${file.path}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void discardFile(tab, file); }}>
                <Undo2Icon className="size-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Stage ${file.path}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void stageFile(tab, file); }}>
              <PlusIcon className="size-3.5" />
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Unstage ${file.path}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void unstageFile(tab, file); }}>
            <MinusIcon className="size-3.5" />
          </Button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Actions for ${file.path}`} onClick={(e) => e.stopPropagation()}>
              <EllipsisVerticalIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <ActionMenuItems context="workdir-file" ctx={ctx} />
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  );
}

/**
 * One list of the Changes panel: its header with the bulk actions, and a row per file. ↑/↓ move between rows; S stages
 * and U unstages the focused row (never while typing in a field).
 */
export function FileSection({ tab, section, files, busy }: { tab: Tab; section: Section; files: DiffFile[]; busy: boolean }) {
  // The first FILE_RENDER_CAP rows until "Show all N": a huge working tree does not mount every row at once.
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, FILE_RENDER_CAP);
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (isTextEntry(e.target as Element)) return;
    const row = (e.target as Element).closest('li[role="option"]');
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('li[role="option"]')];
    const i = row ? rows.indexOf(row as HTMLElement) : -1;
    const moveBy = matchCombo(e, ROW_MOVE_KEY);
    if (moveBy) {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (moveBy.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      return;
    }
    const file = i === -1 ? undefined : shown[i];
    if (!file || busy) return;
    if (matches(e, ROW_STAGE_KEY) && section === 'unstaged') { e.preventDefault(); void stageFile(tab, file); }
    if (matches(e, ROW_UNSTAGE_KEY) && section === 'staged') { e.preventDefault(); void unstageFile(tab, file); }
  };
  const label = `${TITLE[section]} (${files.length})`;
  return (
    <section aria-label={TITLE[section]} className="border-b">
      <div className="flex flex-wrap items-center gap-x-1 px-2 py-1">
        <h3 className="flex-1 text-xs font-semibold whitespace-nowrap text-muted-foreground uppercase">{label}</h3>
        {section === 'unstaged' ? (
          <>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={busy || !files.some(canDiscard)} onClick={() => void discardAll(tab, files)}>Discard all…</Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={busy || !files.length} onClick={() => void stageAll(tab)}>Stage all</Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={busy || !files.length} onClick={() => void unstageAll(tab)}>Unstage all</Button>
        )}
      </div>
      {files.length ? (
        <>
          <ul role="listbox" aria-label={label} className="pb-1" onKeyDown={onKeyDown}>
            {shown.map((f) => <Row key={`${f.oldPath ?? ''}\0${f.path}`} tab={tab} file={f} section={section} busy={busy} />)}
          </ul>
          {shown.length < files.length && (
            <Button variant="ghost" size="sm" className="mb-1 ml-2 h-6 px-2 text-xs" onClick={() => setAll(true)}>Show all {files.length}</Button>
          )}
        </>
      ) : (
        <p className="px-3 pb-2 text-xs text-muted-foreground">{section === 'unstaged' ? 'No unstaged changes.' : 'Nothing staged.'}</p>
      )}
    </section>
  );
}
