import { useState, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, WrapTextIcon, PaletteIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CONTEXT_CHOICES, setPrefs, type DiffPrefs, type FileState } from '@/state/diff';
import type { DiffFile, FileDiff } from './api';
import type { Marks, StagingView } from './CodeLine';
import { DiffRows } from './DiffRows';
import { DiffToggles, Seg } from './DiffToggles';
import { fileLabel, STATUS_LABEL } from './FileList';
import { layoutFor, type ViewRow } from './viewRows';

const Note = ({ children }: { children: ReactNode }) => <div className="flex flex-col items-start gap-2 p-4 text-sm text-muted-foreground">{children}</div>;
const short = (oid: string | null) => (oid ? oid.slice(0, 7) : '—');
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export interface FileViewProps {
  file: DiffFile;
  state: FileState | undefined;
  forced: boolean;
  prefs: DiffPrefs;
  rows: ViewRow[];
  marks: Marks;
  changeCount: number;
  changeIndex: number;
  onChange: (k: number) => void;
  onFile: (delta: 1 | -1) => void;
  canPrevFile: boolean;
  canNextFile: boolean;
  onForce: () => void;
  search: ReactNode;
  /** Hunk and line staging (an unstaged or staged diff of a modified file): the views' toggles and hunk buttons. */
  staging?: StagingView;
  /** Shown above the body: the line-selection actions. */
  selectionBar?: ReactNode;
  /** A working-tree conflict: opens it in the merge tool (absent for a commit's diff). */
  onOpenConflict?: () => void;
}

function Body({ file, state, forced, prefs, rows, marks, onForce, staging, onOpenConflict }: FileViewProps) {
  const [showPointer, setShowPointer] = useState(false);
  if (file.oversized && !forced) {
    return (
      <Note>
        <p>Large diff ({(file.added ?? 0) + (file.deleted ?? 0)} changed lines)</p>
        <Button variant="outline" size="sm" onClick={onForce}>Show anyway</Button>
      </Note>
    );
  }
  if (file.binary) return <Note><p>Binary file — not shown</p></Note>;
  if (file.status === 'U' || state?.diff?.unmerged) {
    return (
      <Note>
        <p>Conflicted file — resolve it first</p>
        {onOpenConflict && <Button variant="outline" size="sm" onClick={onOpenConflict}>Open in merge tool</Button>}
      </Note>
    );
  }
  if (!state || state.loading) return <Note><p>Loading…</p></Note>;
  if (state.error) {
    if (state.error.code === 'OUTPUT_TOO_LARGE') {
      return (
        <Note>
          <p role="alert">Too large to display{state.error.limitBytes ? ` (over ${mb(state.error.limitBytes)})` : ''}</p>
          {(prefs.scope !== 'hunk' || prefs.view !== 'diff') && (
            <Button variant="outline" size="sm" onClick={() => setPrefs({ scope: 'hunk', view: 'diff' })}>Switch to Hunk</Button>
          )}
        </Note>
      );
    }
    return <Note><p role="alert" className="text-destructive">{state.error.message}</p></Note>;
  }
  const d = state.diff as FileDiff;
  if (d.submodule) {
    return (
      <Note>
        <p className="flex items-center gap-2">
          Submodule pointer <span className="font-mono text-foreground">{short(d.submodule.old)} → {short(d.submodule.new)}</span>
          {d.submodule.dirty && <Badge variant="warning">dirty</Badge>}
        </p>
      </Note>
    );
  }
  if (d.binary) return <Note><p>Binary file — not shown</p></Note>;
  const view = <DiffRows rows={rows} layout={layoutFor(prefs)} marks={marks} wrap={prefs.wrap} staging={staging} />;
  if (d.lfs) {
    const side = (label: string, p: { oid: string; size: number } | null) => (
      <div className="flex gap-2"><span className="w-10 text-muted-foreground">{label}</span>{p ? <span className="font-mono text-foreground">{p.oid.slice(0, 12)} · {p.size} bytes</span> : <span>—</span>}</div>
    );
    return (
      <div>
        <div className="m-3 flex flex-col gap-1 rounded-md border bg-card p-3 text-sm" aria-label="Git LFS pointer">
          <p className="font-medium">Git LFS object</p>
          {side('old', d.lfs.old)}
          {side('new', d.lfs.new)}
          <Button variant="ghost" size="sm" className="mt-1 h-7 w-fit text-xs" aria-pressed={showPointer} onClick={() => setShowPointer(!showPointer)}>Show pointer</Button>
        </div>
        {showPointer && view}
      </div>
    );
  }
  if (!d.hunks.length) {
    // An absent side's mode is null: an empty file added or deleted has no hunks but is a real change.
    if (!d.oldMode && d.newMode) return <Note><p>Empty file added</p></Note>;
    if (d.oldMode && !d.newMode) return <Note><p>Empty file deleted</p></Note>;
    const mode = d.oldMode && d.newMode && d.oldMode !== d.newMode ? `mode ${d.oldMode} → ${d.newMode}` : null;
    const ren = file.oldPath ? `renamed from ${file.oldPath}${file.similarity !== null ? ` (${file.similarity}% similar)` : ''}` : null;
    return <Note><p>No content changes</p>{mode && <p className="font-mono">{mode}</p>}{ren && <p className="font-mono">{ren}</p>}</Note>;
  }
  return view;
}

