import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { json } from '@/test/fixtures';
import { commit, oid, stash } from '@/test/graphData';
import { detailOf, linearWorld, stubGraph } from '@/test/graphBackend';
import { dispatchSelection, fileIntentStore } from '@/state/graphSelection';
import { openGraph } from '@/state/graph';
import { diffStore } from '@/state/diff';
import { shownPanelStore } from '@/state/shownPanel';
import { jumpStore } from '../jump';
import type { GraphRow } from '../types';
import { DISPLAY_MAX } from '@/lib/clip';
import { BODY_SHOWN, CO_AUTHORS_SHOWN, CommitDetails } from './CommitDetails';
import { FILE_RENDER_CAP } from './FileList';

const TAB = { project: 'app', worktree: null };
const A = oid(2);
const P = oid(1);
const files = [
  { status: 'A', path: 'src/new.ts', oldPath: null }, { status: 'D', path: 'gone.txt', oldPath: null },
  { status: 'M', path: 'src/lib/a.ts', oldPath: null }, { status: 'R', path: 'src/b.ts', oldPath: 'b.ts' },
];
const rowsOf = (...ids: string[]): GraphRow[] => ids.map((id) => ({ kind: 'commit', id, item: commit(id) }));

async function show(detail: Parameters<typeof detailOf>[1] | Response, select: string[] = [A]) {
  const world = linearWorld(2);
  world.detail = () => (detail instanceof Response ? detail : detailOf(commit(A, [P], { subject: 'Fix <b>it</b>' }), detail));
  const fetch = stubGraph(world);
  await openGraph(TAB);
  const rows = rowsOf(A, P);
  dispatchSelection(TAB, { type: 'click', id: select[0], rows });
  for (const id of select.slice(1)) dispatchSelection(TAB, { type: 'toggle', id, rows });
  render(<CommitDetails tab={TAB} />);
  return fetch;
}

test('nothing selected asks for a selection; a graph that never opened shows nothing', async () => {
  stubGraph(linearWorld(1));
  const { container } = render(<CommitDetails tab={TAB} />);
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

test('the file list: Path and Tree views, the choice persisted; a click publishes a file-open intent and marks the row', async () => {
  await show({ files });
  await screen.findByText('4 files');
  expect(screen.getByText('b.ts → src/b.ts')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
  expect(localStorage.getItem('code-git:graph:fileView')).toBe('tree');
  expect(screen.getByText('lib')).toBeTruthy();
  expect(screen.getByText('b.ts → b.ts')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Path' }));
  fireEvent.click(screen.getByRole('button', { name: /src\/lib\/a\.ts/ }));
  expect(fileIntentStore.get()).toMatchObject({ tab: TAB, commit: A, parent: P, path: 'src/lib/a.ts', oldPath: null, selection: [{ kind: 'commit', oid: A }] });
  expect(screen.getByRole('button', { name: /src\/lib\/a\.ts/ }).getAttribute('aria-current')).toBe('true');
  expect(shownPanelStore.get().get('app\0')).toBe('diff');
  expect(diffStore.get().get('app\0')).toMatchObject({ source: { kind: 'commit', rev: A }, viewed: 'src/lib/a.ts' });
});

test('View changes opens the commit diff; a multi-selection offers the combined diff', async () => {
  await show({ files });
  fireEvent.click(await screen.findByRole('button', { name: 'View changes' }));
  expect(diffStore.get().get('app\0')?.source).toEqual({ kind: 'commit', rev: A });
  act(() => dispatchSelection(TAB, { type: 'toggle', id: P, rows: rowsOf(A, P) }));
  fireEvent.click(screen.getByRole('button', { name: 'View combined diff' }));
  expect(diffStore.get().get('app\0')?.source).toEqual({ kind: 'commits', oids: [A, P], wip: false });
});

test('a file list over the cap shows the first FILE_RENDER_CAP and "Show all N"', async () => {
  const many = Array.from({ length: FILE_RENDER_CAP + 5 }, (_, i) => ({ status: 'M', path: `f${i}.txt`, oldPath: null }));
  await show({ files: many });
  await screen.findByText(`${many.length} files`);
  expect(document.querySelectorAll('[data-file]').length).toBe(FILE_RENDER_CAP);
  fireEvent.click(screen.getByRole('button', { name: `Show all ${many.length}` }));
  expect(document.querySelectorAll('[data-file]').length).toBe(many.length);
});

test('too many changes to list: the metadata renders and the file list says so', async () => {
  await show({ files: null, filesError: { code: 'OUTPUT_TOO_LARGE', message: 'git output exceeded 33554432 bytes', limitBytes: 33554432 } });
  expect(await screen.findByText('Fix <b>it</b>')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Too many changes to list.');
  expect(screen.queryByRole('region', { name: 'Changed files' })).toBeNull();
});

test('a merge says its changes are against the first parent; a failed load shows its error', async () => {
  await show({ parents: [P, oid(9)] });
  expect(await screen.findByText('Changes against the first parent')).toBeTruthy();
  act(() => dispatchSelection(TAB, { type: 'clear' }));
  expect(screen.getByText('Select a commit')).toBeTruthy();
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
  await show({ files: [{ status: 'A', path: deep, oldPath: null }] });
  await screen.findByText('1 file');
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
  expect(document.querySelector(`[data-file="${deep}"]`)).not.toBeNull();
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
