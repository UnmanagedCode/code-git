import { useEffect, useMemo, useRef, useState } from 'react';
import { applyLines, type LineAction } from '@/features/staging/actions';
import { HunkActions } from '@/features/staging/HunkActions';
import { canPartial } from '@/features/staging/partial';
import { SelectionBar } from '@/features/staging/SelectionBar';
import { openStashSave } from '@/features/stash/actions';
import { StashViewSwitch } from '@/features/stash/StashViewSwitch';
import { stashViewOf } from '@/features/stash/views';
import type { LineSelection } from '@/features/workdir/api';
import { extendRange, hunkRequest, lineKey, toggle, toRequest } from '@/features/staging/selection';
import { useGraphData } from '@/state/graph';
import { clearLineSelection, setLineSelection, useLineSelection } from '@/state/lineSelection';
import { useStore } from '@/state/store';
import {
  contextFor, diffStore, fileKey, forceFile, loadFile, loadList, prefsStore, setSelection,
} from '@/state/diff';
import { tabKey, type Tab } from '@/state/tabs';
import { workdirOf, workdirStore } from '@/state/workdir';
import type { Marks, StagingView } from './CodeLine';
import { DiffHeader } from './DiffHeader';
import { FileList } from './FileList';
import { FileView } from './FileView';
import { languageFor } from './highlight';
import { useTokenizer } from './highlight/useTokenizer';
import { changeBlocks } from './model';
import { closeDiff, openDiff } from './openDiff';
import { copyPatch, downloadPatch, patchPaths, patchSource } from './patch';
import { SearchBar } from './SearchBar';
import { useDiffKeys } from './useDiffKeys';
import { buildRows, findMatches, highlightSides } from './viewRows';

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

