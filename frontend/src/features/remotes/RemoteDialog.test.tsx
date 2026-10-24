import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { RefsPanel } from '@/features/graph/RefsPanel';
import { openRemoteDialog, remoteDialogStore } from '@/state/remoteDialog';
import { refusal, remote, remotesWorld, T } from '@/test/remotesWorld';
import { RemotesHost } from './RemotesHost';

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const submit = (name: string) => userEvent.click(screen.getByRole('button', { name }));
async function type(name: string, text: string) {
  await userEvent.clear(field(name));
  if (text) await userEvent.type(field(name), text);
}

test('add: a refusal (BAD_URL, REMOTE_EXISTS) shows inline and keeps the dialog open; success closes it and fetches the new remote', async () => {
  let answer: unknown = refusal('BAD_URL', 'invalid remote url: a <transport>:: url runs a remote helper', {}, 400);
  const w = remotesWorld({ answers: { 'remote.add': () => answer } });
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'add', tab: T }));
  await type('Name', 'up');
  await type('Fetch URL', 'ext::sh -c x');
  await submit('Add remote');
  expect((await screen.findByRole('alert')).textContent).toContain('a <transport>:: url runs a remote helper');
  expect(remoteDialogStore.get()?.kind).toBe('add');
  answer = refusal('REMOTE_EXISTS', 'a remote up already exists');
  await type('Fetch URL', 'https://h/up.git');
  await submit('Add remote');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('a remote up already exists'));
  answer = { name: 'up', undo: {} };
  await type('Push URL (optional)', 'git@h:up.git');
  await submit('Add remote');
  await waitFor(() => expect(remoteDialogStore.get()).toBeNull());
  expect(w.posts('remote.add').at(-1)).toEqual({ name: 'up', url: 'https://h/up.git', pushUrl: 'git@h:up.git' });
  await waitFor(() => expect(w.posts('remote.fetch')).toEqual([{ remote: 'up' }]));
});

test('add with "Fetch after adding" off fetches nothing', async () => {
  const w = remotesWorld();
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'add', tab: T }));
  await type('Name', 'up');
  await type('Fetch URL', '/srv/up.git');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Fetch after adding' }));
  await submit('Add remote');
  await waitFor(() => expect(remoteDialogStore.get()).toBeNull());
  expect(w.posts('remote.add')).toEqual([{ name: 'up', url: '/srv/up.git' }]);
  expect(w.posts('remote.fetch')).toEqual([]);
});

test('edit sends only what changed: the masked url is never written back; an emptied push url is removed; the field edits run before a rename', async () => {
  const origin = remote('origin', { urls: ['https://u:***@h/r.git'], displayUrl: 'https://u:***@h/r.git', pushUrls: ['git@h:p.git'], displayPushUrl: 'git@h:p.git' });
  const w = remotesWorld({ remotes: [origin] });
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'edit', tab: T, remote: 'origin' }));
  expect(field('Fetch URL').value).toBe('https://u:***@h/r.git');
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  await type('Push URL (empty: the fetch URL)', '');
  await submit('Save');
  await waitFor(() => expect(remoteDialogStore.get()).toBeNull());
  expect(w.posts('remote.edit')).toEqual([{ name: 'origin', pushUrl: null }]);
  act(() => openRemoteDialog({ kind: 'edit', tab: T, remote: 'origin' }));
  await type('Name', 'mirror');
  await type('Fetch URL', 'https://h/new.git');
  await submit('Save');
  await waitFor(() => expect(remoteDialogStore.get()).toBeNull());
  expect(w.posts('remote.edit').at(-1)).toEqual({ name: 'origin', url: 'https://h/new.git' });
  expect(w.posts('remote.rename')).toEqual([{ name: 'origin', newName: 'mirror' }]);
  const order = w.fetch.calls.map((c) => c.url.pathname).filter((p) => /remote\.(rename|edit)$/.test(p));
  expect(order.slice(-2)).toEqual(['/api/ops/remote.edit', '/api/ops/remote.rename']);
});

test('a rename that fails after the field edit: a retry edits the same remote again and renames, never a name that no longer exists', async () => {
  let renames = 0;
  const w = remotesWorld({ answers: { 'remote.rename': () => (renames++ === 0 ? refusal('REMOTE_EXISTS', 'a remote mirror already exists') : { name: 'mirror', undo: {} }) } });
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'edit', tab: T, remote: 'origin' }));
  await type('Name', 'mirror');
  await type('Fetch URL', 'https://h/new.git');
  await submit('Save');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('a remote mirror already exists'));
  expect(remoteDialogStore.get()?.kind).toBe('edit');
  await submit('Save');
  await waitFor(() => expect(remoteDialogStore.get()).toBeNull());
  expect(w.posts('remote.edit')).toEqual([{ name: 'origin', url: 'https://h/new.git' }, { name: 'origin', url: 'https://h/new.git' }]);
  expect(w.posts('remote.rename')).toEqual([{ name: 'origin', newName: 'mirror' }, { name: 'origin', newName: 'mirror' }]);
});

