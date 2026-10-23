import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { actionsFor, labelOf } from '@/shell/menus';
import { shownPanelStore } from '@/state/shownPanel';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { refDialogStore } from '@/state/refDialog';
import { oid, ref, refsResult } from '@/test/graphData';
import { stubFetch } from '@/test/stubFetch';
import { BLAME_PAGE, HISTORY_PAGE, type BlamePage, type HistoryItem } from './api';
import { REFLOG_CONTEXT } from './actions';
import { authorClasses } from './authorColors';
import { HistoryPanel } from './HistoryPanel';
import { HISTORY_PANEL_ID, openBlame, openFileHistory, openReflog, REFLOG_PANEL_ID } from './open';
import { ReflogPanel } from './ReflogPanel';
import { fileHistoryOf } from './state';

const TAB = { project: 'app', worktree: null };
const REV = oid(9);
const item = (n: number, over: Partial<HistoryItem> = {}): HistoryItem => ({
  oid: oid(n), parents: [oid(n - 1)], author: 'Ann', email: 'a@x', time: 1_700_000_000, subject: `subject ${n}`, status: 'M', path: 'c.txt', oldPath: null, ...over,
});
const fileDiff = { path: 'c.txt', oldPath: null, hunks: [], binary: false, lfs: null, submodule: null, unmerged: false, oldMode: '100644', newMode: '100644' };
const params = (f: ReturnType<typeof stubFetch>, op: string) => f.calls.filter((c) => c.url.pathname.endsWith(op)).map((c) => (c.body as { params: unknown }).params);

function open() {
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  graphStore.set(new Map([[tabKey(TAB), { ...EMPTY_GRAPH, refs: refsResult({ head: { oid: REV, branch: 'refs/heads/main', detached: false, unborn: false }, refs: [ref('refs/heads/main', REV), ref('refs/heads/feat', oid(8))] }) }]]));
}

// Invariant: the UI's page sizes mirror the backend's HISTORY_LIMITS.
test('HISTORY_PAGE and BLAME_PAGE mirror HISTORY_LIMITS', async () => {
  const backend = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src/git/history/limits.js')).href;
  const { HISTORY_LIMITS } = (await import(/* @vite-ignore */ backend)) as { HISTORY_LIMITS: { pageMax: number; blameLinesMax: number } };
  expect([HISTORY_PAGE, BLAME_PAGE]).toEqual([HISTORY_LIMITS.pageMax, HISTORY_LIMITS.blameLinesMax]);
});

