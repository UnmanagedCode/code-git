import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { highlightLines, HIGHLIGHT_MAX_LINES, type Tokenize } from '@/features/diff/highlight';
import { jumpStore } from '@/features/graph/jump';
import { actionsFor, labelOf } from '@/shell/menus';
import { setPrefs } from '@/state/diff';
import { shownPanelStore } from '@/state/shownPanel';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { oid } from '@/test/graphData';
import { stubFetch } from '@/test/stubFetch';
import { BLAME_RUN_CONTEXT } from './actions';
import type { BlameCommit, BlameLine } from './api';
import { blameSegments } from './blameHighlight';
import { HistoryPanel } from './HistoryPanel';
import { HISTORY_PANEL_ID, openBlame } from './open';
import { fileHistoryOf } from './state';

const TAB = { project: 'app', worktree: null };
const REV = oid(9);
const PAGE = 3;
const O1 = oid(1);
const O2 = oid(2);

const original = Element.prototype.scrollIntoView;
let scrolled: Element[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
});
afterEach(() => { Element.prototype.scrollIntoView = original; });

const commit = (over: Partial<BlameCommit> = {}): BlameCommit => ({ author: 'Ann', mail: 'a@x', time: 1, summary: 's', filename: 'f.js', previous: null, previousPath: null, ...over });
const line = (n: number, o: string, text: string, origLine = n): BlameLine => ({ n, oid: o, origLine, text });

interface Frame { lines: BlameLine[]; commits: Record<string, BlameCommit>; total?: number }

/** history.blame answered from `frames` (keyed "rev path") in pages of PAGE lines from the request's `start`. */
function world(frames: Record<string, Frame>, hold?: (key: string, start: number) => Promise<void> | undefined) {
  return stubFetch({
    'POST api/ops/history.blame': async (_u: URL, init?: RequestInit) => {
      const { params: p } = JSON.parse(String(init!.body)) as { params: { rev: string; path: string; start: number } };
      const key = `${p.rev} ${p.path}`;
      await hold?.(key, p.start);
      const f = frames[key];
      if (!f) throw new Error(`no blame stubbed for ${key}`);
      return { ok: true, result: { total: f.total ?? f.lines.length, lines: f.lines.slice(p.start - 1, p.start - 1 + PAGE), commits: f.commits } };
    },
    'POST api/ops/history.file': { ok: true, result: { items: [], nextCursor: null, truncated: false } },
    'POST api/ops/diff.file': { ok: true, result: { path: 'f.js', oldPath: null, hunks: [], binary: false, lfs: null, submodule: null, unmerged: false, oldMode: '100644', newMode: '100644' } },
  });
}
const blameParams = (f: ReturnType<typeof stubFetch>) => f.calls.filter((c) => c.url.pathname.endsWith('history.blame')).map((c) => (c.body as { params: Record<string, unknown> }).params);

async function showBlame(path = 'f.js') {
  render(<HistoryPanel tab={TAB} />);
  act(() => openBlame(TAB, { path, rev: REV }));
  return screen.findByRole('table', { name: 'Blame' });
}

const lineCode = (table: HTMLElement, n: number) => table.querySelector(`[data-blame-line="${n}"] [role="cell"]:last-child`)!;
/** A rendered line's non-empty segments as [text, class]. */
const rendered = (table: HTMLElement, n: number) => [...lineCode(table, n).children].map((s) => [s.textContent, s.getAttribute('class') || null]);

const realTokenize = async (): Promise<Tokenize> => (await import('@/features/diff/highlight/prism')).tokenize;

// A two-frame file: line 1 by O1 (added there), lines 2–3 by O2 (which edited it), pages of PAGE lines.
const TWO_RUNS = {
  commits: { [O1]: commit(), [O2]: commit({ author: 'Bob', previous: O1, previousPath: 'f.js' }) },
  lines: [line(1, O1, 'a'), line(2, O2, 'b'), line(3, O2, 'c'), line(4, O1, 'd'), line(5, O1, 'e'), line(6, O1, 'f')],
};
const BEFORE: Frame = { commits: { [O1]: commit() }, lines: [line(1, O1, 'a'), line(2, O1, 'B'), line(3, O1, 'c'), line(4, O1, 'd'), line(5, O1, 'e'), line(6, O1, 'f')] };
const drillButton = (table: HTMLElement) => within(table).getByRole('button', { name: `${O2.slice(0, 7)} Bob: blame previous revision` });

