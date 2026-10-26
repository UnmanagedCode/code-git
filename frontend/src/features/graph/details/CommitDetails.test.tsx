import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { json, summary } from '@/test/fixtures';
import { checkout, commit, oid, stash } from '@/test/graphData';
import { detailOf, linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { dfile, filesResult } from '@/test/diffFixtures';
import { dispatchSelection, fileIntentStore } from '@/state/graphSelection';
import { openGraph } from '@/state/graph';
import { loadSummary } from '@/state/useRepoSummary';
import { diffStore } from '@/state/diff';
import { openDiff } from '@/features/diff/openDiff';
import { shownPanelStore } from '@/state/shownPanel';
import { jumpStore } from '../jump';
import type { GraphRow } from '../types';
import { DISPLAY_MAX, FILE_RENDER_CAP } from '@/lib/clip';
import { getItem } from '@/lib/storage';
import { DETAILS_HEADER, parseHeaderHeight, setDetailsHeader } from '@/state/detailsHeader';
import { BODY_SHOWN, CO_AUTHORS_SHOWN, CommitDetails } from './CommitDetails';

// The cap test caps with a small FILE_RENDER_CAP, so it mounts a few rows instead of a thousand; every other list here
// stays under it. clip and DISPLAY_MAX stay real.
vi.mock('@/lib/clip', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/clip')>()), FILE_RENDER_CAP: 5 }));

const TAB = { project: 'app', worktree: null };
const A = oid(2);
const P = oid(1);
const cf = (status: string, path: string, oldPath: string | null = null, added: number | null = 1, deleted: number | null = 0) => (
  { status, path, oldPath, added, deleted, binary: false, submodule: false }
);
const files = [cf('A', 'src/new.ts', null, 5, 0), cf('D', 'gone.txt', null, 0, 2), cf('M', 'src/lib/a.ts', null, 3, 1), cf('R', 'src/b.ts', 'b.ts', 0, 0)];
/** The same files as the commit diff lists them (diff.files), resolved to A against P. */
const diffFiles = { 'POST api/ops/diff.files': { ok: true, result: filesResult(files.map((f) => dfile({ ...f, status: f.status as 'M' })), { commit: { oid: A, parents: [P] } }) } };
const fileRow = (path: string) => document.querySelector<HTMLElement>(`li[role="option"][data-path="${CSS.escape(path)}"]`)!;
const rowsOf = (...ids: string[]): GraphRow[] => ids.map((id) => ({ kind: 'commit', id, item: commit(id) }));

async function show(detail: Parameters<typeof detailOf>[1] | Response, select: string[] = [A], extra: Parameters<typeof stubGraph>[1] = {}) {
  const world = linearWorld(2);
  world.detail = () => (detail instanceof Response ? detail : detailOf(commit(A, [P], { subject: 'Fix <b>it</b>' }), detail));
  const fetch = stubGraph(world, extra);
  await openGraph(TAB);
  const rows = rowsOf(A, P);
  dispatchSelection(TAB, { type: 'click', id: select[0], rows });
  for (const id of select.slice(1)) dispatchSelection(TAB, { type: 'toggle', id, rows });
  render(<CommitDetails tab={TAB} />);
  return fetch;
}

test('nothing selected asks for a selection (in the dialog: the slot shows the Changes panel then); a graph that never opened shows nothing', async () => {
  stubGraph(linearWorld(1));
  const { container } = render(<CommitDetails tab={TAB} inDialog />);
  expect(container.textContent).toBe('');
  await act(async () => { await openGraph(TAB); });
  expect(screen.getByText('Select a commit')).toBeTruthy();
});

test('a commit: subject and body as text, author and a differing committer, co-authors, full SHA, parents that jump', async () => {
  const fetch = await show({
    body: 'Line one\n\n<script>alert(1)</script>', committer: { name: 'Cee', email: 'c@x.org', time: 1 },
    coAuthors: [{ name: 'Bob', email: 'bob@x.org' }], files,
  });
  expect(await screen.findByText('Fix <b>it</b>')).toBeTruthy();
  expect(screen.getByText(/Line one/).textContent).toBe('Line one\n\n<script>alert(1)</script>');
  expect(document.querySelector('aside script, aside b')).toBeNull();
  expect(screen.getByText('Committer')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Co-authors' })).getByText('Bob')).toBeTruthy();
  expect(screen.getByLabelText('Commit SHA').textContent).toBe(A);
  fireEvent.click(screen.getByRole('button', { name: `Jump to parent ${P.slice(0, 7)}` }));
  expect(jumpStore.get()).toMatchObject({ oid: P, rowId: P });
  expect(fetch.calls.find((c) => c.url.pathname === '/api/ops/graph.commit')!.body).toEqual({ target: { project: 'app' }, params: { oid: A } });
});

test('signature badges per %G? status; none for N', async () => {
  await show({ signature: { status: 'G', signer: 'Ann', key: 'ABC' } });
  const badge = await screen.findByText('Signed');
  expect(badge.getAttribute('title')).toBe('Good signature: Ann, key ABC');
  for (const [status, text] of [['B', 'Bad signature'], ['R', 'Revoked key'], ['E', 'Unverified'], ['X', 'Expired signature']] as const) {
    const { SignatureBadge } = await import('./SignatureBadge');
    const { unmount } = render(<SignatureBadge status={status} signer={null} keyId={null} />);
    expect(screen.getByText(text).getAttribute('data-signature')).toBe(status);
    unmount();
  }
  const { SignatureBadge } = await import('./SignatureBadge');
  const { container } = render(<SignatureBadge status="N" signer={null} keyId={null} />);
  expect(container.textContent).toBe('');
});

test('the file list: Path and Tree views, the choice persisted, counts from graph.commit; a click publishes a file-open intent, opens the diff and binds the list', async () => {
  await show({ files }, [A], diffFiles);
  await screen.findByText('4 files');
  const list = screen.getByRole('listbox', { name: 'Changed files' });
  expect(within(list).getAllByRole('option')).toHaveLength(4);
  expect(screen.getByText('b.ts → src/b.ts')).toBeTruthy();
  expect(within(fileRow('src/new.ts')).getByLabelText('5 added, 0 deleted')).toBeTruthy();
  expect(within(fileRow('gone.txt')).getByLabelText('0 added, 2 deleted')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
  expect(localStorage.getItem('code-git:graph:fileView')).toBe('tree');
  expect(screen.getByText('lib')).toBeTruthy();
  expect(screen.getByText('b.ts → b.ts')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Path' }));
  expect(fileRow('src/lib/a.ts').getAttribute('aria-current')).toBeNull();
  fireEvent.click(fileRow('src/lib/a.ts'));
  expect(fileIntentStore.get()).toMatchObject({ tab: TAB, commit: A, parent: P, path: 'src/lib/a.ts', oldPath: null, selection: [{ kind: 'commit', oid: A }] });
  expect(shownPanelStore.get().get('app\0')).toBe('diff');
  expect(diffStore.get().get('app\0')).toMatchObject({ source: { kind: 'commit', rev: A }, viewed: 'src/lib/a.ts' });
  await waitFor(() => expect(fileRow('src/lib/a.ts').getAttribute('aria-current')).toBe('true'));
  expect(screen.getAllByRole('listbox', { name: 'Changed files' })).toHaveLength(1);
});

test('bound to the open diff: another file is viewed without a second diff.files; Ctrl-click multi-selects; the menu is the diff\'s', async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const fetch = await show({ files }, [A], diffFiles);
  await screen.findByText('4 files');
  fireEvent.click(fileRow('src/lib/a.ts'));
  await waitFor(() => expect(diffStore.get().get('app\0')?.list.result).not.toBeNull());
  expect(paramsOf(fetch, 'POST api/ops/diff.files')).toHaveLength(1);
  fireEvent.click(fileRow('gone.txt'));
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'gone.txt', selected: ['gone.txt'] });
  expect(fileRow('gone.txt').getAttribute('aria-current')).toBe('true');
  expect(fileIntentStore.get()?.path).toBe('src/lib/a.ts');
  fireEvent.click(fileRow('src/new.ts'), { ctrlKey: true });
  expect(diffStore.get().get('app\0')?.selected).toEqual(['gone.txt', 'src/new.ts']);
  await userEvent.click(screen.getByRole('button', { name: 'Actions for src/new.ts' }));
  expect(await screen.findByRole('menuitem', { name: 'Copy patch of selection' })).toBeTruthy();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
  // The selection in list order.
  expect(writeText).toHaveBeenCalledWith('src/new.ts\ngone.txt');
  // ↓ from the focused row views the next file.
  fireEvent.keyDown(fileRow('gone.txt'), { key: 'ArrowDown' });
  expect(diffStore.get().get('app\0')?.viewed).toBe('src/lib/a.ts');
  expect(paramsOf(fetch, 'POST api/ops/diff.files')).toHaveLength(1);
});

test('while the bound diff list loads, the commit\'s own files stand in for the same diff; for another parent, "Loading files…"', async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await show({ files, parents: [P, oid(9)] }, [A], {
    'POST api/ops/diff.files': async () => { await held; return { ok: true, result: filesResult([dfile({ path: 'src/lib/a.ts' })], { commit: { oid: A, parents: [P, oid(9)] } }) }; },
  });
  await screen.findByText('4 files');
  fireEvent.click(fileRow('gone.txt'));
  expect(diffStore.get().get('app\0')?.list.loading).toBe(true);
  expect(within(screen.getByRole('listbox', { name: 'Changed files' })).getAllByRole('option')).toHaveLength(4);
  expect(fileRow('gone.txt').getAttribute('aria-current')).toBe('true');
  expect(screen.getByText('4 files')).toBeTruthy();
  act(() => openDiff(TAB, { kind: 'commit', rev: A, parent: 2 }));
  expect(screen.queryByRole('listbox', { name: 'Changed files' })).toBeNull();
  expect(screen.getByText('Loading files…')).toBeTruthy();
  await act(async () => { release(); await held; });
  await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Changed files' })).getAllByRole('option').map((o) => o.getAttribute('data-path'))).toEqual(['src/lib/a.ts']));
});

test('a file picked in the loading stand-in stays picked when the diff\'s list answers (a diff opened at no file)', async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await show({ files }, [A], {
    'POST api/ops/diff.files': async () => { await held; return diffFiles['POST api/ops/diff.files']; },
  });
  await screen.findByText('4 files');
  act(() => openDiff(TAB, { kind: 'commit', rev: A }));
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: null, list: { loading: true } });
  fireEvent.click(fileRow('gone.txt'));
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'gone.txt', selected: ['gone.txt'] });
  await act(async () => { release(); await held; });
  await waitFor(() => expect(diffStore.get().get('app\0')?.list.result).toBeTruthy());
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'gone.txt', selected: ['gone.txt'] });
  expect(fileRow('gone.txt').getAttribute('aria-current')).toBe('true');
});