// Invariant: file history shows each commit with a "renamed from" marker for a rename, pages on Load more from nextCursor
// with the frozen rev, and the newest commit's change loads in the viewer (diff.file of that commit and its path then).
test('file history: pages, the rename marker, the viewer', async () => {
  open();
  const f = stubFetch({
    'POST api/ops/history.file': (_u: URL, init?: RequestInit) => {
      const { params: p } = JSON.parse(String(init!.body)) as { params: { skip: number } };
      return p.skip === 0
        ? { ok: true, result: { items: [item(5, { status: 'R100', oldPath: 'b.txt' }), item(4, { path: 'b.txt' })], nextCursor: 2, truncated: false } }
        : { ok: true, result: { items: [item(3, { path: 'b.txt', status: 'A' })], nextCursor: null, truncated: false } };
    },
    'POST api/ops/diff.file': { ok: true, result: fileDiff },
  });
  render(<HistoryPanel tab={TAB} />);
  act(() => openFileHistory(TAB, { path: 'c.txt', rev: REV }));
  expect(shownPanelStore.get().get(tabKey(TAB))).toBe(HISTORY_PANEL_ID);
  const list = await screen.findByRole('listbox', { name: 'File history' });
  await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
  expect(within(list).getAllByRole('option')[0].textContent).toContain('renamed from b.txt');
  expect(list.querySelectorAll('[data-renamed]')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
  expect(params(f, 'history.file')).toEqual([{ rev: REV, path: 'c.txt', skip: 0, limit: HISTORY_PAGE }, { rev: REV, path: 'c.txt', skip: 2, limit: HISTORY_PAGE }]);
  expect(screen.getByText('3 commits')).toBeTruthy();
  await waitFor(() => expect(params(f, 'diff.file')[0]).toMatchObject({ source: { kind: 'commit', rev: oid(5) }, path: 'c.txt', oldPath: 'b.txt' }));
  await userEvent.click(within(list).getAllByRole('option')[1]);
  await waitFor(() => expect(params(f, 'diff.file').at(-1)).toMatchObject({ source: { kind: 'commit', rev: oid(4) }, path: 'b.txt' }));
});

const blame: BlamePage = {
  total: 4,
  lines: [
    { n: 1, oid: oid(1), origLine: 1, text: 'a' }, { n: 2, oid: oid(1), origLine: 2, text: 'b' },
    { n: 3, oid: oid(2), origLine: 1, text: 'c' }, { n: 4, oid: oid(1), origLine: 3, text: 'd' },
  ],
  commits: {
    [oid(1)]: { author: 'Ann', mail: 'a@x', time: 1, summary: 'one', filename: 'f.txt', previous: null },
    [oid(2)]: { author: 'Bob', mail: 'b@x', time: 2, summary: 'two', filename: 'f.txt', previous: oid(1) },
  },
};

// Invariant: blame marks a run's first line (oid, author) only; author classes are by first appearance; a gutter click
// picks that commit in File history.
test('blame: runs, deterministic author colours, gutter → history', async () => {
  open();
  stubFetch({
    'POST api/ops/history.blame': { ok: true, result: blame },
    'POST api/ops/history.file': { ok: true, result: { items: [], nextCursor: null, truncated: false } },
    'POST api/ops/diff.file': { ok: true, result: fileDiff },
  });
  render(<HistoryPanel tab={TAB} />);
  act(() => openBlame(TAB, { path: 'f.txt', rev: REV }));
  const table = await screen.findByRole('table', { name: 'Blame' });
  await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
  const runs = within(table).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
  expect(runs).toEqual([`${oid(1).slice(0, 7)} Ann: show in history`, `${oid(2).slice(0, 7)} Bob: show in history`, `${oid(1).slice(0, 7)} Ann: show in history`]);
  const cls = (n: number) => table.querySelector(`[data-blame-line="${n}"] [role="cell"]`)!.className;
  expect(cls(1)).toContain('lane-0');
  expect(cls(3)).toContain('lane-1');
  expect(cls(4)).toContain('lane-0');
  expect(screen.getByText('4 lines')).toBeTruthy();
  expect([...authorClasses(['Bob', 'Ann', 'Bob', 'Cy'])]).toEqual([['Bob', 'lane-0'], ['Ann', 'lane-1'], ['Cy', 'lane-2']]);
  await userEvent.click(within(table).getAllByRole('button')[1]);
  expect(fileHistoryOf(TAB)).toMatchObject({ view: 'history', picked: { oid: oid(2), path: 'f.txt' } });
});

// Invariant: blame of a binary file says so (BINARY_FILE) instead of lines.
test('blame of a binary file', async () => {
  open();
  stubFetch({
    'POST api/ops/history.blame': new Response(JSON.stringify({ error: 'binary', code: 'BINARY_FILE' }), { status: 409, headers: { 'content-type': 'application/json' } }),
    'POST api/ops/history.file': { ok: true, result: { items: [], nextCursor: null, truncated: false } },
  });
  render(<HistoryPanel tab={TAB} />);
  act(() => openBlame(TAB, { path: 'bin.dat', rev: REV }));
  expect((await screen.findByRole('alert')).textContent).toBe('A binary file has no blame.');
});

// Invariant: the reflog lists selector, action, sha and subject per entry; its row menu offers the reflog-entry actions.
test('reflog rows and the reflog-entry menu', async () => {
  open();
  const f = stubFetch({
    'POST api/ops/history.reflog': { ok: true, result: { items: [{ selector: 'HEAD@{0}', oid: oid(7), time: 1, action: 'commit: x', who: { name: 'Ann', email: 'a@x' }, subject: 'x' }], nextCursor: null } },
  });
  render(<ReflogPanel tab={TAB} />);
  act(() => openReflog(TAB));
  expect(shownPanelStore.get().get(tabKey(TAB))).toBe(REFLOG_PANEL_ID);
  const rows = await screen.findByRole('list', { name: 'Reflog entries' });
  await waitFor(() => expect(within(rows).getAllByRole('listitem')).toHaveLength(1));
  expect(within(rows).getByRole('listitem').textContent).toContain('HEAD@{0}');
  expect(within(rows).getByRole('listitem').textContent).toContain('commit: x');
  await userEvent.click(screen.getByRole('button', { name: 'Actions for HEAD@{0}' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['View changes', 'Create branch here…', 'Reset HEAD to here', 'Copy SHA']);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Create branch here…' }));
  expect(refDialogStore.get()).toMatchObject({ kind: 'createBranch', from: { oid: oid(7), label: 'HEAD@{0}' } });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reflog of' }), 'refs/heads/feat');
  await waitFor(() => expect(params(f, 'history.reflog').at(-1)).toEqual({ ref: 'refs/heads/feat', skip: 0, limit: HISTORY_PAGE }));
});

// Invariant: File history and Blame are offered on a commit's file, a diff's file and a tracked Changes row; Show reflog on a
// local branch only; Blame not for a file the commit deletes.
test('the history menu items in their contexts', () => {
  open();
  const labels = (context: string, ctx: unknown) => actionsFor(context, ctx).map((a) => labelOf(a, ctx));
  const file = (status: string) => ({ tab: TAB, commit: oid(5), parent: oid(4), file: { status, path: 'a.txt', oldPath: null } });
  expect(labels('file', file('M'))).toEqual(expect.arrayContaining(['File history', 'Blame']));
  expect(labels('file', file('D'))).toContain('File history');
  expect(labels('file', file('D'))).not.toContain('Blame');
  const row = (status: string) => ({ tab: TAB, section: 'unstaged', file: { path: 'a.txt', oldPath: null, status } });
  expect(labels('workdir-file', row('M'))).toEqual(expect.arrayContaining(['File history', 'Blame']));
  expect(labels('workdir-file', row('?'))).not.toContain('File history');
  expect(labels('diff-file', { tab: TAB, files: [{ path: 'a.txt', status: 'M' }], source: { kind: 'unstaged' } })).toEqual(expect.arrayContaining(['File history', 'Blame']));
  expect(labels('branch', { tab: TAB, ref: ref('refs/heads/feat', oid(8)) })).toContain('Show reflog');
  expect(labels('branch', { tab: TAB, ref: ref('refs/remotes/origin/feat', oid(8)) })).not.toContain('Show reflog');
  expect(labels(REFLOG_CONTEXT, { tab: TAB, entry: { selector: 'HEAD@{0}', oid: oid(7) } })).toEqual(['View changes', 'Create branch here…', 'Reset HEAD to here', 'Copy SHA']);
});

// Invariant: a commit subject, an author and a blame line holding markup render as text, never as elements.
test('markup in subjects, authors and lines is text', async () => {
  open();
  const evil = '<img src=x onerror=alert(1)>';
  stubFetch({
    'POST api/ops/history.file': { ok: true, result: { items: [item(5, { subject: evil, author: evil })], nextCursor: null, truncated: false } },
    'POST api/ops/history.blame': { ok: true, result: { total: 1, lines: [{ n: 1, oid: oid(5), origLine: 1, text: evil }], commits: { [oid(5)]: { ...blame.commits[oid(1)], author: evil, summary: evil } } } },
    'POST api/ops/diff.file': { ok: true, result: fileDiff },
  });
  render(<HistoryPanel tab={TAB} />);
  act(() => openBlame(TAB, { path: 'c.txt', rev: REV }));
  await screen.findAllByText(evil);
  act(() => openFileHistory(TAB, { path: 'c.txt', rev: REV }));
  await waitFor(() => expect(screen.getAllByText(evil).length).toBeGreaterThan(0));
  expect(document.querySelector('img')).toBeNull();
});

// Invariant: the palette's File history… picks from history.paths at HEAD (or the typed path), and opens that file at HEAD;
// a list over its cap (OUTPUT_TOO_LARGE) leaves only the typed path.
test('palette: File history… picks a HEAD path or a typed one', async () => {
  open();
  const { HISTORY_COMMANDS } = await import('./commands');
  const cmd = HISTORY_COMMANDS.find((c) => c.id === 'history.file')!;
  let tooLarge = false;
  const f = stubFetch({
    'POST api/ops/history.paths': () => (tooLarge
      ? new Response(JSON.stringify({ error: 'big', code: 'OUTPUT_TOO_LARGE' }), { status: 422, headers: { 'content-type': 'application/json' } })
      : { ok: true, result: { paths: ['a.txt', 'src/b.ts'] } }),
    'POST api/ops/history.file': { ok: true, result: { items: [], nextCursor: null, truncated: false } },
  });
  expect(await cmd.pick!.items(TAB)).toEqual([{ id: 'a.txt', label: 'a.txt' }, { id: 'src/b.ts', label: 'src/b.ts' }]);
  expect(params(f, 'history.paths')).toEqual([{ rev: REV }]);
  expect(cmd.pick!.typed!('gone/c.txt')).toMatchObject({ id: 'gone/c.txt' });
  tooLarge = true;
  expect(await cmd.pick!.items(TAB)).toEqual([]);
  act(() => { void cmd.pick!.run(TAB, { id: 'src/b.ts', label: 'src/b.ts' }); });
  expect(fileHistoryOf(TAB)).toMatchObject({ path: 'src/b.ts', rev: REV, view: 'history' });
});
