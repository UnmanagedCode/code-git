import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { lfsDialogStore, openLfsDialog } from '@/state/lfsDialog';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import type { LfsFile, LfsStatus } from './api';
import { LfsHost } from './LfsHost';

afterEach(() => { toast.dismiss(); });

const T = { project: 'app', worktree: null };
const OK = (result: unknown) => ({ ok: true, result });
const READY: LfsStatus = { available: true, version: '3.3.0', supported: true, filters: true, attributes: 'ok', patterns: ['*.bin', '<b>x</b>'] };
const FILES: LfsFile[] = [{ path: '<i>a</i>.bin', size: 2048, oid: 'f'.repeat(64), downloaded: false }];

function world(status: LfsStatus) {
  const f = stubGraph(linearWorld(1), {
    'POST api/ops/lfs.status': OK(status),
    'POST api/ops/lfs.files': OK({ files: FILES }),
    'POST api/ops/lfs.track': OK({ pattern: '*.psd' }),
    'POST api/ops/lfs.untrack': OK({ pattern: '*.bin', removed: true }),
    'POST api/ops/lfs.pull': OK({}),
    'POST api/ops/lfs.prune': OK({}),
  });
  render(<LfsHost />);
  act(() => openLfsDialog(T));
  return {
    posts: (op: string) => f.calls.filter((c) => c.url.pathname.endsWith(`/ops/${op}`)).map((c) => (c.body as { params: unknown }).params),
    lfsOps: () => f.calls.map((c) => c.url.pathname.split('/ops/')[1]).filter((n) => n?.startsWith('lfs.')),
  };
}
const dialog = () => screen.findByRole('dialog', { name: 'Git LFS' });

test('git-lfs absent, too old, or without filter config: the dialog says so; absent and too old offer no op', async () => {
  world({ available: false, version: null, supported: false, filters: null, attributes: null, patterns: null });
  let d = await dialog();
  await within(d).findByText("git-lfs is not installed on this project's System.");
  expect(within(d).queryByRole('button', { name: 'Pull' })).toBeNull();
  expect(within(d).queryByRole('button', { name: 'Prune…' })).toBeNull();
  act(() => lfsDialogStore.set(null));
  world({ available: true, version: '3.1.4', supported: false, filters: null, attributes: null, patterns: null });
  d = await dialog();
  await within(d).findByText('git-lfs 3.1.4 is installed; code-git needs git-lfs 3.2.0 or later.');
  expect(within(d).queryByRole('button', { name: 'Pull' })).toBeNull();
  act(() => lfsDialogStore.set(null));
  world({ ...READY, filters: false });
  d = await dialog();
  const note = await within(d).findByText(/The LFS filter is not configured/);
  expect(note.textContent).toContain('git lfs install');
});

test('opening the dialog only reads (lfs.status); the files are listed on request, and again after each op once listed', async () => {
  const w = world(READY);
  const d = await dialog();
  await within(d).findByText('*.bin');
  expect(w.lfsOps()).toEqual(['lfs.status']);
  expect(within(d).getByText(/may create/).textContent).toContain('install its hooks');
  await userEvent.click(within(d).getByRole('button', { name: 'List files' }));
  await within(d).findByText('<i>a</i>.bin');
  expect(w.posts('lfs.files')).toHaveLength(1);
  await userEvent.click(within(d).getByRole('button', { name: 'Pull' }));
  await waitFor(() => expect(w.posts('lfs.files')).toHaveLength(2));
  expect(w.posts('lfs.pull')).toEqual([{}]);
});

test('without listing, an op re-reads the status only', async () => {
  const w = world(READY);
  const d = await dialog();
  await within(d).findByText('*.bin');
  await userEvent.click(within(d).getByRole('button', { name: 'Untrack *.bin' }));
  await waitFor(() => expect(w.posts('lfs.untrack')).toEqual([{ pattern: '*.bin' }]));
  await waitFor(() => expect(w.posts('lfs.status')).toHaveLength(2));
  expect(w.posts('lfs.files')).toEqual([]);
});

test('Track sends the typed pattern', async () => {
  const w = world(READY);
  const d = await dialog();
  await userEvent.type(within(d).getByRole('textbox', { name: 'Pattern' }), '  *.psd ');
  await userEvent.click(within(d).getByRole('button', { name: 'Track' }));
  await waitFor(() => expect(w.posts('lfs.track')).toEqual([{ pattern: '*.psd' }]));
});

test('Prune sends nothing until its destructive step is confirmed; Cancel goes back to the dialog', async () => {
  const w = world(READY);
  let d = await dialog();
  await userEvent.click(within(d).getByRole('button', { name: 'Prune…' }));
  let step = await screen.findByRole('dialog', { name: 'Prune LFS objects?' });
  expect(step.textContent).toContain('they must be downloaded again');
  await userEvent.click(within(step).getByRole('button', { name: 'Cancel' }));
  d = await dialog();
  expect(w.posts('lfs.prune')).toEqual([]);
  await userEvent.click(within(d).getByRole('button', { name: 'Prune…' }));
  step = await screen.findByRole('dialog', { name: 'Prune LFS objects?' });
  await userEvent.click(within(step).getByRole('button', { name: 'Prune' }));
  await waitFor(() => expect(w.posts('lfs.prune')).toEqual([{}]));
  await dialog();
});

test('patterns and paths render as text, never markup', async () => {
  world(READY);
  const d = await dialog();
  await within(d).findByText('<b>x</b>');
  await userEvent.click(within(d).getByRole('button', { name: 'List files' }));
  await within(d).findByText('<i>a</i>.bin');
  expect(d.querySelector('b, i')).toBeNull();
});
