import { pruneClosedTabs } from '@/state/shownPanel';
import { createStore, useStore } from '@/state/store';
import { tabKey, tabsStore, type Tab } from '@/state/tabs';
import { loadBlame, loadFileHistory, loadReflog, type BlameCommit, type BlameLine, type HistoryItem, type ReflogItem } from './api';

// Per checkout (tabKey): the open file history (with its blame) and the open reflog. Not persisted.

export interface Picked { oid: string; path: string; oldPath: string | null }
export interface Paged<T> { items: T[]; next: number | null; loading: boolean; error: string | null }
export interface BlameState { total: number | null; lines: BlameLine[]; commits: Record<string, BlameCommit>; loading: boolean; error: string | null; code: string | null }
export interface FileHistoryState {
  /** The file as the user opened it, and the commit the history and blame start from (frozen). */
  path: string;
  rev: string;
  view: 'history' | 'blame';
  history: Paged<HistoryItem> & { truncated: boolean };
  /** The commit whose change the viewer shows. */
  picked: Picked | null;
  /** The blame drill: `[0]` is the opened (rev, path); the last frame is the one shown. */
  blameStack: BlameFrame[];
}
export interface BlameFrame {
  id: number;
  rev: string;
  path: string;
  blame: BlameState;
  /** A line to bring into view once loaded (cleared after scrolling). */
  focus: number | null;
  /** The line clicked to drill from this frame (where Back returns to). */
  anchor: number | null;
}
export interface ReflogState { ref: string; page: Paged<ReflogItem> }

const pagedEmpty = <T>(): Paged<T> => ({ items: [], next: 0, loading: false, error: null });
const blameEmpty = (): BlameState => ({ total: null, lines: [], commits: {}, loading: false, error: null, code: null });
let frameSeq = 0;
const newFrame = (rev: string, path: string, focus: number | null = null): BlameFrame => ({ id: ++frameSeq, rev, path, blame: blameEmpty(), focus, anchor: null });
export const topFrame = (s: FileHistoryState): BlameFrame => s.blameStack[s.blameStack.length - 1];

export const fileHistoryStore = createStore<ReadonlyMap<string, FileHistoryState>>(new Map());
export const reflogStore = createStore<ReadonlyMap<string, ReflogState>>(new Map());
tabsStore.subscribe(() => { pruneClosedTabs(fileHistoryStore); pruneClosedTabs(reflogStore); });
let epoch = 0;
export function resetHistory(): void {
  epoch++;
  fileHistoryStore.set(new Map());
  reflogStore.set(new Map());
}

export const fileHistoryOf = (tab: Tab): FileHistoryState | null => fileHistoryStore.get().get(tabKey(tab)) ?? null;
export const reflogOf = (tab: Tab): ReflogState | null => reflogStore.get().get(tabKey(tab)) ?? null;
export const useFileHistory = (tab: Tab): FileHistoryState | null => useStore(fileHistoryStore).get(tabKey(tab)) ?? null;
export const useReflog = (tab: Tab): ReflogState | null => useStore(reflogStore).get(tabKey(tab)) ?? null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const codeOf = (e: unknown) => (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : null);

function putFile(tab: Tab, f: (s: FileHistoryState) => FileHistoryState): void {
  fileHistoryStore.set((m) => {
    const cur = m.get(tabKey(tab));
    return cur ? new Map(m).set(tabKey(tab), f(cur)) : m;
  });
}
const putReflog = (tab: Tab, f: (s: ReflogState) => ReflogState): void => reflogStore.set((m) => {
  const cur = m.get(tabKey(tab));
  return cur ? new Map(m).set(tabKey(tab), f(cur)) : m;
});

/** A fresh history of `path` from `rev`. */
export function startFileHistory(tab: Tab, path: string, rev: string, view: FileHistoryState['view']): void {
  fileHistoryStore.set((m) => new Map(m).set(tabKey(tab), {
    path, rev, view, history: { ...pagedEmpty<HistoryItem>(), truncated: false }, picked: null, blameStack: [newFrame(rev, path)],
  }));
}

/** Loads the next history page (the first when none is loaded); a load already running is not repeated. */
export async function loadMoreHistory(tab: Tab): Promise<void> {
  const s = fileHistoryOf(tab);
  if (!s || s.history.loading || s.history.next === null) return;
  const at = epoch;
  const { path, rev } = s;
  const skip = s.history.next;
  putFile(tab, (x) => ({ ...x, history: { ...x.history, loading: true, error: null } }));
  const still = (x: FileHistoryState) => at === epoch && x.path === path && x.rev === rev;
  try {
    const page = await loadFileHistory(tab, { rev, path, skip });
    putFile(tab, (x) => (still(x) ? {
      ...x,
      history: { items: [...x.history.items, ...page.items], next: page.nextCursor, loading: false, error: null, truncated: page.truncated },
      // The newest commit is shown first.
      picked: x.picked ?? (page.items[0] ? { oid: page.items[0].oid, path: page.items[0].path, oldPath: page.items[0].oldPath } : null),
    } : x));
  } catch (e) {
    putFile(tab, (x) => (still(x) ? { ...x, history: { ...x.history, loading: false, error: message(e) } } : x));
  }
}