test('the loading stand-in selects like the bound list (Ctrl- and Shift-click, ↓ views), and its selection survives the answer', async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await show({ files }, [A], {
    'POST api/ops/diff.files': async () => { await held; return diffFiles['POST api/ops/diff.files']; },
  });
  await screen.findByText('4 files');
  act(() => openDiff(TAB, { kind: 'commit', rev: A }));
  expect(screen.getByRole('listbox', { name: 'Changed files' }).getAttribute('aria-multiselectable')).toBe('true');
  fireEvent.click(fileRow('src/new.ts'));
  fireEvent.click(fileRow('src/lib/a.ts'), { ctrlKey: true });
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'src/lib/a.ts', selected: ['src/new.ts', 'src/lib/a.ts'] });
  expect(fileRow('src/new.ts').getAttribute('aria-selected')).toBe('true');
  fireEvent.click(fileRow('gone.txt'), { shiftKey: true });
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'gone.txt', selected: ['gone.txt', 'src/lib/a.ts'] });
  fireEvent.keyDown(fileRow('src/lib/a.ts'), { key: 'ArrowDown' });
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'src/b.ts', selected: ['src/b.ts'] });
  fireEvent.click(fileRow('src/new.ts'), { ctrlKey: true });
  await act(async () => { release(); await held; });
  await waitFor(() => expect(diffStore.get().get('app\0')?.list.result).toBeTruthy());
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'src/new.ts', selected: ['src/b.ts', 'src/new.ts'] });
});

