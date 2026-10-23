import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';
import { Shell } from '@/shell/Shell';
import { Toasts } from '@/shell/Toasts';
import { activityStore } from '@/state/useActivity';
import { dispatchTabs } from '@/state/tabs';
import { entry } from '@/test/fixtures';
import { COMMITTED, HEAD, subEntry, submoduleWorld } from '@/test/submoduleWorld';
import type { SubmoduleEntry } from './api';

afterEach(() => { toast.dismiss(); });

const APP = { project: 'app', worktree: null };

async function show(list: SubmoduleEntry[] | (() => SubmoduleEntry[])) {
  const w = submoduleWorld({ list: typeof list === 'function' ? list : () => list });
  render(<><Shell /><Toasts /></>);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  const panel = await screen.findByRole('region', { name: 'Submodules' });
  return { w, panel };
}
const badgesOf = (panel: HTMLElement, path: string) => within(within(panel).getByRole('list', { name: `Status of ${path}` })).getAllByRole('listitem').map((li) => li.textContent);

test('rows show status badges by accessible name, the count, and the checked-out and recorded commits', async () => {
  const { panel } = await show([
    subEntry({ path: 'a-clean' }),
    subEntry({ path: 'b-uninit', initialized: false, populated: false, resolvedUrl: null, head: null }),
    subEntry({ path: 'c-notcloned', populated: false, head: null }),
    subEntry({ path: 'd-moved', head: HEAD, outOfSync: true, modified: true, untracked: true }),
    subEntry({ path: 'e-new', added: true, committed: null }),
    subEntry({ path: 'f-conflict', conflicted: true, recorded: null }),
    subEntry({ path: 'g-bad', blocked: 'name', urlProblem: 'invalid remote url: a <transport>:: url runs a remote helper' }),
    subEntry({ path: 'h-ghost', recorded: null, committed: null }),
    subEntry({ path: 'i-typed', recorded: null, typeChanged: true }),
  ]);
  await within(panel).findByText('a-clean');
  expect(within(panel).getByRole('heading', { name: 'Submodules (9)' })).toBeTruthy();
  expect(within(panel).queryByRole('list', { name: 'Status of a-clean' })).toBeNull();
  expect(badgesOf(panel, 'b-uninit')).toEqual(['Uninitialised']);
  expect(badgesOf(panel, 'c-notcloned')).toEqual(['Not cloned']);
  expect(badgesOf(panel, 'd-moved')).toEqual(['Out of sync', 'Modified', 'Untracked']);
  expect(badgesOf(panel, 'e-new')).toEqual(['Added']);
  expect(badgesOf(panel, 'f-conflict')).toEqual(['Conflicted']);
  expect(badgesOf(panel, 'g-bad')).toEqual(['Blocked', 'URL refused']);
  expect(badgesOf(panel, 'h-ghost')).toEqual(['Not recorded']);
  expect(badgesOf(panel, 'i-typed')).toEqual(['Type changed']);
  const moved = within(panel).getByText('d-moved').closest('li')!;
  expect(within(moved).getByLabelText('Checked out').textContent).toBe(HEAD.slice(0, 7));
  expect(within(moved).getByLabelText('Recorded').textContent).toContain(COMMITTED.slice(0, 7));
});

test('empty state: "No submodules", Add… still offered, no Update all', async () => {
  const { panel } = await show([]);
  expect(await within(panel).findByText('No submodules')).toBeTruthy();
  expect(within(panel).getByRole('button', { name: 'Add…' })).toBeTruthy();
  expect(within(panel).queryByRole('button', { name: 'Update all' })).toBeNull();
});