const putTop = (tab: Tab, f: (b: BlameFrame) => BlameFrame): void => putFile(tab, (x) => ({ ...x, blameStack: [...x.blameStack.slice(0, -1), f(topFrame(x))] }));

/** Loads the next blame page of the shown frame (lines `lines.length + 1…`); a page lands only in the frame that asked, if it is still in the stack. */
export async function loadMoreBlame(tab: Tab): Promise<void> {
  const s = fileHistoryOf(tab);
  if (!s) return;
  const top = topFrame(s);
  const b = top.blame;
  if (b.loading || (b.total !== null && b.lines.length >= b.total) || b.error) return;
  const at = epoch;
  const { rev, path, id } = top;
  putTop(tab, (f) => ({ ...f, blame: { ...f.blame, loading: true } }));
  // By frame id: a frame a drill buried still gets its page; one a Back removed does not.
  const put = (f: (b: BlameFrame) => BlameFrame) => putFile(tab, (x) => (at === epoch && x.blameStack.some((b) => b.id === id) ? { ...x, blameStack: x.blameStack.map((b) => (b.id === id ? f(b) : b)) } : x));
  try {
    const page = await loadBlame(tab, { rev, path, start: b.lines.length + 1 });
    put((f) => ({
      ...f, blame: { total: page.total, lines: [...f.blame.lines, ...page.lines], commits: { ...f.blame.commits, ...page.commits }, loading: false, error: null, code: null },
    }));
  } catch (e) {
    put((f) => ({ ...f, blame: { ...f.blame, loading: false, error: message(e), code: codeOf(e) } }));
  }
}

/** Loads pages serially (contiguous from line 1, as highlighting needs) until line `n` is loaded, the file ends, an error, or the frame changes. */
async function loadBlameThrough(tab: Tab, n: number): Promise<void> {
  const id = fileHistoryOf(tab) && topFrame(fileHistoryOf(tab)!).id;
  for (;;) {
    const s = fileHistoryOf(tab);
    if (!s || topFrame(s).id !== id) return;
    const b = topFrame(s).blame;
    if (b.error || (b.total !== null && b.lines.length >= Math.min(n, b.total))) return;
    const had = b.lines.length;
    await loadMoreBlame(tab);
    const after = fileHistoryOf(tab);
    if (!after || topFrame(after).id !== id || topFrame(after).blame.lines.length === had) return;
  }
}

/** Blames the file as it was before `line`'s commit (under its name there), keeping the shown frame to come back to. */
export function drillBlame(tab: Tab, line: BlameLine): void {
  const s = fileHistoryOf(tab);
  if (!s) return;
  const top = topFrame(s);
  const c = top.blame.commits[line.oid];
  if (!c?.previous) return;
  const next = newFrame(c.previous, c.previousPath ?? c.filename, line.origLine);
  putFile(tab, (x) => ({ ...x, blameStack: [...x.blameStack.slice(0, -1), { ...top, anchor: line.n }, next] }));
  void loadBlameThrough(tab, line.origLine);
}

/** Back to frame `index`, scrolled to the line that was clicked there. */
export function blameBack(tab: Tab, index: number): void {
  putFile(tab, (x) => {
    if (index < 0 || index >= x.blameStack.length - 1) return x;
    const stack = x.blameStack.slice(0, index + 1);
    const top = stack[index];
    stack[index] = { ...top, focus: top.anchor };
    return { ...x, blameStack: stack };
  });
}

export const clearBlameFocus = (tab: Tab, frameId: number): void => putFile(tab, (x) => ({
  ...x, blameStack: x.blameStack.map((f) => (f.id === frameId && f.focus !== null ? { ...f, focus: null } : f)),
}));

export const setFileView = (tab: Tab, view: FileHistoryState['view']): void => putFile(tab, (x) => ({ ...x, view }));
export const pickCommit = (tab: Tab, picked: Picked): void => putFile(tab, (x) => ({ ...x, picked }));
export const clearFileHistory = (tab: Tab): void => fileHistoryStore.set((m) => { const n = new Map(m); n.delete(tabKey(tab)); return n; });

/** A fresh reflog of `ref` ('HEAD' or refs/heads/…), loaded from its newest entry. */
export function startReflog(tab: Tab, ref: string): void {
  reflogStore.set((m) => new Map(m).set(tabKey(tab), { ref, page: pagedEmpty<ReflogItem>() }));
}

export async function loadMoreReflog(tab: Tab): Promise<void> {
  const s = reflogOf(tab);
  if (!s || s.page.loading || s.page.next === null) return;
  const at = epoch;
  const { ref } = s;
  const skip = s.page.next;
  putReflog(tab, (x) => ({ ...x, page: { ...x.page, loading: true, error: null } }));
  try {
    const page = await loadReflog(tab, { ref, skip });
    putReflog(tab, (x) => (at === epoch && x.ref === ref ? { ...x, page: { items: [...x.page.items, ...page.items], next: page.nextCursor, loading: false, error: null } } : x));
  } catch (e) {
    putReflog(tab, (x) => (at === epoch && x.ref === ref ? { ...x, page: { ...x.page, loading: false, error: message(e) } } : x));
  }
}
