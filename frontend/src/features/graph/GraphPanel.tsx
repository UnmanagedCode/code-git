import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ArrowDownIcon, ArrowUpIcon, GitCompareIcon, ListTreeIcon, RefreshCwIcon, SearchIcon, Settings2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ComparePanel } from '@/features/diff/ComparePanel';
import { setCssPx } from '@/lib/cssVars';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { CreateBranchButton } from '@/features/branches/CreateBranchButton';
import { RepoMenuButton } from '@/features/repoMenu/RepoMenuButton';
import { RemoteToolbar } from '@/features/remotes/RemoteToolbar';
import { anchorOf, ContextMenuHost, openContextMenu } from '@/shell/ContextMenuHost';
import { runPrimary } from '@/shell/menus';
import { loadNextPage, loadStats, loadUntil, refreshGraph, useGraph, viewMemory, type SeekResult } from '@/state/graph';
import { useGraphPrefs } from '@/state/graphPrefs';
import { dispatchSelection, getSelection, useGraphSelection } from '@/state/graphSelection';
import { useStore } from '@/state/store';
import { prefsKey, tabKey, type Tab } from '@/state/tabs';
import { ancestorsWithin } from './ancestry';
import { clampWidth, COLUMNS } from './columns';
import { CONTEXT, type CommitCtx, type CommitsCtx, type RefCtx, type StashCtx, type WipCtx, type WorktreeCtx } from './contexts';
import { CommitDetails } from './details/CommitDetails';
import { DragGhost, startBranchDrag, toDragRef } from './drag';
import { ColumnToggles, GraphHeader, shownColumns } from './GraphHeader';
import { ageMarkers } from './ages';
import { GraphRowView } from './GraphRowView';
import { ChangesButton } from '@/features/workdir/ChangesButton';
import { SubmodulesButton } from '@/features/submodules/SubmodulesPanel';
import { openWip } from '@/features/workdir/entry';
import { openSelectionDiff } from './diffWiring';
import { detailsRequestStore, jumpStore, requestDetails, takeJump } from './jump';
import { labelsByOid, worktreeName, type Label } from './labels';
import { passThroughs, type Through } from './layout';
import { lanesWidth } from './LaneSvg';
import { WIDE_GRAPH_QUERY } from './media';
import { RefsPanel } from './RefsPanel';
import { buildInputs } from './rows';
import type { ChipHandlers } from './RefChip';
import type { Checkout, GraphRow, Stash } from './types';
import { graphKeyHandler } from './useGraphKeys';
import { useGraphLayout } from './useGraphLayout';
import { useGraphSearch } from './useGraphSearch';
import { resolveVisibility, TIPS_MAX } from './visibility';
import { ROW_H, windowFor } from './windowFor';
import './graph.css';
import { matchCombo, matches as pressed, pointerMods } from '@/shell/shortcuts';
import { GRAPH_SEARCH_CLOSE_KEY, GRAPH_SEARCH_NEXT_KEY } from './keys';

/** Load the next page when the viewport bottom is this many rows from the loaded end. */
export const PREFETCH_ROWS = 100;
/** Stats load this long after scrolling settles, ms. */
export const STATS_DEBOUNCE_MS = 150;
/** Pages a jump to an unloaded commit reads before asking. */
export const SEEK_PAGES = 20;
const NO_STASHES: Stash[] = [];
const isDirty = (c: Checkout) => !!c.counts && c.counts.staged + c.counts.unstaged + c.counts.untracked + c.counts.conflicted > 0;
const HOST = 'graph';

/** The commit graph of the active checkout (center slot). */
export function GraphPanel({ tab }: { tab: Tab | null }) {
  return tab ? <GraphView key={tabKey(tab)} tab={tab} /> : null;
}

interface Seek { oid: string; rowId: string; status: 'loading' | Exclude<SeekResult, 'found' | 'cancelled' | 'error'>; ac: AbortController; pages: number }