test('a field still holding the mask is never submitted: Save is refused inline until the whole url is retyped', async () => {
  const origin = remote('origin', { urls: ['https://u:***@h/r.git'], displayUrl: 'https://u:***@h/r.git', pushUrls: ['https://u:***@h/p.git'], displayPushUrl: 'https://u:***@h/p.git' });
  const w = remotesWorld({ remotes: [origin] });
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'edit', tab: T, remote: 'origin' }));
  const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  await userEvent.type(field('Fetch URL'), '2');
  expect(field('Fetch URL').value).toBe('https://u:***@h/r.git2');
  expect(save().disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('retype the whole URL');
  await submit('Save');
  await type('Fetch URL', 'https://u:new@h/r.git');
  expect(save().disabled).toBe(false);
  await userEvent.type(field('Push URL (empty: the fetch URL)'), 'x');
  expect(save().disabled).toBe(true);
  await type('Push URL (empty: the fetch URL)', 'https://u:***@h/other.git');
  expect(save().disabled).toBe(true);
  await type('Push URL (empty: the fetch URL)', '');
  await submit('Save');
  await waitFor(() => expect(remoteDialogStore.get()).toBeNull());
  expect(w.posts('remote.edit')).toEqual([{ name: 'origin', url: 'https://u:new@h/r.git', pushUrl: null }]);
  expect(JSON.stringify(w.posts('remote.edit'))).not.toContain('***');
});

test('edit of a remote whose raw url list holds several values (an empty reset too) disables that field and never sends it', async () => {
  const w = remotesWorld({ remotes: [remote('origin', { urls: ['/second.git'], displayUrl: '/second.git', multiUrl: true })] });
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'edit', tab: T, remote: 'origin' }));
  expect(field('Fetch URL').disabled).toBe(true);
  expect(field('Push URL (empty: the fetch URL)').disabled).toBe(false);
  expect(screen.getByRole('note').textContent).toContain('several fetch URLs');
  await type('Push URL (empty: the fetch URL)', '/p.git');
  await submit('Save');
  await waitFor(() => expect(w.posts('remote.edit')).toEqual([{ name: 'origin', pushUrl: '/p.git' }]));
});

test('a raw push url list of several values disables the push url field only', async () => {
  remotesWorld({ remotes: [remote('origin', { pushUrls: ['/p2.git'], displayPushUrl: '/p2.git', multiPushUrl: true })] });
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'edit', tab: T, remote: 'origin' }));
  expect([field('Fetch URL').disabled, field('Push URL (empty: the fetch URL)').disabled]).toEqual([false, true]);
  expect(screen.getByRole('note').textContent).toContain('several push URLs');
});

test('the Push dialog pushes the branch to the chosen remote under the typed name, setting the upstream by default', async () => {
  const w = remotesWorld({ remotes: [remote('origin'), remote('upstream')] });
  render(<RemotesHost />);
  act(() => openRemoteDialog({ kind: 'push', tab: T, branch: 'feature', remote: null }));
  expect((screen.getByRole('combobox', { name: 'Remote' }) as HTMLSelectElement).value).toBe('origin');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Remote' }), 'upstream');
  await type('Branch on the remote', 'feature/remote-name');
  expect((screen.getByRole('checkbox', { name: 'Set as upstream' }) as HTMLInputElement).checked).toBe(true);
  await submit('Push');
  await waitFor(() => expect(w.posts('remote.push')).toEqual([{ branch: 'feature', remote: 'upstream', to: 'feature/remote-name', setUpstream: true }]));
  expect(remoteDialogStore.get()).toBeNull();
  act(() => openRemoteDialog({ kind: 'push', tab: T, branch: 'main', remote: 'origin' }));
  expect((screen.getByRole('checkbox', { name: 'Set as upstream' }) as HTMLInputElement).checked).toBe(false);
});

test('the refs panel lists a remote with no fetched branch, and its Add remote button opens the add dialog', async () => {
  remotesWorld({ remotes: [remote('origin'), remote('empty')] });
  render(<RefsPanel tab={T} />);
  expect(await screen.findByRole('button', { name: 'empty' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Add remote' }));
  expect(remoteDialogStore.get()).toEqual({ kind: 'add', tab: T });
});