/** The viewed file: its toolbar, the search bar when open, and its body for the file's state. */
export function FileView(props: FileViewProps) {
  const { prefs, changeCount, changeIndex, onChange, onFile, canPrevFile, canNextFile, search } = props;
  const inDiff = prefs.view === 'diff';
  const { file } = props;
  const modeChange = file.oldMode && file.newMode && file.oldMode !== file.newMode ? `mode ${file.oldMode} → ${file.newMode}` : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
      <div className="flex min-w-0 items-center gap-2 border-b px-3 py-1 text-xs" aria-label="Viewed file">
        <span className="min-w-0 truncate font-mono font-medium" title={fileLabel(file)}>{fileLabel(file)}</span>
        <span className="shrink-0 text-muted-foreground">{STATUS_LABEL[file.status]}{file.similarity !== null ? `, ${file.similarity}% similar` : ''}</span>
        {modeChange && <span className="shrink-0 font-mono text-muted-foreground">{modeChange}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1" role="toolbar" aria-label="Diff options">
        <DiffToggles prefs={prefs} disabled={!inDiff} />
        <Seg label="View" value={prefs.view} options={[{ value: 'diff', label: 'Diff' }, { value: 'file', label: 'File' }]} onPick={(view) => setPrefs({ view })} />
        <select aria-label="Context lines" className="h-7 rounded-md border bg-background px-1 text-xs disabled:opacity-50" value={prefs.context} disabled={!inDiff || prefs.scope !== 'hunk'} onChange={(e) => setPrefs({ context: Number(e.target.value) })}>
          {CONTEXT_CHOICES.map((c) => <option key={c} value={c}>{c} lines of context</option>)}
        </select>
        <Button variant={prefs.wrap ? 'secondary' : 'ghost'} size="icon-sm" className="size-7" aria-label="Wrap lines" aria-pressed={prefs.wrap} onClick={() => setPrefs({ wrap: !prefs.wrap })}><WrapTextIcon /></Button>
        <Button variant={prefs.syntax ? 'secondary' : 'ghost'} size="icon-sm" className="size-7" aria-label="Syntax highlighting" aria-pressed={prefs.syntax} onClick={() => setPrefs({ syntax: !prefs.syntax })}><PaletteIcon /></Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Previous change" disabled={!inDiff || changeIndex <= 0} onClick={() => onChange(changeIndex - 1)}><ArrowUpIcon /></Button>
          <span className={cn('text-xs text-muted-foreground', !inDiff && 'invisible')} aria-label="Change position">{changeCount ? `change ${changeIndex + 1} of ${changeCount}` : 'no changes'}</span>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Next change" disabled={!inDiff || changeIndex >= changeCount - 1} onClick={() => onChange(changeIndex + 1)}><ArrowDownIcon /></Button>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Previous file" disabled={!canPrevFile} onClick={() => onFile(-1)}><ArrowLeftIcon /></Button>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Next file" disabled={!canNextFile} onClick={() => onFile(1)}><ArrowRightIcon /></Button>
        </div>
      </div>
      {search}
      {props.selectionBar}
      <div className="min-h-72 flex-1 overflow-auto md:min-h-0" data-diff-body="">
        <Body key={props.file.path} {...props} />
      </div>
    </div>
  );
}
