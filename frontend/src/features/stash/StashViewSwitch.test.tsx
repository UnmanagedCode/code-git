import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { openDiff } from '@/features/diff/openDiff';
import { Shell } from '@/shell/Shell';
import { diffStore, type DiffTabState } from '@/state/diff';
import { getGraph } from '@/state/graph';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { dfile, filesResult } from '@/test/diffFixtures';
import { BASE, I, stashFx, stashWorld, U, W } from '@/test/stashWorld';

const APP = { project: 'app', worktree: null };
const diff = () => screen.getByRole('region', { name: 'Diff' });
const source = () => (diffStore.get().get(tabKey(APP)) as DiffTabState).source;

async function show(rev: string, w: Parameters<typeof stashWorld>[0] = {}) {
  const world = stashWorld({ commitFiles: [dfile({ path: 'a.txt' })], ...w });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await waitFor(() => expect(getGraph(APP).refs).not.toBeNull());
  act(() => openDiff(APP, { kind: 'commit', rev }));
  await waitFor(() => expect(within(diff()).getByRole('heading', { name: 'Diff source' }).textContent).toContain(rev.slice(0, 7)));
  return world;
}

test('a stash\'s diff shows the switch with exactly "All changes" / "Staged" / "Untracked", not "Compare with parent"', async () => {
  await show(W);
  const group = within(diff()).getByRole('radiogroup', { name: 'Stash view' });
  expect(within(group).getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual(['All changes', 'Staged', 'Untracked']);
  expect((within(group).getByRole('radio', { name: 'All changes' }) as HTMLInputElement).checked).toBe(true);
  expect(within(diff()).queryByRole('combobox', { name: 'Compare with parent' })).toBeNull();
});

test('clicking a view opens that part\'s diff; the I and U diffs keep the switch with their view checked', async () => {
  const w = await show(W);
  await userEvent.click(within(diff()).getByRole('radio', { name: 'Staged' }));
  expect(source()).toEqual({ kind: 'commit', rev: I });
  await waitFor(() => expect((within(diff()).getByRole('radio', { name: 'Staged' }) as HTMLInputElement).checked).toBe(true));
  await userEvent.click(within(diff()).getByRole('radio', { name: 'Untracked' }));
  expect(source()).toEqual({ kind: 'commit', rev: U });
  await waitFor(() => expect((within(diff()).getByRole('radio', { name: 'Untracked' }) as HTMLInputElement).checked).toBe(true));
  await userEvent.click(within(diff()).getByRole('radio', { name: 'All changes' }));
  expect(source()).toEqual({ kind: 'commit', rev: W, parent: 1 });
  const revs = w.posts('diff.files').map((p) => (p as { source: { rev?: string } }).source.rev).filter(Boolean);
  expect(revs).toEqual([W, I, U, W]);
});

test('a stash without untracked files offers no Untracked view', async () => {
  await show(W, { stashes: [stashFx({ parents: [BASE, I] })] });
  const group = within(diff()).getByRole('radiogroup', { name: 'Stash view' });
  expect(within(group).getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual(['All changes', 'Staged']);
});

test('a merge commit keeps the "Compare with parent" select and has no stash switch', async () => {
  const merge = '7'.repeat(40);
  await show(merge, { answers: { 'diff.files': () => filesResult([dfile()], { commit: { oid: merge, parents: [BASE, '8'.repeat(40)] } }) } });
  expect(within(diff()).getByRole('combobox', { name: 'Compare with parent' })).toBeTruthy();
  expect(within(diff()).queryByRole('radiogroup', { name: 'Stash view' })).toBeNull();
});
