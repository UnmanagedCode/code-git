import { useEffect, useMemo, useState } from 'react';
import { loadFileDiff, type FileDiff } from '@/features/diff/api';
import type { Marks } from '@/features/diff/CodeLine';
import { DiffRows } from '@/features/diff/DiffRows';
import { DiffToggles, Seg } from '@/features/diff/DiffToggles';
import { FileCounts } from '@/features/diff/FileList';
import { lineCounts } from '@/features/diff/model';
import { languageFor } from '@/features/diff/highlight';
import { useTokenizer } from '@/features/diff/highlight/useTokenizer';
import { buildRows, highlightSides, layoutFor } from '@/features/diff/viewRows';
import { contextFor, prefsStore, setPrefs, whitespaceFor } from '@/state/diff';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import type { Picked } from './state';

// One commit's change to the file, through the diff feature's own views and toggles; every view choice is the shared prefs.

const NO_MARKS: Marks = { byCell: new Map(), current: null };

export function CommitFileView({ tab, picked }: { tab: Tab; picked: Picked }) {
  const prefs = useStore(prefsStore);
  const tokenize = useTokenizer(prefs.syntax);
  const [state, setState] = useState<{ key: string; diff: FileDiff | null; error: string | null } | null>(null);
  const context = contextFor(prefs);
  const ws = whitespaceFor(prefs);
  const key = `${picked.oid}\0${picked.path}\0${context}\0${ws}`;
  useEffect(() => {
    let live = true;
    setState(null);
    loadFileDiff(tab, { kind: 'commit', rev: picked.oid }, { path: picked.path, ...(picked.oldPath ? { oldPath: picked.oldPath } : {}), context, whitespace: ws })
      .then((diff) => { if (live) setState({ key, diff, error: null }); }, (e: unknown) => { if (live) setState({ key, diff: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [key]);
  const diff = state?.key === key ? state.diff : null;
  const layout = layoutFor(prefs);
  const headers = prefs.scope === 'hunk';
  const segs = useMemo(() => (diff && prefs.syntax ? highlightSides(diff.hunks, languageFor(picked.path), tokenize) : null), [diff, tokenize, prefs.syntax]);
  const rows = useMemo(() => (diff ? buildRows(diff, layout, headers, segs) : []), [diff, layout, headers, segs]);
  const counts = useMemo(() => (diff ? lineCounts(diff) : null), [diff]);
  let body;
  if (!state || state.key !== key) body = <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  else if (state.error) body = <p role="alert" className="p-3 text-sm text-destructive">{state.error}</p>;
  else if (diff?.binary) body = <p className="p-3 text-sm text-muted-foreground">Binary file — not shown</p>;
  else if (!rows.length) body = <p className="p-3 text-sm text-muted-foreground">No content changes</p>;
  else body = <DiffRows rows={rows} layout={layout} marks={NO_MARKS} wrap={prefs.wrap} />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Commit change">
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1" role="toolbar" aria-label="Change view">
        <span className="min-w-0 truncate font-mono text-xs">{picked.oldPath ? `${picked.oldPath} → ${picked.path}` : picked.path} @ {picked.oid.slice(0, 7)}</span>
        {diff && counts && <FileCounts file={{ status: 'M', ...counts, binary: diff.binary, submodule: !!diff.submodule }} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DiffToggles prefs={prefs} disabled={prefs.view !== 'diff'} />
          <Seg label="View" value={prefs.view} options={[{ value: 'diff', label: 'Diff' }, { value: 'file', label: 'File' }]} onPick={(view) => setPrefs({ view })} />
        </div>
      </div>
      <div className="min-h-48 flex-1 overflow-auto" data-history-viewer="">{body}</div>
    </div>
  );
}
