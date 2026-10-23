import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { Shell } from '@/shell/Shell';
import { getGraph } from '@/state/graph';
import { openStashDialog, stashDialogStore } from '@/state/stashDialog';
import { dispatchTabs } from '@/state/tabs';
import { dfile } from '@/test/diffFixtures';
import { json } from '@/test/fixtures';
import { stashFx, stashWorld, W } from '@/test/stashWorld';
import { openStashSave } from './actions';
import { StashToaster } from './StashToaster';

afterEach(() => { toast.dismiss(); });

const APP = { project: 'app', worktree: null };
const PUSHED = { oid: W, selector: 'stash@{0}' };

async function world(w: Parameters<typeof stashWorld>[0] = {}) {
  const x = stashWorld({
    unstaged: [dfile({ path: 'a.txt' }), dfile({ path: 'new.txt', status: '?' }), dfile({ path: 'to.txt', oldPath: 'from.txt', status: 'R' })],
    staged: [dfile({ path: 'a.txt' }), dfile({ path: 's.txt' })],
    ...w,
    answers: { 'stash.push': PUSHED, 'stash.pushLines': PUSHED, ...w.answers },
  });
  render(<><Shell /><StashToaster /></>);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await waitFor(() => expect(getGraph(APP).refs).not.toBeNull());
  await screen.findByRole('button', { name: 'Stash changes…' });
  return x;
}
const dialog = (name: string) => screen.findByRole('dialog', { name });
const box = (d: HTMLElement, name: string | RegExp) => within(d).getByRole('checkbox', { name }) as HTMLInputElement;

test('the Changes panel\'s "Stash changes…" opens the save dialog; all changes sends only what was chosen', async () => {
  const w = await world();
  await userEvent.click(screen.getAllByRole('button', { name: 'Stash changes…' })[0]);
  const d = await dialog('Stash changes');
  expect((within(d).getByRole('radio', { name: 'All changes' }) as HTMLInputElement).checked).toBe(true);
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(w.posts('stash.push')).toEqual([{}]));
  await waitFor(() => expect(stashDialogStore.get()).toBeNull());
  act(() => openStashSave(APP, { mode: 'all' }));
  const d2 = await dialog('Stash changes');
  await userEvent.type(within(d2).getByRole('textbox', { name: 'Stash message' }), '  wip  ');
  await userEvent.click(box(d2, 'Include untracked files'));
  await userEvent.click(box(d2, 'Keep staged changes'));
  await userEvent.click(within(d2).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(w.posts('stash.push').at(-1)).toEqual({ message: 'wip', includeUntracked: true, keepIndex: true }));
});

test('selected files: one row per path; a rename sends both paths; ticking an untracked file forces Include untracked', async () => {
  const w = await world();
  act(() => openStashSave(APP, { mode: 'files' }));
  const d = await dialog('Stash changes');
  const rows = within(within(d).getByRole('list', { name: 'Files to stash' })).getAllByRole('checkbox');
  expect(rows).toHaveLength(4);
  expect(within(d).getByRole('button', { name: 'Stash' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(box(d, /to\.txt/));
  expect(box(d, 'Include untracked files').checked).toBe(false);
  await userEvent.click(box(d, /new\.txt/));
  expect(box(d, 'Include untracked files').checked).toBe(true);
  expect(box(d, 'Include untracked files').disabled).toBe(true);
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(w.posts('stash.push')).toEqual([{ paths: ['new.txt', 'from.txt', 'to.txt'], includeUntracked: true }]));
});

test('staged only sends {staged: true} and disables both checkboxes', async () => {
  const w = await world();
  act(() => openStashSave(APP, { mode: 'all' }));
  const d = await dialog('Stash changes');
  await userEvent.click(box(d, 'Include untracked files'));
  await userEvent.click(within(d).getByRole('radio', { name: 'Staged only' }));
  expect(box(d, 'Include untracked files').disabled).toBe(true);
  expect(box(d, 'Include untracked files').checked).toBe(false);
  expect(box(d, 'Keep staged changes').disabled).toBe(true);
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(w.posts('stash.push')).toEqual([{ staged: true }]));
});

test('a refused save keeps the dialog open with the error and git\'s stderr', async () => {
  await world({ answers: { 'stash.push': json({ error: 'there are no local changes to stash', code: 'NOTHING_TO_STASH', stderr: 'detail' }, 409) } });
  act(() => openStashSave(APP, { mode: 'all' }));
  const d = await dialog('Stash changes');
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  const alert = await within(d).findByRole('alert');
  expect(alert.textContent).toContain('there are no local changes to stash');
  expect(alert.textContent).toContain('detail');
  expect(stashDialogStore.get()?.kind).toBe('save');
});

test('lines mode names the lines and the file, offers only the message, and sends the selection to stash.pushLines', async () => {
  const w = await world();
  const request = { path: 'a.txt', context: 3 as const, hunks: [{ header: '@@ -1 +1 @@', lines: [{ index: 0, text: 'x' }, { index: 1, text: 'y' }] }] };
  act(() => openStashSave(APP, { mode: 'lines', request, count: 2 }));
  const d = await dialog('Stash changes');
  expect(within(d).getByText('2 lines of a.txt')).toBeTruthy();
  expect(within(d).queryByRole('radiogroup', { name: 'What to stash' })).toBeNull();
  expect(within(d).queryByRole('checkbox')).toBeNull();
  await userEvent.type(within(d).getByRole('textbox', { name: 'Stash message' }), 'part');
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(w.posts('stash.pushLines')).toEqual([{ ...request, message: 'part' }]));
  expect(w.posts('stash.push')).toEqual([]);
});

