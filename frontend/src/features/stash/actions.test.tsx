import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import type { DiffFileCtx } from '@/features/diff/actions';
import type { FileCtx, StashCtx, WipCtx } from '@/features/graph/contexts';
import { json } from '@/test/fixtures';
import { actionsFor, labelOf } from '@/shell/menus';
import { Shell } from '@/shell/Shell';
import { StashToaster } from './StashToaster';
import { getGraph } from '@/state/graph';
import { stashDialogStore } from '@/state/stashDialog';
import { dispatchTabs } from '@/state/tabs';
import { dfile } from '@/test/diffFixtures';
import { I, stashFx, stashWorld, U, W } from '@/test/stashWorld';
import type { WorkdirFileCtx } from '@/features/workdir/actions';

afterEach(() => { toast.dismiss(); });

const APP = { project: 'app', worktree: null };
const STASH = stashFx();
const toastTexts = () => [...screen.getByRole('region', { name: /Notifications/ }).querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? '');

async function world(w: Parameters<typeof stashWorld>[0] = {}) {
  const x = stashWorld(w);
  render(<><Shell /><StashToaster /></>);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await waitFor(() => expect(getGraph(APP).refs?.stashes).toHaveLength(1));
  // The Changes panel (and its ConfirmHost) is up.
  await screen.findByRole('button', { name: 'Stash changes…' });
  return x;
}
const run = async <C,>(context: string, ctx: C, label: string) => {
  const a = actionsFor<C>(context, ctx).find((x) => labelOf(x, ctx) === label);
  expect(a, label).toBeTruthy();
  await act(async () => { await a!.run!(ctx); });
};
const stashCtx: StashCtx = { tab: APP, stash: STASH };

test('the stash menu lists Apply, Apply with staged changes, Pop, Create branch…, Rename…, Drop… first, in that order', async () => {
  await world();
  const labels = actionsFor('stash', stashCtx).map((a) => labelOf(a, stashCtx));
  expect(labels.slice(0, 6)).toEqual(['Apply', 'Apply with staged changes', 'Pop', 'Create branch…', 'Rename…', 'Drop…']);
  expect(actionsFor('stash', stashCtx).find((a) => labelOf(a, stashCtx) === 'Drop…')?.destructive).toBe(true);
});

