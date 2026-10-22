import { ApiError } from '@/lib/api';
import { getItem, setItem } from '@/lib/storage';
import { listDiffFiles, loadFileDiff, type DiffFile, type DiffFilesResult, type DiffSource, type FileDiff, type Whitespace } from '@/features/diff/api';
import { pruneClosedTabs } from './shownPanel';
import { createStore } from './store';
import { tabKey, tabsStore, type Tab } from './tabs';

export interface DiffError { message: string; code: string | null; limitBytes: number | null }
export interface FileState { loading: boolean; error: DiffError | null; diff: FileDiff | null }

export interface DiffTabState {
  source: DiffSource;
  list: { loading: boolean; error: DiffError | null; result: DiffFilesResult | null; whitespace: Whitespace };
  /** Paths selected in the file list. */
  selected: string[];
  /** The path shown in the viewer. */
  viewed: string | null;
  /** Oversized paths the user chose to load anyway. */
  forced: string[];
  /** By fileKey (path + context + whitespace). */
  files: ReadonlyMap<string, FileState>;
  /** A failed patch request, shown in the header until the next one. */
  notice: string | null;
  /** Bumped by every list load, so an answer for an older one is dropped. */
  generation: number;
}

export type DiffMode = 'hunk' | 'inline' | 'split';
export interface DiffPrefs { mode: DiffMode; view: 'diff' | 'file'; context: number; whitespace: Whitespace; wrap: boolean; syntax: boolean }

export const DEFAULT_PREFS: DiffPrefs = { mode: 'hunk', view: 'diff', context: 3, whitespace: 'none', wrap: false, syntax: true };
const PREFS_KEY = 'diff-prefs';

function loadPrefs(): DiffPrefs {
  try {
    const v = JSON.parse(getItem(PREFS_KEY) ?? 'null') as Partial<DiffPrefs> | null;
    return v && typeof v === 'object' ? { ...DEFAULT_PREFS, ...v } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Global, persisted as `code-git:diff-prefs`. */
export const prefsStore = createStore<DiffPrefs>(loadPrefs());
prefsStore.subscribe(() => setItem(PREFS_KEY, JSON.stringify(prefsStore.get())));
export const setPrefs = (p: Partial<DiffPrefs>): void => prefsStore.set((s) => ({ ...s, ...p }));

/** Per checkout, keyed by tabKey. */
export const diffStore = createStore<ReadonlyMap<string, DiffTabState>>(new Map());
tabsStore.subscribe(() => pruneClosedTabs(diffStore));

export function resetDiff(): void {
  diffStore.set(new Map());
  prefsStore.set(DEFAULT_PREFS);
}

const put = (tab: Tab, f: (s: DiffTabState) => DiffTabState) =>
  diffStore.set((m) => {
    const s = m.get(tabKey(tab));
    return s ? new Map(m).set(tabKey(tab), f(s)) : m;
  });

const toError = (e: unknown): DiffError => {
  const body = e instanceof ApiError ? (e.body as { limitBytes?: unknown } | undefined) : undefined;
  return {
    message: e instanceof Error ? e.message : String(e),
    code: e instanceof ApiError ? e.code ?? null : null,
    limitBytes: typeof body?.limitBytes === 'number' ? body.limitBytes : null,
  };
};

/** Context a request uses: the chosen one in Hunk mode, the whole file in Inline, Split and File view. */
export const contextFor = (p: DiffPrefs): number | 'full' => (p.view === 'diff' && p.mode === 'hunk' ? p.context : 'full');
export const fileKey = (path: string, context: number | 'full', ws: Whitespace): string => `${path}\0${context}\0${ws}`;

/** A fresh diff for `tab`: `preloaded` is a list already fetched for `source` (the Compare panel validates first). */
export function startDiff(tab: Tab, source: DiffSource, opts: { path?: string; preloaded?: DiffFilesResult } = {}): void {
  const prev = diffStore.get().get(tabKey(tab));
  const ws = prefsStore.get().whitespace;
  const state: DiffTabState = {
    source,
    list: { loading: !opts.preloaded, error: null, result: opts.preloaded ?? null, whitespace: ws },
    selected: [], viewed: null, forced: [], notice: null, files: new Map(), generation: (prev?.generation ?? 0) + 1,
  };
  diffStore.set((m) => new Map(m).set(tabKey(tab), opts.preloaded ? withFirstViewed(state, opts.path) : { ...state, viewed: opts.path ?? null }));
  if (!opts.preloaded) void loadList(tab, opts.path);
}

function withFirstViewed(s: DiffTabState, path?: string | null): DiffTabState {
  const files = s.list.result?.files ?? [];
  const viewed = files.find((f) => f.path === path)?.path ?? files[0]?.path ?? null;
  return { ...s, viewed, selected: viewed ? [viewed] : [] };
}

export function endDiff(tab: Tab): void {
  diffStore.set((m) => {
    if (!m.has(tabKey(tab))) return m;
    const next = new Map(m);
    next.delete(tabKey(tab));
    return next;
  });
}

/** (Re)loads the file list for the tab's source; the viewed path is kept when it is still listed. */
export async function loadList(tab: Tab, keepPath?: string | null): Promise<void> {
  const cur = diffStore.get().get(tabKey(tab));
  if (!cur) return;
  const generation = cur.generation + 1;
  const ws = prefsStore.get().whitespace;
  const keep = keepPath ?? cur.viewed;
  put(tab, (s) => ({ ...s, generation, files: new Map(), list: { ...s.list, loading: true, error: null, whitespace: ws } }));
  const fresh = (s: DiffTabState) => s.generation === generation;
  try {
    const result = await listDiffFiles(tab, cur.source, ws);
    put(tab, (s) => (fresh(s) ? withFirstViewed({ ...s, list: { loading: false, error: null, result, whitespace: ws } }, keep) : s));
  } catch (e) {
    put(tab, (s) => (fresh(s) ? { ...s, list: { loading: false, error: toError(e), result: null, whitespace: ws } } : s));
  }
}

/** Loads one file's diff against the list's pinned pair. */
export async function loadFile(tab: Tab, file: DiffFile, context: number | 'full', ws: Whitespace): Promise<void> {
  const cur = diffStore.get().get(tabKey(tab));
  const pair = cur?.list.result?.pair;
  if (!cur || !pair) return;
  const key = fileKey(file.path, context, ws);
  const { generation } = cur;
  const set = (f: FileState) => put(tab, (s) => (s.generation === generation ? { ...s, files: new Map(s.files).set(key, f) } : s));
  set({ loading: true, error: null, diff: null });
  try {
    const diff = await loadFileDiff(tab, { kind: 'pair', ...pair }, {
      path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), ...(file.status === '?' ? { untracked: true } : {}), context, whitespace: ws,
    });
    set({ loading: false, error: null, diff });
  } catch (e) {
    set({ loading: false, error: toError(e), diff: null });
  }
}

export const setSelection = (tab: Tab, selected: string[], viewed: string | null): void => put(tab, (s) => ({ ...s, selected, viewed }));
export const forceFile = (tab: Tab, path: string): void => put(tab, (s) => ({ ...s, forced: [...s.forced, path] }));
export const setNotice = (tab: Tab, notice: string | null): void => put(tab, (s) => ({ ...s, notice }));