test('bound to a diff whose list failed: no "N files" header and no list, a note that the diff says why', async () => {
  await show({ files }, [A], { 'POST api/ops/diff.files': json({ error: 'git output exceeded', code: 'OUTPUT_TOO_LARGE', limitBytes: 1 }, 422) });
  await screen.findByText('4 files');
  fireEvent.click(fileRow('gone.txt'));
  await waitFor(() => expect(diffStore.get().get('app\0')?.list.error).not.toBeNull());
  expect(screen.queryByText('4 files')).toBeNull();
  expect(screen.queryByRole('listbox', { name: 'Changed files' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'File view' })).toBeNull();
  expect(screen.getByText('The changed files could not be listed; the diff says why.')).toBeTruthy();
  // The diff's own alert is the one alert.
  expect(within(screen.getByRole('complementary', { name: 'Commit details' })).queryByRole('alert')).toBeNull();
});

test('unbound: the row menu is the commit file menu; a merge diffed against parent 2 says so and lists that diff\'s files', async () => {
  const merge = [cf('M', 'from-side.txt')];
  await show({ files, parents: [P, oid(9)] }, [A], {
    'POST api/ops/diff.files': (_u: URL, init?: RequestInit) => {
      const src = JSON.parse(String(init?.body)).params.source as { parent?: number };
      return { ok: true, result: filesResult((src.parent === 2 ? merge : files).map((f) => dfile({ ...f, status: 'M' })), { commit: { oid: A, parents: [P, oid(9)] } }) };
    },
  });
  expect(await screen.findByText('Changes against the first parent')).toBeTruthy();
  fireEvent.contextMenu(fileRow('src/lib/a.ts'));
  expect(await screen.findByRole('menuitem', { name: /history/i })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Copy patch of selection' })).toBeNull();
  await userEvent.keyboard('{Escape}');
  act(() => openDiff(TAB, { kind: 'commit', rev: A, parent: 2 }));
  expect(await screen.findByText('Changes against parent 2')).toBeTruthy();
  await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Changed files' })).getAllByRole('option').map((o) => o.getAttribute('data-path'))).toEqual(['from-side.txt']));
  expect(screen.getByText('1 file')).toBeTruthy();
});

test("a stash's Staged view binds the stash's details to the index commit's files", async () => {
  const W = 'e'.repeat(40);
  const I = 'f'.repeat(40);
  const world = linearWorld(2);
  world.refs.stashes = [{ oid: W, parents: [A, I], selector: 'stash@{0}', time: 1, subject: 'On main: wip' }];
  world.detail = () => detailOf(commit(W, [A, I], { subject: 'On main: wip' }), { files: [cf('M', 'worktree.txt'), cf('M', 'index.txt')] });
  stubGraph(world, {
    'POST api/ops/diff.files': (_u: URL, init?: RequestInit) => {
      const rev = (JSON.parse(String(init?.body)).params.source as { rev: string }).rev;
      return { ok: true, result: filesResult([dfile({ path: rev === I ? 'index.txt' : 'worktree.txt' })], { commit: { oid: rev, parents: [A] } }) };
    },
  });
  await openGraph(TAB);
  const rows: GraphRow[] = [{ kind: 'stash', id: `stash:${W}`, stash: world.refs.stashes[0] }, ...rowsOf(A)];
  dispatchSelection(TAB, { type: 'click', id: `stash:${W}`, rows });
  render(<CommitDetails tab={TAB} />);
  await screen.findByText('2 files');
  act(() => openDiff(TAB, { kind: 'commit', rev: I }));
  await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Changed files' })).getAllByRole('option').map((o) => o.getAttribute('data-path'))).toEqual(['index.txt']));
  expect(screen.getByRole('complementary', { name: 'Commit details' })).toBeTruthy();
  expect(fileRow('index.txt').getAttribute('aria-current')).toBe('true');
  expect(screen.queryByRole('button', { name: 'View changes' })).toBeNull();
});

test('a commit offers no View changes (its files open the diff); a multi-selection offers the combined diff', async () => {
  await show({ files });
  await screen.findByText('4 files');
  expect(screen.queryByRole('button', { name: 'View changes' })).toBeNull();
  act(() => dispatchSelection(TAB, { type: 'toggle', id: P, rows: rowsOf(A, P) }));
  fireEvent.click(screen.getByRole('button', { name: 'View combined diff' }));
  expect(diffStore.get().get('app\0')?.source).toEqual({ kind: 'commits', oids: [A, P], wip: false });
});

const LONG_BODY = Array.from({ length: 200 }, (_, i) => `Body line ${i + 1}`).join('\n');

test.each([['no body', ''], ['a 200-line body', LONG_BODY]])('the commit information is a header whose height ignores the message, scrolling on its own, apart from the files (%s)', async (_name, body) => {
  await show({ body, files });
  const header = await screen.findByRole('region', { name: 'Commit information' });
  expect(within(header).getByText('Fix <b>it</b>')).toBeTruthy();
  expect(within(header).getByText('Author')).toBeTruthy();
  expect(within(header).getByLabelText('Commit SHA').textContent).toBe(A);
  if (body) expect(within(header).getByText(/Body line 200$/)).toBeTruthy();
  const list = screen.getByRole('listbox', { name: 'Changed files' });
  expect(header.contains(list)).toBe(false);
  expect(screen.getByRole('complementary', { name: 'Commit details' }).contains(list)).toBe(true);
  // The height utility is the requirement (happy-dom has no layout; graph.mjs measures the pixels).
  expect(header.className.split(' ').filter((c) => /^(h-|min-h-|max-h-|overflow-)/.test(c)).sort()).toEqual(['h-(--details-header)', 'overflow-y-auto']);
});

// happy-dom has no layout: the panel's height is defined on the aside, and a fake ResizeObserver reports it.
function fakeResize() {
  const live = new Set<() => void>();
  vi.stubGlobal('ResizeObserver', class {
    fire: () => void;
    constructor(cb: ResizeObserverCallback) { this.fire = () => cb([], this as unknown as ResizeObserver); }
    observe() { live.add(this.fire); }
    unobserve() {}
    disconnect() { live.delete(this.fire); }
  });
  return (h: number) => {
    Object.defineProperty(screen.getByRole('complementary', { name: 'Commit details' }), 'clientHeight', { configurable: true, value: h });
    act(() => { for (const f of live) f(); });
  };
}
const handle = () => screen.getByRole('separator', { name: 'Resize commit information' });
const valueNow = () => Number(handle().getAttribute('aria-valuenow'));
const headerPx = () => screen.getByRole('region', { name: 'Commit information' }).style.getPropertyValue('--details-header');
const { min: MIN, filesMin: FILES_MIN, handle: HANDLE, step: STEP } = DETAILS_HEADER;
const MAX_600 = 600 - HANDLE - FILES_MIN;

test('the header\'s resize handle: a horizontal separator with its value and bounds; the height reaches the header through --details-header', async () => {
  const resize = fakeResize();
  await show({ files });
  await screen.findByText('4 files');
  resize(600);
  const h = handle();
  expect(h.getAttribute('aria-orientation')).toBe('horizontal');
  expect([valueNow(), Number(h.getAttribute('aria-valuemin')), Number(h.getAttribute('aria-valuemax'))]).toEqual([DETAILS_HEADER.default, MIN, MAX_600]);
  expect(headerPx()).toBe(`${DETAILS_HEADER.default}px`);
  // touch-action none is the drag's contract on touch and pen: the browser must not turn the drag into a scroll.
  expect(h.className.split(' ')).toContain('touch-none');
});

test('arrow keys step the height, Home and End go to the bounds; the height is stored and survives another selection and a remount', async () => {
  const resize = fakeResize();
  const fetch = await show({ files });
  await screen.findByText('4 files');
  resize(600);
  fireEvent.keyDown(handle(), { key: 'ArrowDown' });
  expect([valueNow(), headerPx(), getItem('graph:detailsHeader')]).toEqual([DETAILS_HEADER.default + STEP, `${DETAILS_HEADER.default + STEP}px`, String(DETAILS_HEADER.default + STEP)]);
  fireEvent.keyDown(handle(), { key: 'ArrowUp' });
  expect(valueNow()).toBe(DETAILS_HEADER.default);
  fireEvent.keyDown(handle(), { key: 'Home' });
  expect([valueNow(), headerPx()]).toEqual([MIN, `${MIN}px`]);
  fireEvent.keyDown(handle(), { key: 'End' });
  expect([valueNow(), headerPx()]).toEqual([MAX_600, `${MAX_600}px`]);
  fireEvent.keyDown(handle(), { key: 'Home' });
  fireEvent.keyDown(handle(), { key: 'ArrowDown' });
  // Another commit remounts the details (keyed by oid); the stub answers every oid with A's detail.
  act(() => dispatchSelection(TAB, { type: 'click', id: P, rows: rowsOf(A, P) }));
  await waitFor(() => expect(fetch.calls.filter((c) => c.url.pathname === '/api/ops/graph.commit').map((c) => (c.body as { params: { oid: string } }).params.oid)).toEqual([A, P]));
  await screen.findByText('4 files');
  expect(valueNow()).toBe(MIN + STEP);
  // A reload reads the store back from storage.
  expect(parseHeaderHeight(getItem('graph:detailsHeader'))).toBe(MIN + STEP);
});

// The handle captures the pointer, so every move and the release reach the handle itself.
const drag = (from: number, to: number, end: 'pointerUp' | 'pointerCancel' | 'lostPointerCapture' | null = 'pointerUp') => {
  fireEvent.pointerDown(handle(), { clientY: from, button: 0, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientY: to, pointerId: 1 });
  if (end) fireEvent[end](handle(), { clientY: to, pointerId: 1 });
};

test('a drag captures the pointer, resizes the header with aria-valuenow in step, stores the height once on release, and clamps at both ends', async () => {
  const resize = fakeResize();
  await show({ files });
  await screen.findByText('4 files');
  resize(600);
  const capture = vi.spyOn(handle(), 'setPointerCapture');
  drag(300, 360, null);
  expect(capture).toHaveBeenCalledWith(1);
  expect([headerPx(), valueNow()]).toEqual([`${DETAILS_HEADER.default + 60}px`, DETAILS_HEADER.default + 60]);
  expect(getItem('graph:detailsHeader')).toBeNull();
  fireEvent.pointerUp(handle(), { clientY: 360, pointerId: 1 });
  expect([valueNow(), getItem('graph:detailsHeader')]).toEqual([DETAILS_HEADER.default + 60, String(DETAILS_HEADER.default + 60)]);
  // The capture's release after pointerup ends nothing more.
  fireEvent.lostPointerCapture(handle(), { pointerId: 1 });
  expect(valueNow()).toBe(DETAILS_HEADER.default + 60);
  drag(300, -700);
  expect(valueNow()).toBe(MIN);
  drag(300, 1300);
  expect([valueNow(), headerPx()]).toEqual([MAX_600, `${MAX_600}px`]);
});

test.each(['pointerCancel', 'lostPointerCapture'] as const)('a drag ended by %s is abandoned: the height goes back, nothing is stored, and later moves resize nothing', async (end) => {
  const resize = fakeResize();
  await show({ files });
  await screen.findByText('4 files');
  resize(600);
  drag(300, 360, end);
  expect([valueNow(), headerPx(), getItem('graph:detailsHeader')]).toEqual([DETAILS_HEADER.default, `${DETAILS_HEADER.default}px`, null]);
  fireEvent.pointerMove(handle(), { clientY: 420, pointerId: 1 });
  fireEvent.pointerUp(handle(), { clientY: 420, pointerId: 1 });
  expect([valueNow(), headerPx(), getItem('graph:detailsHeader')]).toEqual([DETAILS_HEADER.default, `${DETAILS_HEADER.default}px`, null]);
});

test('unmounting mid-drag abandons it: the pointer\'s later moves and release resize and store nothing', async () => {
  const resize = fakeResize();
  await show({ files });
  await screen.findByText('4 files');
  resize(600);
  const h = handle();
  drag(300, 360, null);
  act(() => dispatchSelection(TAB, { type: 'click', id: P, rows: rowsOf(A, P) }));
  await screen.findByText('4 files');
  for (const target of [h, window]) {
    fireEvent.pointerMove(target, { clientY: 420, pointerId: 1 });
    fireEvent.pointerUp(target, { clientY: 420, pointerId: 1 });
  }
  expect(getItem('graph:detailsHeader')).toBeNull();
  expect(valueNow()).toBe(DETAILS_HEADER.default);
});

test('a shrinking panel re-clamps the rendered height so the files keep their minimum, and keeps the stored choice', async () => {
  setDetailsHeader(400);
  const resize = fakeResize();
  await show({ files });
  await screen.findByText('4 files');
  resize(600);
  expect(valueNow()).toBe(400);
  resize(354);
  expect([valueNow(), headerPx(), Number(handle().getAttribute('aria-valuemax'))]).toEqual([354 - HANDLE - FILES_MIN, `${354 - HANDLE - FILES_MIN}px`, 354 - HANDLE - FILES_MIN]);
  expect(getItem('graph:detailsHeader')).toBe('400');
  resize(600);
  expect(valueNow()).toBe(400);
});

test('a key that cannot move a clamped header leaves the stored choice alone; one that moves it stores the new height', async () => {
  setDetailsHeader(400);
  const resize = fakeResize();
  await show({ files });
  await screen.findByText('4 files');
  resize(354);
  const max = 354 - HANDLE - FILES_MIN;
  for (const key of ['ArrowDown', 'End']) fireEvent.keyDown(handle(), { key });
  expect([valueNow(), getItem('graph:detailsHeader')]).toEqual([max, '400']);
  // A panel whose maximum is the minimum: no key moves the header, none collapses the choice.
  resize(MIN + HANDLE + FILES_MIN - 40);
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) fireEvent.keyDown(handle(), { key });
  expect([valueNow(), getItem('graph:detailsHeader')]).toEqual([MIN, '400']);
  resize(354);
  fireEvent.keyDown(handle(), { key: 'ArrowUp' });
  expect([valueNow(), getItem('graph:detailsHeader')]).toEqual([max - STEP, String(max - STEP)]);
});