test('Drop asks first and sends nothing on Cancel; Confirm sends {oid}', async () => {
  const w = await world();
  let done: Promise<void> | undefined;
  act(() => { done = actionsFor('stash', stashCtx).find((a) => labelOf(a, stashCtx) === 'Drop…')!.run!(stashCtx) as Promise<void>; });
  const dialog = await screen.findByRole('dialog', { name: 'Drop stash@{0}?' });
  expect(within(dialog).getByText('On main: my work')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await act(async () => { await done; });
  expect(w.posts('stash.drop')).toEqual([]);
  act(() => { done = actionsFor('stash', stashCtx).find((a) => labelOf(a, stashCtx) === 'Drop…')!.run!(stashCtx) as Promise<void>; });
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Drop stash@{0}?' })).getByRole('button', { name: 'Drop stash' }));
  await act(async () => { await done; });
  expect(w.posts('stash.drop')).toEqual([{ oid: W }]);
  await waitFor(() => expect(toastTexts()).toContain('Dropped stash@{0}'));
});

test('Apply / Apply with staged changes / Pop send the oid (never a selector)', async () => {
  const w = await world({ answers: { 'stash.apply': { conflicts: [] }, 'stash.pop': { conflicts: [], dropped: true } } });
  await run('stash', stashCtx, 'Apply');
  await run('stash', stashCtx, 'Apply with staged changes');
  await run('stash', stashCtx, 'Pop');
  expect(w.posts('stash.apply')).toEqual([{ oid: W }, { oid: W, index: true }]);
  expect(w.posts('stash.pop')).toEqual([{ oid: W }]);
  await waitFor(() => expect(toastTexts()).toContain('Popped stash@{0}'));
});

test('a conflict result shows the warning toast and refreshes the Changes lists', async () => {
  const w = await world({ answers: { 'stash.pop': { conflicts: ['a.txt', 'b.txt'], dropped: false } } });
  const lists = w.fetch.count('POST api/ops/diff.files');
  const refs = w.fetch.count('POST api/ops/graph.refs');
  await run('stash', stashCtx, 'Pop');
  await waitFor(() => expect(toastTexts().join('\n')).toContain('Applied stash@{0} with conflicts in 2 files'));
  expect(toastTexts().join('\n')).toContain('a.txt, b.txt. The stash was kept.');
  expect(w.fetch.count('POST api/ops/diff.files')).toBeGreaterThanOrEqual(lists + 2);
  expect(w.fetch.count('POST api/ops/graph.refs')).toBeGreaterThan(refs);
});

test('a CHECKOUT_CONFLICT shows "Local changes would be overwritten" naming the files', async () => {
  await world({ answers: { 'stash.apply': json({ error: 'local changes would be overwritten', code: 'CHECKOUT_CONFLICT', files: ['a.txt'] }, 409) } });
  await run('stash', stashCtx, 'Apply');
  await waitFor(() => expect(toastTexts().join('\n')).toContain('Local changes would be overwritten'));
  expect(toastTexts().join('\n')).toContain('a.txt. Commit, stash or discard these changes first.');
});

test('a pop whose drop raced shows a warning that the stash was not dropped', async () => {
  await world({ answers: { 'stash.pop': { conflicts: [], dropped: false, dropError: 'STASH_MOVED' } } });
  await run('stash', stashCtx, 'Pop');
  await waitFor(() => expect(toastTexts().join('\n')).toContain('Applied stash@{0}; it was not dropped'));
});

test('Stash changes… is on the own checkout\'s WIP menu only; Stash this file… opens the save dialog with that file ticked', async () => {
  await world({ unstaged: [dfile({ path: 'a.txt' }), dfile({ path: 'b.txt' })] });
  const own: WipCtx = { tab: APP, checkout: APP, name: 'main', isOwn: true };
  expect(actionsFor('wip', { ...own, isOwn: false }).map((a) => labelOf(a, own))).not.toContain('Stash changes…');
  await run('wip', own, 'Stash changes…');
  expect(stashDialogStore.get()).toEqual({ kind: 'save', tab: APP, preset: { mode: 'all' } });
  act(() => stashDialogStore.set(null));
  const fileCtx: WorkdirFileCtx = { tab: APP, file: dfile({ path: 'b.txt' }), section: 'unstaged' };
  await run('workdir-file', fileCtx, 'Stash this file…');
  const dialog = await screen.findByRole('dialog', { name: 'Stash changes' });
  expect((within(dialog).getByRole('radio', { name: 'Selected files' }) as HTMLInputElement).checked).toBe(true);
  expect((within(dialog).getByRole('checkbox', { name: /b\.txt/ }) as HTMLInputElement).checked).toBe(true);
  expect((within(dialog).getByRole('checkbox', { name: /a\.txt/ }) as HTMLInputElement).checked).toBe(false);
});

test('Apply this file (details) is offered for a stash commit only and sends {oid, path}', async () => {
  const w = await world({ answers: { 'stash.applyFile': { oid: W, path: 'a.txt', part: 'tracked' } } });
  const ctx: FileCtx = { tab: APP, commit: W, parent: null, file: { status: 'M', path: 'a.txt', oldPath: null } };
  expect(actionsFor('file', { ...ctx, commit: 'f'.repeat(40) }).map((a) => labelOf(a, ctx))).not.toContain('Apply this file');
  await run('file', ctx, 'Apply this file');
  expect(w.posts('stash.applyFile')).toEqual([{ oid: W, path: 'a.txt' }]);
  await waitFor(() => expect(toastTexts()).toContain('Applied a.txt from stash@{0}'));
});

test('Apply file from stash (diff list) is offered for one file of the All changes or Untracked view, with the W oid', async () => {
  const w = await world({ answers: { 'stash.applyFile': { oid: W, path: 'u.txt', part: 'untracked' } } });
  const ctx = (rev: string, n = 1): DiffFileCtx => ({ tab: APP, source: { kind: 'commit', rev }, files: Array.from({ length: n }, (_, i) => dfile({ path: i ? `x${i}` : 'u.txt' })) });
  const offered = (c: DiffFileCtx) => actionsFor('diff-file', c).map((a) => labelOf(a, c)).includes('Apply file from stash');
  expect([offered(ctx(W)), offered(ctx(U)), offered(ctx(I)), offered(ctx(W, 2)), offered(ctx('f'.repeat(40)))]).toEqual([true, true, false, false, false]);
  await run('diff-file', ctx(U), 'Apply file from stash');
  expect(w.posts('stash.applyFile')).toEqual([{ oid: W, path: 'u.txt' }]);
});

test('an untrusted stash subject renders as text in the drop confirmation', async () => {
  const evil = stashFx({ subject: 'On main: <img src=x onerror="window.__pwned=1">' });
  await world({ stashes: [evil] });
  const ctx: StashCtx = { tab: APP, stash: evil };
  act(() => { void actionsFor('stash', ctx).find((a) => labelOf(a, ctx) === 'Drop…')!.run!(ctx); });
  const dialog = await screen.findByRole('dialog', { name: 'Drop stash@{0}?' });
  expect(within(dialog).getByText('On main: <img src=x onerror="window.__pwned=1">')).toBeTruthy();
  expect(dialog.querySelector('img')).toBeNull();
  expect((window as { __pwned?: number }).__pwned).toBeUndefined();
});
