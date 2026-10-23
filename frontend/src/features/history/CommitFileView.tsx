import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { loadFileDiff, type FileDiff } from '@/features/diff/api';
import type { Marks } from '@/features/diff/CodeLine';
import { FileContentView } from '@/features/diff/FileContentView';
import { FileCounts } from '@/features/diff/FileList';
import { lineCounts } from '@/features/diff/model';
import { languageFor } from '@/features/diff/highlight';
import { useTokenizer } from '@/features/diff/highlight/useTokenizer';
import { SplitView } from '@/features/diff/SplitView';
import { UnifiedView } from '@/features/diff/UnifiedView';
import { buildRows, highlightSides } from '@/features/diff/viewRows';
import { contextFor, prefsStore, setPrefs } from '@/state/diff';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import type { Picked } from './state';

// One commit's change to the file, through the diff feature's own views; Diff/File and the diff mode are the shared prefs.

const NO_MARKS: Marks = { byCell: new Map(), current: null };

export function CommitFileView({ tab, picked }: { tab: Tab; picked: Picked }) {
  const prefs = useStore(prefsStore);
  const tokenize = useTokenizer(prefs.syntax);
  const [state, setState] = useState<{ key: string; diff: FileDiff | null; error: string | null } | null>(null);
  const context = contextFor(prefs);
  const key = `${picked.oid}\0${picked.path}\0${context}\0${prefs.whitespace}`;
  useEffect(() => {
    let live = true;
    setState(null);
    loadFileDiff(tab, { kind: 'commit', rev: picked.oid }, { path: picked.path, ...(picked.oldPath ? { oldPath: picked.oldPath } : {}), context, whitespace: prefs.whitespace })
      .then((diff) => { if (live) setState({ key, diff, error: null }); }, (e: unknown) => { if (live) setState({ key, diff: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [key]);
  const diff = state?.key === key ? state.diff : null;
  const layout = prefs.view === 'file' ? 'file' : prefs.mode;
  const segs = useMemo(() => (diff && prefs.syntax ? highlightSides(diff.hunks, languageFor(picked.path), tokenize) : null), [diff, tokenize, prefs.syntax]);
  const rows = useMemo(() => (diff ? buildRows(diff, layout, segs) : []), [diff, layout, segs]);
  const counts = useMemo(() => (diff ? lineCounts(diff) : null), [diff]);
  let body;
  if (!state || state.key !== key) body = <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  else if (state.error) body = <p role="alert" className="p-3 text-sm text-destructive">{state.error}</p>;
  else if (diff?.binary) body = <p className="p-3 text-sm text-muted-foreground">Binary file — not shown</p>;
  else if (!rows.length) body = <p className="p-3 text-sm text-muted-foreground">No content changes</p>;
  else if (prefs.view === 'file') body = <FileContentView rows={rows} marks={NO_MARKS} wrap={prefs.wrap} />;
  else body = prefs.mode === 'split' ? <SplitView rows={rows} marks={NO_MARKS} wrap={prefs.wrap} /> : <UnifiedView rows={rows} marks={NO_MARKS} wrap={prefs.wrap} />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Commit change">
      <div className="flex items-center gap-2 border-b px-2 py-1" role="toolbar" aria-label="Change view">
        <span className="min-w-0 truncate font-mono text-xs">{picked.oldPath ? `${picked.oldPath} → ${picked.path}` : picked.path} @ {picked.oid.slice(0, 7)}</span>
        {diff && counts && <FileCounts file={{ status: 'M', ...counts, binary: diff.binary, submodule: !!diff.submodule }} />}
        <div className="ml-auto flex rounded-md border p-0.5" role="group" aria-label="View">
          {(['diff', 'file'] as const).map((v) => (
            <Button key={v} variant={prefs.view === v ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={prefs.view === v} onClick={() => setPrefs({ view: v })}>
              {v === 'diff' ? 'Diff' : 'File'}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-48 flex-1 overflow-auto" data-history-viewer="">{body}</div>
    </div>
  );
}
