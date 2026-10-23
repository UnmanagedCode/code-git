import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import type { Conflict, ConflictRead } from '@/features/sequence/api';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { shownPanelStore } from '@/state/shownPanel';
import { tabKey } from '@/state/tabs';
import { workdirOf, workdirStore } from '@/state/workdir';
import { json } from '@/test/fixtures';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { ref, refsResult } from '@/test/graphData';
import { ConflictTool } from './ConflictTool';
import { openConflict } from './open';
import { toolOf } from './state';

const T = { project: 'app', worktree: null };
const OID = (c: string) => c.repeat(40);
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const L = (...xs: string[]) => xs.map((x) => `${x}\n`).join('');
const side = (text: string | null, mode = '100644') => (text === null ? null : { mode, oid: OID(text.length.toString(16).slice(-1)), b64: b64(text) });
const MARKED = L('a', '<<<<<<< HEAD', 'o1', '=======', 't1', '>>>>>>> feature', 'm', '<<<<<<< HEAD', 'o2', '=======', 't2', '>>>>>>> feature');
/** Two conflicts: line 2 and line 4 changed on both sides. */
const TEXT: ConflictRead = {
  path: 'app.txt', kind: 'bothModified', content: 'text',
  base: side(L('a', 'b', 'm', 'c')), ours: side(L('a', 'o1', 'm', 'o2')), theirs: side(L('a', 't1', 'm', 't2')),
  worktree: { oid: OID('w'), b64: b64(MARKED) },
};
const conflict = (path: string, over: Partial<Conflict> = {}): Conflict => ({ path, kind: 'bothModified', base: null, ours: { mode: '100644', oid: OID('1') }, theirs: { mode: '100644', oid: OID('2') }, ...over });

async function show(read: ConflictRead = TEXT, answers: Record<string, unknown> = {}) {
  graphStore.set(new Map([[tabKey(T), { ...EMPTY_GRAPH, status: 'ready', refs: refsResult({ head: { oid: OID('a'), branch: 'refs/heads/main', detached: false, unborn: false }, refs: [ref('refs/heads/main', OID('a'), { isHead: true }), ref('refs/heads/feature', OID('f'))] }) }]]));
  workdirStore.set(new Map([[tabKey(T), { ...workdirOf(T), operation: { kind: 'merge', incoming: { oid: OID('f'), subject: 'f' }, rebase: null }, conflicts: [conflict(read.path), conflict('other.txt')] }]]));
  const f = stubGraph(linearWorld(2), {
    'POST api/ops/conflict.read': { ok: true, result: read },
    'POST api/ops/conflict.save': (_u: URL, init?: RequestInit) => ({ ok: true, result: { oid: `saved-${paramsOf(f, 'POST api/ops/conflict.save').length}`.padEnd(40, '0') } }),
    'POST api/ops/conflict.take': { ok: true, result: { resolved: [read.path], deleted: [] } },
    'POST api/ops/stage.files': { ok: true, result: { paths: [read.path] } },
    'POST api/ops/commit.state': { ok: true, result: { merging: true } },
    ...answers,
  });
  render(<ConflictTool tab={T} />);
  await act(() => openConflict(T, read.path));
  return f;
}
const output = () => screen.getByRole('textbox', { name: 'Output' }) as HTMLTextAreaElement;
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const saves = (f: ReturnType<typeof stubGraph>) => paramsOf(f, 'POST api/ops/conflict.save') as { path: string; contentB64: string; expect: string | null }[];
const decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