test('in the narrow dialog the header keeps the default height, with no resize handle', async () => {
  setDetailsHeader(300);
  stubGraph(Object.assign(linearWorld(2), { detail: () => detailOf(commit(A, [P], { subject: 'Fix <b>it</b>' }), { files }) }));
  await openGraph(TAB);
  dispatchSelection(TAB, { type: 'click', id: A, rows: rowsOf(A, P) });
  render(<CommitDetails tab={TAB} inDialog />);
  await screen.findByText('4 files');
  expect(screen.queryByRole('separator')).toBeNull();
  expect(headerPx()).toBe(`${DETAILS_HEADER.default}px`);
});

test('the cap seam is in effect for this file', () => {
  expect(FILE_RENDER_CAP).toBe(5);
});

test('a file list over the cap shows the first FILE_RENDER_CAP and "Show all N"', async () => {
  const many = Array.from({ length: FILE_RENDER_CAP + 5 }, (_, i) => cf('M', `f${i}.txt`));
  await show({ files: many });
  await screen.findByText(`${many.length} files`);
  expect(document.querySelectorAll('[data-path]').length).toBe(FILE_RENDER_CAP);
  fireEvent.click(screen.getByRole('button', { name: `Show all ${many.length}` }));
  expect(document.querySelectorAll('[data-path]').length).toBe(many.length);
});