function DiffView({ tab }: { tab: Tab }) {
  const state = useStore(diffStore).get(tabKey(tab));
  const prefs = useStore(prefsStore);
  const tokenize = useTokenizer(prefs.syntax);
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [changeIndex, setChangeIndex] = useState(0);

  const list = state?.list;
  const result = list?.result ?? null;
  const files = result?.files ?? [];
  const file = files.find((f) => f.path === state?.viewed) ?? null;
  const context = contextFor(prefs);
  const key = file ? fileKey(file.path, context, prefs.whitespace) : null;
  const fileState = key ? state?.files.get(key) : undefined;
  const forced = !!file && !!state?.forced.includes(file.path);
  const wantFile = !!file && !file.binary && file.status !== 'U' && (!file.oversized || forced) && list?.whitespace === prefs.whitespace;
  const layout = prefs.view === 'file' ? 'file' : prefs.mode;

  useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);
  // The whitespace choice changes numstat too: the list is reloaded for it.
  useEffect(() => {
    if (list && !list.loading && list.whitespace !== prefs.whitespace) void loadList(tab);
  }, [prefs.whitespace, list?.whitespace, list?.loading]);
  useEffect(() => {
    if (wantFile && file && !fileState) void loadFile(tab, file, context, prefs.whitespace);
  }, [key, wantFile, !!fileState]);
  useEffect(() => { setChangeIndex(0); }, [key, layout]);
  useEffect(() => { if (searchOpen) inputRef.current?.focus(); }, [searchOpen]);

  const diff = fileState?.diff ?? null;
  const lang = file ? languageFor(file.path) : null;
  const segs = useMemo(() => (diff && prefs.syntax ? highlightSides(diff.hunks, lang, tokenize) : null), [diff, lang, tokenize, prefs.syntax]);
  const rows = useMemo(() => (diff ? buildRows(diff, layout, segs) : []), [diff, layout, segs]);
  const changeCount = useMemo(() => (diff ? changeBlocks(diff.hunks).length : 0), [diff]);
  const matches = useMemo(() => (searchOpen ? findMatches(rows, query) : []), [rows, query, searchOpen]);
  const current = matches.length ? Math.min(matchIndex, matches.length - 1) : -1;
  const marks = useMemo<Marks>(() => {
    const byCell = new Map<string, { start: number; end: number }[]>();
    for (const m of matches) byCell.set(m.cellId, [...(byCell.get(m.cellId) ?? []), m]);
    const c = matches[current];
    return { byCell, current: c ? { cellId: c.cellId, range: c } : null };
  }, [matches, current]);
  useEffect(() => { setMatchIndex(0); }, [query, key, layout]);

  // Hunk and line staging (features/staging), for an unstaged or staged diff of a modified file only.
  const generation = state?.generation ?? 0;
  const sel = useLineSelection(tab, key, generation);
  const [linesBusy, setLinesBusy] = useState(false);
  const partial = !!file && !!state && canPartial(file, diff, prefs, state.source);
  const section = state?.source.kind === 'staged' ? 'staged' : 'unstaged';
  const runLines = (action: LineAction, req: ReturnType<typeof toRequest>) => {
    if (!diff) return;
    setLinesBusy(true);
    void applyLines(tab, action, diff, context, req).finally(() => setLinesBusy(false));
  };
  // Lines are stashed only from a file with nothing staged (stash.pushLines refuses it otherwise).
  useStore(workdirStore);
  const stagedFiles = workdirOf(tab).staged?.files;
  const stashable = section === 'unstaged' && !!file && !!stagedFiles && !stagedFiles.some((f) => f.path === file.path);
  const stashLines = (req: LineSelection[]) => {
    if (diff && req.length) openStashSave(tab, { mode: 'lines', request: { path: diff.path, context, hunks: req }, count: req.reduce((n, h) => n + h.lines.length, 0) });
  };
  const staging = useMemo<StagingView | undefined>(() => (partial && diff && key ? {
    selected: sel.keys,
    onToggle: (h, i, shift) => {
      const k = lineKey(h, i);
      const keys = shift && sel.anchor ? new Set([...sel.keys, ...extendRange(diff, sel.anchor, k)]) : toggle(sel.keys, k);
      setLineSelection(tab, { fileKey: key, generation, keys, anchor: shift && sel.anchor ? sel.anchor : k });
    },
    hunkActions: (h) => (
      <HunkActions section={section} busy={linesBusy} onAction={(a) => runLines(a, hunkRequest(diff, h))} onStash={stashable ? () => stashLines(hunkRequest(diff, h)) : undefined} />
    ),
  } : undefined), [partial, diff, key, sel, generation, section, linesBusy, stashable]);
  const stashes = useGraphData(tab).refs?.stashes;
  const stashView = result?.commit && stashes ? stashViewOf(stashes, result.commit.oid) : null;
  useEffect(() => {
    if (current !== -1) rootRef.current?.querySelector('[data-match-current]')?.scrollIntoView({ block: 'center' });
  }, [current, matches]);

  const goChange = (k: number) => {
    if (!changeCount || prefs.view !== 'diff') return;
    const next = Math.max(0, Math.min(changeCount - 1, k));
    setChangeIndex(next);
    rootRef.current?.querySelector(`[data-change-index="${next}"]`)?.scrollIntoView({ block: 'center' });
  };
  const step = (d: 1 | -1) => { if (matches.length) setMatchIndex((current + d + matches.length) % matches.length); };
  const closeSearch = () => { setSearchOpen(false); rootRef.current?.focus({ preventScroll: true }); };
  const onKeyDown = useDiffKeys({
    find: () => { setSearchOpen(true); inputRef.current?.focus(); inputRef.current?.select(); },
    nextChange: () => goChange(changeIndex + 1),
    prevChange: () => goChange(changeIndex - 1),
    escape: () => (searchOpen ? closeSearch() : closeDiff(tab)),
  });

  if (!state) return null;
  const viewedIndex = file ? files.indexOf(file) : -1;
  const pickFile = (i: number) => { const f = files[i]; if (f) setSelection(tab, [f.path], f.path); };
  const psource = result ? patchSource(state.source, result) : state.source;

  return (
    <section ref={rootRef} aria-label="Diff" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none" onKeyDown={onKeyDown}>
      <DiffHeader
        source={state.source}
        result={result}
        loading={!!list?.loading}
        selectedCount={state.selected.length}
        notice={state.notice}
        parentControl={stashView && <StashViewSwitch tab={tab} stash={stashView.stash} view={stashView.view} path={state.viewed} />}
        onParent={(parent) => state.source.kind === 'commit' && openDiff(tab, { ...state.source, parent }, state.viewed ? { path: state.viewed } : {})}
        onRefresh={() => void loadList(tab)}
        onPatch={(how, selectedOnly) => void (how === 'download' ? downloadPatch : copyPatch)(tab, psource, selectedOnly ? patchPaths(files.filter((f) => state.selected.includes(f.path))) : undefined)}
        onClose={() => closeDiff(tab)}
      />
      {list?.error ? (
        <div className="p-4 text-sm" role="alert">
          <p className="text-destructive">
            {list.error.code === 'OUTPUT_TOO_LARGE'
              ? `This diff is too large to list${list.error.limitBytes ? ` (its file list is over ${mb(list.error.limitBytes)})` : ''}.`
              : list.error.message}
          </p>
        </div>
      ) : !result ? (
        <p className="p-4 text-sm text-muted-foreground">Loading files…</p>
      ) : !files.length ? (
        <p className="p-4 text-sm text-muted-foreground">No changes.</p>
      ) : (
        <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
          <FileList
            tab={tab}
            files={files}
            selected={state.selected}
            viewed={state.viewed}
            patchSource={psource}
            onSelect={(sel, viewed) => setSelection(tab, sel, viewed)}
            className="max-h-28 shrink-0 overflow-y-auto border-b md:max-h-none md:w-64 md:border-r md:border-b-0"
          />
          {file && (
            <FileView
              file={file}
              state={fileState}
              forced={forced}
              prefs={prefs}
              rows={rows}
              marks={marks}
              changeCount={changeCount}
              changeIndex={changeIndex}
              onChange={goChange}
              onFile={(d) => pickFile(viewedIndex + d)}
              canPrevFile={viewedIndex > 0}
              canNextFile={viewedIndex !== -1 && viewedIndex < files.length - 1}
              onForce={() => forceFile(tab, file.path)}
              staging={staging}
              selectionBar={staging && diff && (
                <SelectionBar
                  count={sel.keys.size} section={section} busy={linesBusy} onAction={(a) => runLines(a, toRequest(diff, sel.keys))}
                  onStash={stashable ? () => stashLines(toRequest(diff, sel.keys)) : undefined} onClear={() => clearLineSelection(tab)}
                />
              )}
              search={searchOpen && (
                <SearchBar query={query} onQuery={setQuery} index={current} count={matches.length} onNext={() => step(1)} onPrev={() => step(-1)} onClose={closeSearch} inputRef={inputRef} />
              )}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** The center on-demand panel: the active tab's diff (each tab keeps its own). */
export function DiffPanel({ tab }: { tab: Tab | null }) {
  return tab ? <DiffView key={tabKey(tab)} tab={tab} /> : null;
}