// Invariant: blame colours a line exactly as the diff would colour the whole file: with a block comment crossing a page
// boundary and a run boundary, and a template literal crossing a run boundary, each rendered line's segments equal the
// reference highlightLines of the full text.
test('highlighting across pages and runs equals the whole-file highlight', async () => {
  const text = ['let a = 1;', '/* one', '   two', '   three */', 'const t = `x', 'y`;'];
  const owner = [O1, O1, O2, O2, O1, O2];
  const lines = text.map((t, i) => line(i + 1, owner[i], t));
  world({ [`${REV} f.js`]: { lines, commits: { [O1]: commit(), [O2]: commit({ author: 'Bob' }) } } });
  const table = await showBlame();
  const expected = highlightLines(text.join('\n'), 'javascript', await realTokenize());
  expect(expected[3][0].cls).toBeTruthy();
  await waitFor(() => expect(table.querySelectorAll('[data-blame-line]')).toHaveLength(PAGE));
  await userEvent.click(screen.getByRole('button', { name: 'Load more lines' }));
  await waitFor(() => expect(table.querySelectorAll('[data-blame-line]')).toHaveLength(6));
  await waitFor(() => expect(rendered(table, 4)[0][1]).toBeTruthy());
  for (let n = 1; n <= 6; n++) expect(rendered(table, n)).toEqual(expected[n - 1].filter((s) => s.text).map((s) => [s.text, s.cls]));
});

// Invariant: a file over the highlighter's line cap is plain from the start (the tokenizer is never called), and the
// shared Syntax pref off gives plain lines, on gives tokens.
test('a file over HIGHLIGHT_MAX_LINES stays plain, and the Syntax pref is honoured', async () => {
  const tokenize = vi.fn<Tokenize>(() => []);
  const lines = [line(1, O1, 'const a = 1;')];
  expect(blameSegments(lines, HIGHLIGHT_MAX_LINES + 1, 'f.js', tokenize)).toBeNull();
  expect(tokenize).not.toHaveBeenCalled();
  expect(blameSegments(lines, 1, 'f.js', tokenize)).not.toBeNull();

  world({
    [`${REV} f.js`]: { lines: [line(1, O1, 'const a = 1;')], commits: { [O1]: commit() } },
    [`${REV} big.js`]: { total: HIGHLIGHT_MAX_LINES + 1, lines: [line(1, O1, 'const a = 1;')], commits: { [O1]: commit() } },
  });
  act(() => setPrefs({ syntax: false }));
  const table = await showBlame();
  await waitFor(() => expect(table.querySelectorAll('[data-blame-line]')).toHaveLength(1));
  await act(async () => { await realTokenize(); });
  expect(table.querySelector('[data-token]')).toBeNull();
  act(() => setPrefs({ syntax: true }));
  await waitFor(() => expect(table.querySelector('[data-token]')).toBeTruthy());
  act(() => openBlame(TAB, { path: 'big.js', rev: REV }));
  await waitFor(() => expect(fileHistoryOf(TAB)?.blameStack[0].blame.total).toBe(HIGHLIGHT_MAX_LINES + 1));
  await act(async () => { await realTokenize(); });
  const big = screen.getByRole('table', { name: 'Blame' });
  expect(big.querySelectorAll('[data-blame-line]')).toHaveLength(1);
  expect(big.querySelector('[data-token]')).toBeNull();
});