test('too many changes to list: the metadata renders and the file list says so', async () => {
  await show({ files: null, filesError: { code: 'OUTPUT_TOO_LARGE', message: 'git output exceeded 33554432 bytes', limitBytes: 33554432 } });
  expect(await screen.findByText('Fix <b>it</b>')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Too many changes to list.');
  expect(screen.queryByRole('listbox', { name: 'Changed files' })).toBeNull();
});

test('a merge says its changes are against the first parent; a failed load shows its error', async () => {
  await show({ parents: [P, oid(9)] });
  expect(await screen.findByText('Changes against the first parent')).toBeTruthy();
  // Cleared: the slot gives way to the Changes panel.
  act(() => dispatchSelection(TAB, { type: 'clear' }));
  expect(screen.queryByRole('complementary', { name: 'Commit details' })).toBeNull();
});

test('a failed load shows its error; a multi-selection lists the commits', async () => {
  await show(json({ error: 'bad object', code: 'GIT_FAILED' }, 422));
  expect((await screen.findByRole('alert')).textContent).toBe('bad object');
  act(() => dispatchSelection(TAB, { type: 'toggle', id: P, rows: rowsOf(A, P) }));
  expect(screen.getByText('2 selected')).toBeTruthy();
});

test('a multi-selection lists a stash by its own subject', async () => {
  const world = linearWorld(2);
  const s = stash('e'.repeat(40), oid(2), 0);
  world.refs.stashes = [{ ...s, subject: 'On main: half-done' }];
  stubGraph(world);
  await openGraph(TAB);
  const rows: GraphRow[] = [{ kind: 'stash', id: `stash:${s.oid}`, stash: s }, ...rowsOf(A)];
  dispatchSelection(TAB, { type: 'click', id: `stash:${s.oid}`, rows });
  dispatchSelection(TAB, { type: 'toggle', id: A, rows });
  render(<CommitDetails tab={TAB} />);
  expect(screen.getByText('On main: half-done')).toBeTruthy();
});

test('impossible author and committer timestamps render — instead of crashing the panel', async () => {
  await show({ author: { name: 'Ann', email: 'a@x', time: Number('99999999999999999999') }, committer: { name: 'Cee', email: 'c@x', time: -1e20 } });
  await screen.findByText('Fix <b>it</b>');
  expect(screen.getAllByText('—')).toHaveLength(2);
});

test('Tree view renders a file whose path has 20,000 components', async () => {
  const deep = Array.from({ length: 20_000 }, (_, i) => `d${i}`).join('/');
  await show({ files: [cf('A', deep)] });
  await screen.findByText('1 file');
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
  expect(document.querySelector(`[data-path="${deep}"]`)).not.toBeNull();
});

test('a 1 MB subject and body are cut for display; the whole body shows on request', async () => {
  const huge = 'y'.repeat(1_000_000);
  await show({ body: huge, coAuthors: Array.from({ length: CO_AUTHORS_SHOWN + 3 }, (_, i) => ({ name: `C${i}`, email: `c${i}@x` })) });
  const body = await waitFor(() => { const b = document.querySelector('[data-commit-body]'); expect(b).not.toBeNull(); return b!; });
  expect(body.textContent!.length).toBe(BODY_SHOWN + 1);
  expect(within(screen.getByRole('region', { name: 'Co-authors' })).getAllByRole('listitem')).toHaveLength(CO_AUTHORS_SHOWN);
  expect(screen.getByText('and 3 more')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Show the whole message/ }));
  expect(document.querySelector('[data-commit-body]')!.textContent!.length).toBe(huge.length);
});