test('the panes show Current (main) and Incoming (feature); Output starts as git-style markers labelled with them', async () => {
  await show();
  expect(screen.getByRole('region', { name: 'Current: main' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Incoming: feature' })).toBeTruthy();
  expect(output().value).toBe(L('a', '<<<<<<< main', 'o1', '=======', 't1', '>>>>>>> feature', 'm', '<<<<<<< main', 'o2', '=======', 't2', '>>>>>>> feature'));
  expect(screen.getByText('Conflict 1 of 2 · 2 unresolved')).toBeTruthy();
});

test('picking a line, then a whole conflict, writes those lines into Output (current first); unpicking brings the markers back', async () => {
  await show();
  await userEvent.click(box('Take line 2 from incoming'));
  expect(output().value.startsWith(L('a', 't1', 'm', '<<<<<<< main'))).toBe(true);
  await userEvent.click(box('Take conflict 1 from current'));
  expect(output().value.startsWith(L('a', 'o1', 't1', 'm'))).toBe(true);
  await userEvent.click(box('Take conflict 2 from incoming'));
  expect(output().value).toBe(L('a', 'o1', 't1', 'm', 't2'));
  expect(screen.getByText('Conflict 2 of 2')).toBeTruthy();
  await userEvent.click(box('Take line 4 from incoming'));
  expect(output().value.endsWith(L('<<<<<<< main', 'o2', '=======', 't2', '>>>>>>> feature'))).toBe(true);
});

test('typing in Output edits it; Alt+↓ / Alt+↑ and the buttons move between conflicts (the caret goes to the block)', async () => {
  await show();
  fireEvent.change(output(), { target: { value: `X${output().value}` } });
  expect(output().value.startsWith('Xa\n')).toBe(true);
  fireEvent.keyDown(output(), { key: 'ArrowDown', altKey: true });
  expect(screen.getByText(/^Conflict 2 of 2/)).toBeTruthy();
  expect(output().selectionStart).toBe(output().value.indexOf('<<<<<<< main', 10));
  await userEvent.click(screen.getByRole('button', { name: 'Previous conflict' }));
  expect(screen.getByText(/^Conflict 1 of 2/)).toBeTruthy();
});

test('Save posts the Output as UTF-8 base64 with the read oid as expect, then the saved oid on the next save', async () => {
  const f = await show();
  await userEvent.click(box('Take conflict 1 from current'));
  await userEvent.click(box('Take conflict 2 from incoming'));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saves(f)).toHaveLength(1));
  expect(saves(f)[0]).toEqual({ path: 'app.txt', contentB64: b64(L('a', 'o1', 'm', 't2')), expect: OID('w') });
  fireEvent.change(output(), { target: { value: `${output().value}é\n` } });
  fireEvent.keyDown(output(), { key: 's', ctrlKey: true });
  await waitFor(() => expect(saves(f)).toHaveLength(2));
  expect(saves(f)[1].expect).toBe('saved-1'.padEnd(40, '0'));
  expect(decode(saves(f)[1].contentB64).endsWith('é\n')).toBe(true);
});

test('Mark resolved with markers left asks first; confirmed, it saves the edited Output, then stages the file and opens the next', async () => {
  const f = await show(TEXT, { 'POST api/ops/commit.state': { ok: true, result: { merging: true, operation: null, conflicts: [conflict('other.txt')] } } });
  fireEvent.change(output(), { target: { value: `${output().value}tail\n` } });
  await userEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
  await waitFor(() => expect(confirmStore.get()?.opts.title).toBe('Mark app.txt resolved with conflicts left?'));
  act(() => settleConfirm(false));
  expect(paramsOf(f, 'POST api/ops/stage.files')).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
  await waitFor(() => expect(confirmStore.get()).not.toBeNull());
  act(() => settleConfirm(true));
  await waitFor(() => expect(paramsOf(f, 'POST api/ops/stage.files')).toEqual([{ paths: ['app.txt'] }]));
  expect(saves(f)).toHaveLength(1);
  // The next conflicted file opens.
  await waitFor(() => expect(paramsOf(f, 'POST api/ops/conflict.read').at(-1)).toEqual({ path: 'other.txt' }));
});

test('a worktree file without markers was changed outside: Save asks before overwriting it', async () => {
  const f = await show({ ...TEXT, worktree: { oid: OID('w'), b64: b64(L('hand', 'edited')) } });
  fireEvent.change(output(), { target: { value: 'mine\n' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Overwrite'));
  act(() => settleConfirm(false));
  await waitFor(() => expect(confirmStore.get()).toBeNull());
  expect(saves(f)).toEqual([]);
});

test.each([
  ['binary', /Binary file/], ['large', /Larger than/], ['submodule', /submodule pointer/], ['oneSided', /deleted on the other/],
] as const)('a %s conflict shows its notice and the take buttons; Take current confirms, then posts conflict.take', async (content, notice) => {
  const f = await show({ ...TEXT, content, base: null, ours: { mode: '100644', oid: OID('1'), b64: null }, theirs: { mode: '100644', oid: OID('2'), b64: null } });
  expect(screen.getByRole('note').textContent).toMatch(notice);
  expect(screen.queryByRole('textbox', { name: 'Output' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Take current (main)' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Take current'));
  act(() => settleConfirm(true));
  await waitFor(() => expect(paramsOf(f, 'POST api/ops/conflict.take')).toEqual([{ paths: ['app.txt'], side: 'ours' }]));
});

test('text that is not UTF-8 shows a notice instead of the panes', async () => {
  await show({ ...TEXT, ours: { mode: '100644', oid: OID('1'), b64: btoa('\xff\xfe') } });
  expect(screen.getByRole('note').textContent).toMatch(/Not UTF-8 text/);
});

test('hostile file content stays text in the panes and the Output', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  await show({ ...TEXT, ours: side(L('a', evil, 'm', 'o2')) });
  expect(document.querySelector('img')).toBeNull();
  expect(within(screen.getByRole('region', { name: 'Current: main' })).getByText(evil)).toBeTruthy();
  expect(output().value).toContain(evil);
});

test('Close with unsaved changes asks; confirmed, the tool closes and the graph comes back', async () => {
  await show();
  fireEvent.change(output(), { target: { value: 'changed\n' } });
  await userEvent.click(screen.getByRole('button', { name: 'Close merge tool' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Discard'));
  act(() => settleConfirm(true));
  await waitFor(() => expect(toolOf(T)).toBeNull());
  expect(shownPanelStore.get().has(tabKey(T))).toBe(false);
});

test('a refused read (PATH_BLOCKED) shows the refusal and Close, no panes', async () => {
  await show(TEXT, { 'POST api/ops/conflict.read': json({ error: 'd is not a directory git can write into (an untracked symlink or file?): move it first', code: 'PATH_BLOCKED' }, 409) });
  expect(screen.getByRole('alert').textContent).toContain('d is not a directory git can write into');
  expect(screen.queryByRole('textbox', { name: 'Output' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
});

test('typing into a conflict\'s block makes it the user\'s: its line checkboxes and conflict toggle are disabled, the other conflict\'s are not', async () => {
  await show();
  const at = output().value.indexOf('o2\n');
  fireEvent.change(output(), { target: { value: `${output().value.slice(0, at)}mine${output().value.slice(at)}` } });
  for (const name of ['Take conflict 2 from current', 'Take conflict 2 from incoming', 'Take line 4 from current', 'Take line 4 from incoming']) expect(box(name).disabled).toBe(true);
  for (const name of ['Take conflict 1 from current', 'Take line 2 from incoming']) expect(box(name).disabled).toBe(false);
});