test('rename shows "A renamed stash moves to the top (stash@{0})." and sends the new message by oid', async () => {
  const w = await world({ answers: { 'stash.rename': { oid: 'f'.repeat(40), previous: W } } });
  act(() => openStashDialog({ kind: 'rename', tab: APP, stash: stashFx({ selector: 'stash@{3}' }) }));
  const d = await dialog('Rename stash@{3}');
  expect(within(d).getByText('A renamed stash moves to the top (stash@{0}).')).toBeTruthy();
  const input = within(d).getByRole('textbox', { name: 'Stash message' }) as HTMLInputElement;
  expect(input.value).toBe('my work');
  expect(within(d).getByRole('button', { name: 'Rename' }).hasAttribute('disabled')).toBe(true);
  await userEvent.clear(input);
  await userEvent.type(input, 'better');
  await userEvent.click(within(d).getByRole('button', { name: 'Rename' }));
  await waitFor(() => expect(w.posts('stash.rename')).toEqual([{ oid: W, message: 'better' }]));
});

test('branch: CC_OWNED_BRANCH about HEAD → confirm with C5\'s wording → resend with ccOwned; Cancel sends nothing more', async () => {
  let calls = 0;
  const w = await world({
    answers: {
      'stash.branch': (p: { ccOwned?: boolean }) => (p.ccOwned
        ? { ref: 'refs/heads/nb', base: 'a'.repeat(40), conflicts: [], dropped: true }
        : (calls++, json({ error: 'cc', code: 'CC_OWNED_BRANCH', branches: ['code-conductor/wt'], head: true }, 409))),
    },
  });
  const open = async () => {
    act(() => openStashDialog({ kind: 'branch', tab: APP, stash: stashFx() }));
    const d = await dialog('Create branch from stash@{0}');
    await userEvent.type(within(d).getByRole('textbox', { name: 'Branch name' }), 'nb');
    await userEvent.click(within(d).getByRole('button', { name: 'Create branch' }));
    return screen.findByRole('dialog', { name: 'Switching to nb?' });
  };
  let c = await open();
  expect(c.textContent).toContain("This checkout is code-conductor's worktree on code-conductor/wt.");
  await userEvent.click(within(c).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(w.posts('stash.branch')).toEqual([{ oid: W, name: 'nb' }]);
  c = await open();
  await userEvent.click(within(c).getByRole('button', { name: 'Switch anyway' }));
  await waitFor(() => expect(w.posts('stash.branch')).toEqual([{ oid: W, name: 'nb' }, { oid: W, name: 'nb' }, { oid: W, name: 'nb', ccOwned: true }]));
  expect(calls).toBe(2);
});

test('branch: any other refusal stays in the dialog', async () => {
  await world({ answers: { 'stash.branch': json({ error: 'branch nb already exists', code: 'REF_EXISTS' }, 409) } });
  act(() => openStashDialog({ kind: 'branch', tab: APP, stash: stashFx() }));
  const d = await dialog('Create branch from stash@{0}');
  await userEvent.type(within(d).getByRole('textbox', { name: 'Branch name' }), 'nb');
  await userEvent.click(within(d).getByRole('button', { name: 'Create branch' }));
  expect((await within(d).findByRole('alert')).textContent).toContain('branch nb already exists');
});

test('untrusted text in a dialog renders as text: a path and a subject', async () => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  await world({ unstaged: [dfile({ path: evil })], staged: [] });
  act(() => openStashSave(APP, { mode: 'files', paths: [evil] }));
  const d = await dialog('Stash changes');
  expect(within(d).getAllByText(evil).length).toBeGreaterThan(0);
  act(() => openStashDialog({ kind: 'rename', tab: APP, stash: stashFx({ subject: `On main: ${evil}` }) }));
  const r = await dialog('Rename stash@{0}');
  expect(within(r).getByText(`On main: ${evil}`)).toBeTruthy();
  expect(document.querySelector('[role="dialog"] img')).toBeNull();
  expect((window as { __pwned?: number }).__pwned).toBeUndefined();
});

const toastTexts = () => [...screen.getByRole('region', { name: /Notifications/ }).querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? '');

test('a failed save that git had stored as a stash: the error stays in the dialog and a toast says the stash exists', async () => {
  await world({ answers: { 'stash.push': json({ error: 'git stash exited with 1 after storing stash@{0}', code: 'GIT_FAILED', oid: W, selector: 'stash@{0}', stderr: 'patch failed' }, 422) } });
  act(() => openStashSave(APP, { mode: 'staged' }));
  const d = await dialog('Stash changes');
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  expect((await within(d).findByRole('alert')).textContent).toContain('after storing stash@{0}');
  await waitFor(() => expect(toastTexts().join('\n')).toContain('A stash was created despite the error'));
  expect(toastTexts().join('\n')).toContain('Your changes are in stash@{0}');
});

test('a failed save that stored nothing shows no such toast', async () => {
  await world({ answers: { 'stash.push': json({ error: 'git stash exited with 1', code: 'GIT_FAILED', stderr: 'boom' }, 422) } });
  act(() => openStashSave(APP, { mode: 'all' }));
  const d = await dialog('Stash changes');
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await within(d).findByRole('alert');
  expect(toastTexts().join('\n')).not.toContain('A stash was created');
});

test('an unverified save (another session stashed at the same moment) closes the dialog and says to check the list', async () => {
  await world({ answers: { 'stash.push': { oid: null, selector: null, unverified: true, undo: {} } } });
  act(() => openStashSave(APP, { mode: 'all' }));
  const d = await dialog('Stash changes');
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(toastTexts().join('\n')).toContain('Stashed (another stash was saved at the same moment: check the stash list)'));
  expect(stashDialogStore.get()).toBeNull();
});