test('a 1 MB subject is cut to DISPLAY_MAX', async () => {
  const world = linearWorld(2);
  world.detail = () => detailOf(commit(A, [P], { subject: 'z'.repeat(1_000_000) }));
  stubGraph(world);
  await openGraph(TAB);
  dispatchSelection(TAB, { type: 'click', id: A, rows: rowsOf(A, P) });
  render(<CommitDetails tab={TAB} />);
  const h = await screen.findByRole('heading', { level: 2 });
  expect(h.textContent).toBe(`${'z'.repeat(DISPLAY_MAX)}…`);
});

test('a huge signer and key are cut for display', async () => {
  const huge = 's'.repeat(1_000_000);
  const { SignatureBadge } = await import('./SignatureBadge');
  render(<SignatureBadge status="G" signer={huge} keyId={huge} />);
  expect(screen.getByText('Signed').getAttribute('title')!.length).toBeLessThanOrEqual('Good signature: '.length + DISPLAY_MAX + 1);
});

test('in the right slot the details give way to the Changes panel for no selection or a single WIP row; in a dialog they do not', async () => {
  const world = linearWorld(2);
  world.summaries[''] = summary({ head: { oid: oid(2), branch: 'main', unborn: false }, counts: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 } });
  stubGraph(world);
  await loadSummary(TAB);
  await openGraph(TAB);
  const { unmount } = render(<CommitDetails tab={TAB} />);
  expect(screen.queryByRole('complementary', { name: 'Commit details' })).toBeNull();
  act(() => dispatchSelection(TAB, { type: 'click', id: 'wip:', rows: [{ kind: 'wip', id: 'wip:', checkout: checkout(null) }] }));
  expect(screen.queryByRole('complementary', { name: 'Commit details' })).toBeNull();
  unmount();
  render(<CommitDetails tab={TAB} inDialog />);
  expect(screen.getByRole('complementary', { name: 'Commit details' }).textContent).toContain('Select a commit');
});