// Invariant: a run's click is the previous-revision drill, following renames: it blames `previous` under `previousPath`
// from line 1 and the breadcrumb then lists both frames.
test('drill requests the previous revision under its old name', async () => {
  const f = world({
    [`${REV} new.txt`]: { commits: { [O2]: commit({ author: 'Bob', filename: 'new.txt', previous: O1, previousPath: 'old.txt' }) }, lines: [line(1, O2, 'x')] },
    [`${O1} old.txt`]: { commits: { [O1]: commit({ filename: 'old.txt' }) }, lines: [line(1, O1, 'x')] },
  });
  const table = await showBlame('new.txt');
  await userEvent.click(await within(table).findByRole('button', { name: `${O2.slice(0, 7)} Bob: blame previous revision` }));
  await waitFor(() => expect(blameParams(f).at(-1)).toMatchObject({ rev: O1, path: 'old.txt', start: 1 }));
  const nav = screen.getByRole('navigation', { name: 'Blame revisions' });
  await waitFor(() => expect(within(nav).getByText(new RegExp(`^${O1.slice(0, 7)} old.txt`))).toBeTruthy());
  expect(nav.textContent).toContain(`${REV.slice(0, 7)} new.txt`);
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain(O1.slice(0, 7));
});

// Invariant: after a drill the user lands near the clicked line: pages load serially up to the line's number in the
// clicked commit, then it is scrolled into view.
test('drill loads pages up to the focus line and centres it', async () => {
  const f = world({
    [`${REV} f.js`]: { commits: TWO_RUNS.commits, lines: [line(1, O2, 'a', 5), line(2, O2, 'b', 6), line(3, O1, 'c')], total: 3 },
    [`${O1} f.js`]: BEFORE,
  });
  const table = await showBlame();
  await userEvent.click(await within(table).findByRole('button', { name: `${O2.slice(0, 7)} Bob: blame previous revision` }));
  await waitFor(() => expect(scrolled.some((e) => e.getAttribute('data-blame-line') === '5')).toBe(true));
  expect(blameParams(f).filter((p) => p.rev === O1).map((p) => p.start)).toEqual([1, 4]);
});

// Invariant: the drill stack caches frames: Back (or the first crumb) restores the earlier frame with no request and
// scrolls to the line that was clicked there.
test('Back is free and returns to the clicked line', async () => {
  const f = world({ [`${REV} f.js`]: TWO_RUNS, [`${O1} f.js`]: BEFORE });
  const table = await showBlame();
  await userEvent.click(await within(table).findByRole('button', { name: `${O2.slice(0, 7)} Bob: blame previous revision` }));
  await waitFor(() => expect(scrolled.some((e) => e.getAttribute('data-blame-line') === '2')).toBe(true));
  scrolled = [];
  const requests = blameParams(f).length;
  await userEvent.click(screen.getByRole('button', { name: `Back to ${REV.slice(0, 7)}` }));
  const back = await screen.findByRole('table', { name: 'Blame' });
  expect(back.querySelectorAll('[data-blame-line]')).toHaveLength(PAGE);
  await waitFor(() => expect(scrolled.map((e) => e.getAttribute('data-blame-line'))).toEqual(['2']));
  expect(blameParams(f)).toHaveLength(requests);
  expect(fileHistoryOf(TAB)?.blameStack).toHaveLength(1);
  // The crumb of the earlier frame does the same.
  await userEvent.click(within(back.ownerDocument.body).getByRole('button', { name: `${O2.slice(0, 7)} Bob: blame previous revision` }));
  await waitFor(() => expect(fileHistoryOf(TAB)?.blameStack).toHaveLength(2));
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Blame revisions' })).getByRole('button', { name: new RegExp(`^${REV.slice(0, 7)}`) }));
  await waitFor(() => expect(fileHistoryOf(TAB)?.blameStack).toHaveLength(1));
  expect(blameParams(f)).toHaveLength(requests + 1);
});

// Invariant: a page lands only in the frame that asked for it: a drill's response arriving after Back changes nothing.
test('a late page goes nowhere', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  world({ [`${REV} f.js`]: TWO_RUNS, [`${O1} f.js`]: BEFORE }, (key) => (key.startsWith(O1) ? gate : undefined));
  const table = await showBlame();
  await userEvent.click(await within(table).findByRole('button', { name: `${O2.slice(0, 7)} Bob: blame previous revision` }));
  await userEvent.click(await screen.findByRole('button', { name: `Back to ${REV.slice(0, 7)}` }));
  const before = fileHistoryOf(TAB)!.blameStack;
  await act(async () => { release(); await gate; });
  await act(async () => { await Promise.resolve(); });
  const after = fileHistoryOf(TAB)!.blameStack;
  expect(after).toHaveLength(1);
  expect(after[0].blame.lines).toHaveLength(before[0].blame.lines.length);
  expect(after[0].blame.loading).toBe(false);
});

