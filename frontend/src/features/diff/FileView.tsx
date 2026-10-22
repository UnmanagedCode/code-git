import { useState, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, WrapTextIcon, PaletteIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setPrefs, type DiffMode, type DiffPrefs, type FileState } from '@/state/diff';
import type { DiffFile, FileDiff, Whitespace } from './api';
import type { Marks } from './CodeLine';
import { FileContentView } from './FileContentView';
import { SplitView } from './SplitView';
import { UnifiedView } from './UnifiedView';
import type { ViewRow } from './viewRows';

export const CONTEXT_CHOICES = [0, 1, 3, 5, 10, 25];
const WHITESPACE: { value: Whitespace; label: string }[] = [
  { value: 'none', label: 'Show all whitespace' }, { value: 'eol', label: 'Ignore at line end' },
  { value: 'change', label: 'Ignore amount' }, { value: 'all', label: 'Ignore all whitespace' },
];
const MODES: { value: DiffMode; label: string }[] = [{ value: 'hunk', label: 'Hunk' }, { value: 'inline', label: 'Inline' }, { value: 'split', label: 'Split' }];

function Seg<V extends string>({ label, value, options, onPick, disabled }: { label: string; value: V; options: { value: V; label: string }[]; onPick: (v: V) => void; disabled?: boolean }) {
  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <Button key={o.value} variant={value === o.value ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={value === o.value} disabled={disabled} onClick={() => onPick(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

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
}

function Body({ file, state, forced, prefs, rows, marks, onForce }: FileViewProps) {
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
  if (file.status === 'U' || state?.diff?.unmerged) return <Note><p>Conflicted file — resolve it first</p></Note>;
  if (!state || state.loading) return <Note><p>Loading…</p></Note>;
  if (state.error) {
    if (state.error.code === 'OUTPUT_TOO_LARGE') {
      return (
        <Note>
          <p role="alert">Too large to display{state.error.limitBytes ? ` (over ${mb(state.error.limitBytes)})` : ''}</p>
          {(prefs.mode !== 'hunk' || prefs.view !== 'diff') && (
            <Button variant="outline" size="sm" onClick={() => setPrefs({ mode: 'hunk', view: 'diff' })}>Switch to Hunk mode</Button>
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
  const view = prefs.view === 'file'
    ? <FileContentView rows={rows} marks={marks} wrap={prefs.wrap} />
    : prefs.mode === 'split' ? <SplitView rows={rows} marks={marks} wrap={prefs.wrap} /> : <UnifiedView rows={rows} marks={marks} wrap={prefs.wrap} />;
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
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1" role="toolbar" aria-label="Diff options">
        <Seg label="Diff mode" value={prefs.mode} options={MODES} onPick={(mode) => setPrefs({ mode })} disabled={!inDiff} />
        <Seg label="View" value={prefs.view} options={[{ value: 'diff', label: 'Diff' }, { value: 'file', label: 'File' }]} onPick={(view) => setPrefs({ view })} />
        <select aria-label="Whitespace" className="h-7 rounded-md border bg-background px-1 text-xs" value={prefs.whitespace} onChange={(e) => setPrefs({ whitespace: e.target.value as Whitespace })}>
          {WHITESPACE.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
        </select>
        <select aria-label="Context lines" className="h-7 rounded-md border bg-background px-1 text-xs disabled:opacity-50" value={prefs.context} disabled={!inDiff || prefs.mode !== 'hunk'} onChange={(e) => setPrefs({ context: Number(e.target.value) })}>
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
      <div className="min-h-0 flex-1 overflow-auto" data-diff-body="">
        <Body key={props.file.path} {...props} />
      </div>
    </div>
  );
}