test('Add… opens dialog and sends {url,path} (path defaulting from the url); name and branch only when given', async () => {
  const { w, panel } = await show([]);
  await userEvent.click(await within(panel).findByRole('button', { name: 'Add…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add a submodule' });
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Url' }), 'https://h/x/lib.git');
  expect((within(dialog).getByRole('textbox', { name: 'Path' }) as HTMLInputElement).placeholder).toBe('lib');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add submodule' }));
  await waitFor(() => expect(w.posts('submodule.add')).toEqual([{ url: 'https://h/x/lib.git', path: 'lib' }]));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a submodule' })).toBeNull());
  await userEvent.click(within(panel).getByRole('button', { name: 'Add…' }));
  const again = await screen.findByRole('dialog', { name: 'Add a submodule' });
  await userEvent.type(within(again).getByRole('textbox', { name: 'Url' }), '../sib.git');
  await userEvent.type(within(again).getByRole('textbox', { name: 'Path' }), 'vendor/s');
  await userEvent.type(within(again).getByRole('textbox', { name: 'Name' }), 'sib');
  await userEvent.type(within(again).getByRole('textbox', { name: 'Branch' }), 'main');
  await userEvent.click(within(again).getByRole('button', { name: 'Add submodule' }));
  await waitFor(() => expect(w.posts('submodule.add')[1]).toEqual({ url: '../sib.git', path: 'vendor/s', name: 'sib', branch: 'main' }));
});

test('an Add refusal stays in the dialog with git\'s stderr as text', async () => {
  const w = submoduleWorld({ answers: { 'submodule.add': new Response(JSON.stringify({ error: 'git does not allow it', code: 'SUBMODULE_TRANSPORT_BLOCKED', stderr: "fatal: transport 'file' not allowed" }), { status: 409 }) } });
  render(<><Shell /><Toasts /></>);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  const panel = await screen.findByRole('region', { name: 'Submodules' });
  await userEvent.click(await within(panel).findByRole('button', { name: 'Add…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add a submodule' });
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Url' }), '/srv/x.git');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add submodule' }));
  const alert = await within(dialog).findByRole('alert');
  expect(within(alert).getByText('git does not allow it')).toBeTruthy();
  expect(within(alert).getByText("fatal: transport 'file' not allowed")).toBeTruthy();
  expect(w.posts('submodule.add')).toHaveLength(1);
});

test('Update all sends every unblocked, recorded path', async () => {
  const { w, panel } = await show([subEntry({ path: 'a' }), subEntry({ path: 'b', blocked: 'escapes' }), subEntry({ path: 'c' }), subEntry({ path: 'd', recorded: null, committed: null })]);
  await userEvent.click(await within(panel).findByRole('button', { name: 'Update all' }));
  await waitFor(() => expect(w.posts('submodule.update')).toEqual([{ paths: ['a', 'c'] }]));
});

test('the list is read again after a finished write on the project, not after a read or another project', async () => {
  let n = 0;
  const { w, panel } = await show(() => { n++; return [subEntry()]; });
  await within(panel).findByText('libs/a');
  const count = () => w.fetch.count('POST api/ops/submodule.list');
  const before = count();
  act(() => activityStore.set({ entries: [entry({ id: 50, kind: 'read', status: 'ok' }), entry({ id: 51, kind: 'write', status: 'ok', target: { project: 'other', worktree: null } })], error: null }));
  expect(count()).toBe(before);
  act(() => activityStore.set({ entries: [entry({ id: 52, kind: 'write', status: 'ok' })], error: null }));
  await waitFor(() => expect(count()).toBe(before + 1));
  expect(n).toBeGreaterThan(0);
});

test('duplicate declarations (one path under two names, one name at two paths) render every row, keyed by name and path (no duplicate-key warning)', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { panel } = await show([
    subEntry({ name: 'one', path: 'libs/a', blocked: 'duplicate' }), subEntry({ name: 'two', path: 'libs/a', blocked: 'duplicate' }),
    subEntry({ name: 'libA', path: 'evil', blocked: 'duplicate' }), subEntry({ name: 'libA', path: 'libA', blocked: 'duplicate' }),
  ]);
  await waitFor(() => expect(within(panel).getAllByRole('button', { name: 'libs/a' })).toHaveLength(2));
  expect(within(panel).getByRole('button', { name: 'evil' })).toBeTruthy();
  expect(within(panel).getByRole('button', { name: 'libA' })).toBeTruthy();
  expect(badgesOf(panel, 'evil')).toEqual(['Blocked']);
  expect(err.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
  err.mockRestore();
});