function GraphView({ tab }: { tab: Tab }) {
  const key = tabKey(tab);
  const data = useGraph(tab);
  const prefs = useGraphPrefs(prefsKey(tab));
  const wide = useMediaQuery(WIDE_GRAPH_QUERY);
  const vis = useMemo(() => (data.refs ? resolveVisibility(data.refs, prefs) : null), [data.refs, prefs]);
  const labels = useMemo(() => (data.refs && vis ? labelsByOid(data.refs, vis, data.checkouts) : new Map<string, Label[]>()), [data.refs, vis, data.checkouts]);
  const wips = useMemo(() => (vis ? data.checkouts.filter((c) => isDirty(c) && vis.wipVisible(c)) : []), [data.checkouts, vis]);
  const stashes = vis?.stashesVisible && data.refs ? data.refs.stashes : NO_STASHES;
  const { rows, inputs } = useMemo(() => buildInputs(data.commits, wips, stashes), [data.commits, wips, stashes]);
  const pinnedTips = useMemo(
    () => prefs.pinned.map((n) => (vis?.visible.has(n) ? data.refs?.refs.find((r) => r.name === n)?.oid : null)).filter((o): o is string => !!o),
    [prefs.pinned, vis, data.refs],
  );
  const layout = useGraphLayout(inputs, pinnedTips);
  const ages = useMemo(() => ageMarkers(rows, data.loadedAt), [rows, data.loadedAt]);
  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const parents = useMemo(() => new Map(data.commits.map((c) => [c.oid, c.parents])), [data.commits]);
  const sel = useGraphSelection(tab);
  const selected = useMemo(() => new Set(sel.ids), [sel.ids]);
  const focusIndex = sel.focus !== null ? index.get(sel.focus) ?? -1 : -1;
  const search = useGraphSearch(tab, data.tips, data.tipsKey, viewMemory.get(key)?.search);
  useEffect(() => {
    viewMemory.set(key, { anchor: viewMemory.get(key)?.anchor ?? null, search: { query: search.query, mode: search.mode } });
  }, [search.query, search.mode]);
  const [hover, setHover] = useState<string | null>(null);
  const dimSet = hover ? ancestorsWithin(hover, parents) : null;
  const columns = shownColumns(prefs);
  const graphWidth = prefs.columns.widths.graph ?? clampWidth('graph', lanesWidth(layout.width));

  // ---- virtual window ----
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [view, setView] = useState({ top: 0, h: 0 });
  const frame = useRef(0);
  const readView = useCallback(() => {
    const el = body.current;
    if (!el) return;
    setView((v) => (v.top === el.scrollTop && v.h === el.clientHeight ? v : { top: el.scrollTop, h: el.clientHeight }));
  }, []);
  // The header scrolls sideways with the rows, both ways: focusing a header cell scrolls the header itself.
  const head = useRef<HTMLDivElement>(null);
  const syncX = (from: HTMLElement | null, to: HTMLElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };
  const onScroll = () => {
    syncX(body.current, head.current);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; readView(); });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    readView();
    const el = body.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => readView());
    ro.observe(el);
    return () => ro.disconnect();
  }, [readView, data.status]);
  const { start, end } = windowFor(view.top, view.h, rows.length);
  // Pass-through lines for the rendered rows only, from the layout's lane runs.
  const through = useMemo(() => passThroughs(layout.state.spans, start, end, layout.state.cap), [layout.state, start, end]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let total = COLUMNS.message.min;
    for (const id of columns) {
      if (id === 'message') continue;
      const w = id === 'graph' ? graphWidth : prefs.columns.widths[id] ?? COLUMNS[id].width;
      setCssPx(el, `--col-${id}`, w);
      total += w;
    }
    setCssPx(el, '--graph-min-w', total);
  });
  useLayoutEffect(() => {
    if (spacer.current) setCssPx(spacer.current, '--graph-total', rows.length * ROW_H);
    if (win.current) setCssPx(win.current, '--graph-offset', start * ROW_H);
  }, [rows.length, start]);

  // Keep the first visible row where it was across a reload of the rows (docs/graph.md → Snapshot and refresh), and
  // across a remount: a diff replacing the graph, or another tab, unmounts it.
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const shownGeneration = useRef(data.generation);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const remembered = !mounted.current ? viewMemory.get(key) : undefined;
    if (!mounted.current) {
      mounted.current = true;
      if (remembered) anchor.current = remembered.anchor;
    }
    if (remembered || shownGeneration.current !== data.generation) {
      shownGeneration.current = data.generation;
      const a = anchor.current;
      const at = a ? index.get(a.id) : undefined;
      const sel1 = getSelection(tab).ids.map((id) => index.get(id)).find((i) => i !== undefined);
      if (a && at !== undefined) el.scrollTop = at * ROW_H + a.offset;
      else if (sel1 !== undefined) el.scrollTop = sel1 * ROW_H;
      readView();
      // The panel that replaced the graph took the focus with it: give it back to the list.
      if (remembered && (!document.activeElement || document.activeElement === document.body)) el.focus({ preventScroll: true });
    }
    const first = Math.floor(el.scrollTop / ROW_H);
    anchor.current = rows[first] ? { id: rows[first].id, offset: el.scrollTop - first * ROW_H } : null;
    viewMemory.set(key, { ...viewMemory.get(key), anchor: anchor.current });
  });

  // Rows gone after a reload leave the selection.
  useEffect(() => { if (data.status === 'ready') dispatchSelection(tab, { type: 'prune', rows }); }, [rows, data.status]);

  // ---- paging and stats ----
  useEffect(() => {
    if (data.nextSkip !== null && !data.pageLoading && !data.pageError && end >= rows.length - PREFETCH_ROWS) void loadNextPage(tab);
  }, [end, rows.length, data.nextSkip, data.pageLoading, data.pageError]);
  const wantStats = columns.includes('changes');
  useEffect(() => {
    if (!wantStats) return;
    const t = setTimeout(() => {
      const oids = rows.slice(start, end).filter((r) => r.kind === 'commit' && !data.stats.has(r.id)).map((r) => r.id);
      if (oids.length) void loadStats(tab, oids);
    }, STATS_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [wantStats, start, end, rows, data.stats]);

  // ---- selection, jumps and seeks ----
  const scrollToRow = useCallback((i: number) => {
    const el = body.current;
    if (!el) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    readView();
  }, [readView]);
  const moveTo = useCallback((i: number) => {
    const r = rows[i];
    if (!r) return;
    dispatchSelection(tab, { type: 'move', id: r.id, rows });
    scrollToRow(i);
  }, [rows, scrollToRow]);

  const [seek, setSeek] = useState<Seek | null>(null);
  /** A found jump's row to select once the rows include it: `rowId`, else (a hidden stash) its commit `oid`. */
  const [pending, setPending] = useState<{ rowId: string; oid: string } | null>(null);
  const seekRef = useRef<Seek | null>(null);
  seekRef.current = seek;
  const jump = useCallback(async (oid: string, rowId: string, pages = SEEK_PAGES) => {
    seekRef.current?.ac.abort();
    const ac = new AbortController();
    const s: Seek = { oid, rowId, status: 'loading', ac, pages };
    setSeek(s);
    const r = await loadUntil(tab, oid, { maxPages: pages, signal: ac.signal });
    if (ac.signal.aborted && r !== 'found') return;
    if (r === 'found') {
      setSeek(null);
      setPending({ rowId, oid });
    } else if (r === 'cancelled' || r === 'error') {
      // A failed page shows its own error (pageError) with Retry.
      setSeek(null);
    } else {
      setSeek({ ...s, status: r });
    }
  }, [key]);
  useEffect(() => {
    if (pending === null) return;
    // The commit is loaded; a row for it (a stash row with the Stashes section hidden) may not exist: select the commit.
    const id = index.has(pending.rowId) ? pending.rowId : index.has(pending.oid) ? pending.oid : null;
    if (id === null) return;
    const i = index.get(id)!;
    setPending(null);
    dispatchSelection(tab, { type: 'move', id, rows });
    const el = body.current;
    if (el) { el.scrollTop = Math.max(0, i * ROW_H - el.clientHeight / 2); readView(); }
  }, [pending, index]);
  // A jump requested while the graph was not mounted (a diff in its place) is served on mount.
  useEffect(() => {
    const serve = () => {
      const j = takeJump(key);
      if (j) void jump(j.oid, j.rowId);
    };
    serve();
    return jumpStore.subscribe(serve);
  }, [key, jump]);
  useEffect(() => () => seekRef.current?.ac.abort(), []);
  const cancelSeek = () => {
    if (!seekRef.current) return false;
    seekRef.current.ac.abort();
    setSeek(null);
    return true;
  };

  // ---- narrow: refs and details in dialogs ----
  const [refsOpen, setRefsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const details = useStore(detailsRequestStore);
  const lastDetails = useRef(details?.seq ?? 0);
  useEffect(() => {
    if (!details || details.key !== key || details.seq <= lastDetails.current) return;
    lastDetails.current = details.seq;
    if (!wide) setDetailsOpen(true);
  }, [details, wide]);

  // ---- menus ----
  const refsAt = (oid: string) => (data.refs?.refs ?? []).filter((r) => r.oid === oid && vis?.visible.has(r.name));
  const rowMenu = (row: GraphRow, at: { x: number; y: number }) => {
    const s = getSelection(tab);
    if (s.ids.length > 1 && s.ids.includes(row.id)) {
      const picked = s.ids.map((id) => rows[index.get(id) ?? -1]).filter(Boolean);
      return openContextMenu({ host: HOST, context: CONTEXT.commits, ctx: { tab, rows: picked } satisfies CommitsCtx, at });
    }
    if (row.kind === 'commit') return openContextMenu({ host: HOST, context: CONTEXT.commit, ctx: { tab, commit: row.item, refs: refsAt(row.id), selection: s.ids } satisfies CommitCtx, at });
    if (row.kind === 'stash') return openContextMenu({ host: HOST, context: CONTEXT.stash, ctx: { tab, stash: row.stash } satisfies StashCtx, at });
    return openContextMenu({ host: HOST, context: CONTEXT.wip, ctx: { tab, checkout: row.checkout.target, name: row.checkout.name, isOwn: row.checkout.isOwn } satisfies WipCtx, at });
  };
  const resolveDrop = useCallback((name: string) => {
    const r = data.refs?.refs.find((x) => x.name === name);
    return r ? toDragRef(r) : null;
  }, [data.refs]);
  const chips = useMemo<ChipHandlers>(() => ({
    onHover: (l) => setHover(l ? (l.kind === 'worktree' ? l.worktree.head : l.kind === 'stash' ? null : l.ref?.oid ?? data.refs?.head.oid ?? null) : null),
    onContextMenu: (e, l) => {
      e.preventDefault();
      e.stopPropagation();
      const at = { x: e.clientX, y: e.clientY };
      if (l.kind === 'tag') openContextMenu({ host: HOST, context: CONTEXT.tag, ctx: { tab, ref: l.ref } satisfies RefCtx, at });
      else if ((l.kind === 'local' || l.kind === 'remote' || l.kind === 'head') && l.ref) openContextMenu({ host: HOST, context: CONTEXT.branch, ctx: { tab, ref: l.ref } satisfies RefCtx, at });
      else if (l.kind === 'worktree') {
        openContextMenu({ host: HOST, context: CONTEXT.worktree, ctx: { tab, worktree: l.worktree, ccCheckout: worktreeName(l.worktree, data.checkouts).checkout?.target ?? null } satisfies WorktreeCtx, at });
      } else {
        const row = (e.currentTarget as HTMLElement).closest('[data-row-id]')?.getAttribute('data-row-id');
        const r = row ? rows[index.get(row) ?? -1] : undefined;
        if (r) rowMenu(r, at);
      }
    },
    onDoubleClick: (l) => {
      if (l.kind === 'tag') runPrimary(CONTEXT.tag, { tab, ref: l.ref } satisfies RefCtx);
      else if ((l.kind === 'local' || l.kind === 'remote' || l.kind === 'head') && l.ref) runPrimary(CONTEXT.branch, { tab, ref: l.ref } satisfies RefCtx);
    },
    onPointerDown: (e, l) => {
      if ((l.kind !== 'local' && l.kind !== 'remote' && l.kind !== 'head') || !l.ref) return;
      const source = toDragRef(l.ref);
      if (source) startBranchDrag(e, { tab, source, host: HOST, resolve: resolveDrop });
    },
  }), [data.refs, data.checkouts, rows, index, resolveDrop]);

  const onRowClick = useCallback((e: MouseEvent, row: GraphRow) => {
    const mods = pointerMods(e);
    const type = mods.shift ? 'range' : mods.mod ? 'toggle' : 'click';
    dispatchSelection(tab, { type, id: row.id, rows });
    body.current?.focus({ preventScroll: true });
    if (type !== 'click' || getSelection(tab).ids.length !== 1) return;
    // A WIP row opens its Changes panel (the details for anything else); the graph keeps the keyboard focus.
    if (row.kind === 'wip') openWip(tab, row.checkout.target, { focus: false });
    else requestDetails(tab);
  }, [rows]);
  const onRowMenu = useCallback((e: MouseEvent, row: GraphRow) => {
    e.preventDefault();
    rowMenu(row, { x: e.clientX, y: e.clientY });
  }, [rows, index, data.refs, vis]);

  // ---- search navigation ----
  const matches = search.matches;
  const matchIdx = useMemo(() => (matches ? rows.flatMap((r, i) => (r.kind === 'commit' && matches.has(r.id) ? [i] : [])) : []), [matches, rows]);
  const unloaded = matches ? [...matches].filter((o) => !parents.has(o)) : [];
  const nextMatch = (dir: 1 | -1) => {
    if (!matches || !matches.size) return;
    const after = dir > 0 ? matchIdx.find((i) => i > focusIndex) : [...matchIdx].reverse().find((i) => i < focusIndex);
    if (after !== undefined) return moveTo(after);
    if (dir > 0 && unloaded.length) return void jump(unloaded[0], unloaded[0]);
    if (matchIdx.length) moveTo(dir > 0 ? matchIdx[0] : matchIdx[matchIdx.length - 1]);
  };
  const matchPos = matchIdx.indexOf(focusIndex) + 1;

  const onKeyDown = graphKeyHandler({
    rows, layout: layout.rows, focus: focusIndex, moveTo, clear: () => dispatchSelection(tab, { type: 'clear' }),
    loadMore: () => void loadNextPage(tab), cancelSeek, focusSearch: () => searchBox.current?.focus(), openDiff: () => openSelectionDiff(tab),
    openMenu: (i) => {
      const el = body.current?.querySelector(`[data-row-id="${CSS.escape(rows[i].id)}"]`);
      rowMenu(rows[i], el ? anchorOf(el) : { x: 0, y: 0 });
    },
  });

  if (data.status === 'idle') return null;
  const loaded = data.commits.length;
  return (
    <div ref={root} role="region" aria-label="Commit graph" className="flex h-full min-h-0 flex-col" data-graph-root="" data-loaded={loaded} data-more={data.nextSkip !== null ? '' : undefined}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <div className="relative flex min-w-40 flex-1 items-center sm:max-w-96">
          <SearchIcon className="pointer-events-none absolute left-2 size-4 text-muted-foreground" />
          <Input
            ref={searchBox}
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={(e) => {
              const next = matchCombo(e, GRAPH_SEARCH_NEXT_KEY);
              if (next) { e.preventDefault(); nextMatch(next.shift === true ? -1 : 1); }
              if (pressed(e, GRAPH_SEARCH_CLOSE_KEY)) { search.setQuery(''); body.current?.focus(); }
            }}
            placeholder={search.mode === 'path' ? 'Search commits touching a path' : 'Search commits'}
            aria-label="Search commits"
            className="h-8 pl-8"
          />
        </div>
        <div className="flex" role="group" aria-label="Search by">
          {(['commits', 'path'] as const).map((m) => (
            <Button key={m} variant={search.mode === m ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" aria-pressed={search.mode === m} onClick={() => search.setMode(m)}>
              {m === 'commits' ? 'Commits' : 'Path'}
            </Button>
          ))}
        </div>
        {matches && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
            <span aria-label="Match position">{matchPos} / {matches.size}</span>
            {unloaded.length > 0 && <span>(+{unloaded.length} not loaded)</span>}
            {search.truncated && <span>first {matches.size} matches</span>}
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Previous match" onClick={() => nextMatch(-1)}><ArrowUpIcon /></Button>
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Next match" onClick={() => nextMatch(1)}><ArrowDownIcon /></Button>
          </span>
        )}
        {search.searching && <span className="text-xs text-muted-foreground">Searching…</span>}
        {search.error && <span className="text-xs text-destructive" role="alert">{search.error}</span>}
        {/* Wraps within itself: below `lg` it holds Refs, Compare, Changes, Columns, Fetch, Pull, Push, Branch and Refresh, wider than a phone. */}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {!wide && (
            <>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2" onClick={() => setRefsOpen(true)}>
                <ListTreeIcon /> Refs
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2" onClick={() => setCompareOpen(true)}>
                <GitCompareIcon /> Compare
              </Button>
              <ChangesButton tab={tab} />
              <SubmodulesButton key={tabKey(tab)} tab={tab} />
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Columns"><Settings2Icon /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              <ColumnToggles prefsKey={prefsKey(tab)} prefs={prefs} />
            </DropdownMenuContent>
          </DropdownMenu>
          <RemoteToolbar tab={tab} />
          <CreateBranchButton tab={tab} />
          <RepoMenuButton tab={tab} />
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Refresh graph" onClick={() => void refreshGraph(tab, 'manual')}>
            <RefreshCwIcon className={data.status === 'loading' ? 'animate-spin' : undefined} />
          </Button>
        </span>
      </div>

      {data.error && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm" role="alert">
          <span className="text-destructive">{data.error.message}</span>
          <Button variant="outline" size="sm" className="h-7" onClick={() => void refreshGraph(tab, 'manual')}>Retry</Button>
        </div>
      )}
      {vis && vis.tipsDropped > 0 && (
        <div className="border-b px-3 py-1.5 text-sm text-warning" role="status">
          Graphing {TIPS_MAX.toLocaleString()} of {(TIPS_MAX + vis.tipsDropped).toLocaleString()} ref tips (the most one request takes): hide or solo refs to choose which.
        </div>
      )}
      {data.pageError && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm" role="alert">
          <span className="text-destructive">Could not load more commits: {data.pageError.message}</span>
          <Button variant="outline" size="sm" className="h-7" onClick={() => void loadNextPage(tab)}>Retry</Button>
        </div>
      )}
      {seek && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm" role="status">
          {seek.status === 'loading' && <span>Loading… {loaded} commits <span className="text-muted-foreground">(Esc to stop)</span></span>}
          {seek.status === 'limit' && (
            <>
              <span>Not within the first {loaded} commits.</span>
              <Button variant="outline" size="sm" className="h-7" onClick={() => void jump(seek.oid, seek.rowId)}>Load more</Button>
            </>
          )}
          {seek.status === 'end' && <span>Not in the visible graph.</span>}
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => cancelSeek()}>{seek.status === 'loading' ? 'Stop' : 'Dismiss'}</Button>
        </div>
      )}

      {data.status === 'loading' && !data.refs && <p className="p-4 text-sm text-muted-foreground">Loading graph…</p>}
      {data.status === 'error' && !data.refs && <p className="p-4 text-sm text-muted-foreground">The graph could not be loaded.</p>}
      {data.refs && (
        <>
          <div ref={head} className="shrink-0 overflow-hidden" onScroll={() => syncX(head.current, body.current)}>
            <div className="min-w-(--graph-min-w)">
              <GraphHeader prefsKey={prefsKey(tab)} prefs={prefs} root={() => root.current} />
            </div>
          </div>
          <div
            ref={body}
            role="listbox"
            aria-label="Commits"
            aria-multiselectable
            tabIndex={0}
            className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onScroll={onScroll}
            onKeyDown={onKeyDown}
          >
            {!rows.length && <p className="p-4 text-sm text-muted-foreground">{data.refs.head.unborn ? 'No commits yet.' : 'No commits to show.'}</p>}
            <div ref={spacer} className="relative h-(--graph-total) min-w-(--graph-min-w)">
              <div ref={win} className="absolute inset-x-0 top-0 translate-y-(--graph-offset)">
                {rows.slice(start, end).map((row, k) => {
                  const i = start + k;
                  const lay = layout.rows[i];
                  if (!lay) return null;
                  const on = rowOid(row);
                  return (
                    <GraphRowView
                      key={row.id}
                      row={row}
                      ageMarker={ages.get(row.id)}
                      layout={lay}
                      through={through[k] ?? NO_THROUGH}
                      labels={labels.get(row.kind === 'commit' ? row.id : row.kind === 'stash' ? row.stash.oid : '') ?? NO_LABELS}
                      columns={columns}
                      graphWidth={graphWidth}
                      selected={selected.has(row.id)}
                      focused={i === focusIndex}
                      matched={!!matches && row.kind === 'commit' && matches.has(row.id)}
                      dimmed={!!dimSet && dimSet.size > 0 && !(on && dimSet.has(on))}
                      stat={row.kind === 'commit' ? data.stats.get(row.id) : undefined}
                      chips={chips}
                      onClick={onRowClick}
                      onContextMenu={onRowMenu}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          <p className={cn('shrink-0 border-t px-3 py-0.5 text-xs text-muted-foreground', !loaded && 'hidden')}>
            {loaded} commits loaded{data.nextSkip === null ? '' : data.pageLoading ? ' · loading more…' : ' · more on scroll'}
          </p>
        </>
      )}
      <ContextMenuHost host={HOST} />
      <DragGhost />
      {!wide && (
        <>
          <Dialog open={refsOpen} onOpenChange={setRefsOpen}>
            <DialogContent className="max-h-[85dvh] p-0">
              <DialogTitle className="px-4 pt-4">Refs</DialogTitle>
              <DialogDescription className="sr-only">Branches, remotes, tags, stashes and worktrees</DialogDescription>
              <div className="max-h-[70dvh] overflow-y-auto"><RefsPanel tab={tab} inDialog /></div>
            </DialogContent>
          </Dialog>
          <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
            <DialogContent className="max-h-[85dvh] p-0">
              <DialogTitle className="px-4 pt-4">Compare</DialogTitle>
              <DialogDescription className="sr-only">Pick what to diff</DialogDescription>
              <div className="max-h-[70dvh] overflow-y-auto"><ComparePanel tab={tab} /></div>
            </DialogContent>
          </Dialog>
          <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
            <DialogContent className="max-h-[85dvh] p-0">
              <DialogTitle className="px-4 pt-4">Details</DialogTitle>
              <DialogDescription className="sr-only">The selected commit</DialogDescription>
              <div className="max-h-[70dvh] overflow-y-auto"><CommitDetails tab={tab} inDialog /></div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

const NO_LABELS: Label[] = [];
const NO_THROUGH: Through[] = [];
/** The commit a row stands on, for hover dimming. */
const rowOid = (r: GraphRow): string | null => (r.kind === 'commit' ? r.id : r.kind === 'stash' ? r.stash.parents[0] ?? null : r.checkout.headOid);
