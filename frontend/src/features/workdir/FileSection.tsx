import type { KeyboardEvent } from 'react';
import { MinusIcon, PlusIcon, Undo2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DiffFile } from '@/features/diff/api';
import { useOpenDiff } from '@/features/diff/binding';
import { openConflict } from '@/features/conflicts/open';
import { FileList } from '@/features/diff/FileList';
import { openDiff } from '@/features/diff/openDiff';
import { matches } from '@/shell/shortcuts';
import { loadList, setSelection } from '@/state/diff';
import type { Tab } from '@/state/tabs';
import { setDialogOpen } from '@/state/workdir';
import {
  canDiscard, discardAll, discardFile, stageAll, stageFile, stageFilesOf, unstageAll, unstageFile, unstageFilesOf, type Section, type WorkdirFileCtx,
} from './actions';
import { ROW_STAGE_KEY, ROW_UNSTAGE_KEY } from './keys';

const TITLE: Record<Section, string> = { unstaged: 'Unstaged Files', staged: 'Staged Files' };

/**
 * One list of the Changes panel: its header with the bulk actions, and the shared file list (Path or Tree) with each
 * row's Stage / Unstage / Discard and menu; S stages and U unstages the focused row (never while typing in a field). A
 * Tree directory stages or unstages every file of this section beneath it (a folder Stage leaves conflicted files
 * out: staging one marks it resolved). While this section's diff is open, the list drives it (a file the diff's list
 * lacks refetches that list).
 */
export function FileSection({ tab, section, files, busy }: { tab: Tab; section: Section; files: DiffFile[]; busy: boolean }) {
  const diff = useOpenDiff(tab);
  const bound = diff?.source.kind === section ? diff : null;
  const label = `${TITLE[section]} (${files.length})`;
  const open = (sel: string[], file: DiffFile, plain: boolean) => {
    // A plain pick closes the narrow Changes dialog, so the diff it picks is in view.
    if (plain) setDialogOpen(tab, false);
    if (bound) {
      setSelection(tab, sel, file.path);
      // A file this section lists but the diff's loaded list does not (the panel reloaded on its own): refetch the
      // diff's list, which keeps the pick (loadList).
      const listed = bound.list.result?.files;
      if (listed && !listed.some((f) => f.path === file.path)) void loadList(tab);
      return;
    }
    // A conflicted file has no diff to show: it opens in the merge tool.
    if (file.status === 'U') void openConflict(tab, file.path);
    else openDiff(tab, { kind: section }, { path: file.path });
  };
  const onRowKeyDown = (e: KeyboardEvent, file: DiffFile) => {
    if (busy) return;
    if (matches(e, ROW_STAGE_KEY) && section === 'unstaged') { e.preventDefault(); void stageFile(tab, file); }
    if (matches(e, ROW_UNSTAGE_KEY) && section === 'staged') { e.preventDefault(); void unstageFile(tab, file); }
  };
  const actions = (file: DiffFile) => (section === 'unstaged' ? (
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
  ));
  const dirActions = (under: DiffFile[], dir: string) => {
    if (section === 'staged') {
      return (
        <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Unstage folder ${dir}`} disabled={busy} onClick={() => void unstageFilesOf(tab, under)}>
          <MinusIcon className="size-3.5" />
        </Button>
      );
    }
    const stageable = under.filter((f) => f.status !== 'U');
    return stageable.length > 0 && (
      <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Stage folder ${dir}`} disabled={busy} onClick={() => void stageFilesOf(tab, stageable)}>
        <PlusIcon className="size-3.5" />
      </Button>
    );
  };
  return (
    <section aria-label={TITLE[section]} className="flex min-h-0 flex-col border-b">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground uppercase" title={label}>{label}</h3>
        {section === 'unstaged' ? (
          <>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={busy || !files.some(canDiscard)} onClick={() => void discardAll(tab, files)}>Discard all…</Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={busy || !files.length} onClick={() => void stageAll(tab)}>Stage all</Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={busy || !files.length} onClick={() => void unstageAll(tab)}>Unstage all</Button>
        )}
      </div>
      <div data-section-list="" className="min-h-0 flex-1 overflow-y-auto">
        {files.length ? (
          <FileList
            label={label}
            files={files}
            viewed={bound?.viewed ?? null}
            selected={bound?.selected}
            multi={!!bound}
            followFocus={!!bound}
            onSelect={open}
            actions={actions}
            dirActions={dirActions}
            menu={(file) => ({ context: 'workdir-file', ctx: { tab, file, section } satisfies WorkdirFileCtx })}
            onRowKeyDown={onRowKeyDown}
          />
        ) : (
          <p className="px-3 pb-2 text-xs text-muted-foreground">{section === 'unstaged' ? 'No unstaged changes.' : 'Nothing staged.'}</p>
        )}
      </div>
    </section>
  );
}