// Invariant: a page requested by frame A that arrives after A was buried by a drill lands in A: Back to A shows those
// lines, A is no longer loading, and no new history.blame request is made.
test('a page that arrives after its frame was buried lands in that frame', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const f = world({ [`${REV} f.js`]: TWO_RUNS, [`${O1} f.js`]: BEFORE }, (key, start) => (key === `${REV} f.js` && start > 1 ? gate : undefined));
  const table = await showBlame();
  await userEvent.click(await screen.findByRole('button', { name: 'Load more lines' }));
  await waitFor(() => expect(fileHistoryOf(TAB)?.blameStack[0].blame.loading).toBe(true));
  await userEvent.click(await within(table).findByRole('button', { name: `${O2.slice(0, 7)} Bob: blame previous revision` }));
  await waitFor(() => expect(fileHistoryOf(TAB)?.blameStack).toHaveLength(2));
  await waitFor(() => expect(fileHistoryOf(TAB)?.blameStack[1].blame.lines.length).toBeGreaterThan(0));
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(fileHistoryOf(TAB)?.blameStack[0].blame.lines).toHaveLength(6));
  const requests = blameParams(f).length;
  await userEvent.click(screen.getByRole('button', { name: `Back to ${REV.slice(0, 7)}` }));
  const back = await screen.findByRole('table', { name: 'Blame' });
  expect(back.querySelectorAll('[data-blame-line]')).toHaveLength(6);
  expect(fileHistoryOf(TAB)?.blameStack[0].blame.loading).toBe(false);
  expect(blameParams(f)).toHaveLength(requests);
});

// Invariant: a run with no earlier version (the commit that added the file) cannot drill and says so: aria-disabled with
// its own label, no request on click, and no "Blame previous revision" in its menu.
test('a run with no earlier version cannot drill', async () => {
  const f = world({ [`${REV} f.js`]: TWO_RUNS });
  const table = await showBlame();
  const added = await within(table).findByRole('button', { name: `${O1.slice(0, 7)} Ann: no earlier version (this commit added the file)` });
  expect(added.getAttribute('aria-disabled')).toBe('true');
  expect(added.querySelector('[data-added]')).toBeTruthy();
  const requests = blameParams(f).length;
  await userEvent.click(added);
  expect(blameParams(f)).toHaveLength(requests);
  expect(fileHistoryOf(TAB)?.blameStack).toHaveLength(1);
  fireEvent.contextMenu(table.querySelector('[data-blame-line="1"]')!);
  const menu = await screen.findByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Show in History', 'Show in graph', 'Copy SHA']);
});

// Invariant: the old primary actions survive as the run menu's secondary ones: Show in History picks the commit with its
// oldPath (a rename-with-edit commit diffs against the old name), Show in graph closes the panel and requests the jump.
test('the run menu: Blame previous revision, Show in History, Show in graph, Copy SHA', async () => {
  const c = commit({ author: 'Bob', filename: 'new.txt', previous: O1, previousPath: 'old.txt' });
  const ctx = { tab: TAB, line: line(1, O2, 'x'), commit: c, path: 'new.txt' };
  expect(actionsFor(BLAME_RUN_CONTEXT, ctx).map((a) => labelOf(a, ctx))).toEqual(['Blame previous revision', 'Show in History', 'Show in graph', 'Copy SHA']);
  world({ [`${REV} new.txt`]: { commits: { [O2]: c }, lines: [line(1, O2, 'x')] } });
  const table = await showBlame('new.txt');
  fireEvent.contextMenu(await within(table).findByText('x'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Show in History' }));
  expect(fileHistoryOf(TAB)).toMatchObject({ view: 'history', picked: { oid: O2, path: 'new.txt', oldPath: 'old.txt' } });
  await userEvent.click(screen.getByRole('button', { name: 'Blame' }));
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${O2.slice(0, 7)}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Show in graph' }));
  expect(shownPanelStore.get().get(tabKey(TAB))).not.toBe(HISTORY_PANEL_ID);
  expect(jumpStore.get()).toMatchObject({ oid: O2 });
});
