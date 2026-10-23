import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { openDiff } from '@/features/diff/openDiff';
import { Shell } from '@/shell/Shell';
import { lineSelectionStore } from '@/state/lineSelection';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { dfile, fdiff, hunk } from '@/test/diffFixtures';
import { workdirWorld, type WorkdirWorld } from '@/test/workdirWorld';

// The line stash's entry points in the diff (C4's line staging controls): offered for an unstaged file with nothing staged.

afterEach(() => { toast.dismiss(); });

const APP = { project: 'app', worktree: null };
const H1 = '@@ -1,3 +1,3 @@ fn';
const H2 = '@@ -10,2 +10,2 @@';
const FD = fdiff([hunk(1, 1, [' a', '-foo(bar)', '+foo(baz)', ' b'], 'fn'), hunk(10, 10, ['-x', '+y', ' z'])]);
const M = dfile({ path: 'src/a.ts' });
const diff = () => screen.getByRole('region', { name: 'Diff' });
const btn = (name: string) => within(diff()).getByRole('button', { name });

async function show(kind: 'unstaged' | 'staged', w: WorkdirWorld) {
  const world = workdirWorld({ fileDiffs: { [M.path]: FD }, answers: { 'stash.pushLines': { oid: 'c'.repeat(40), selector: 'stash@{0}' } }, ...w });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await screen.findByRole('button', { name: 'Stash changes…' });
  act(() => openDiff(APP, { kind }, { path: M.path }));
  await waitFor(() => expect(within(diff()).getAllByRole('button', { name: /^Select (added|removed) line/ }).length).toBeGreaterThan(0));
  return world;
}

test('an unstaged file with nothing staged: "Stash hunk…" on each header and "Stash lines…" in the selection bar', async () => {
  await show('unstaged', { unstaged: [M], staged: [] });
  await waitFor(() => expect(within(diff()).getAllByRole('button', { name: 'Stash hunk…' })).toHaveLength(2));
  await userEvent.click(btn('Select added line 2'));
  expect(btn('Stash lines…')).toBeTruthy();
});

test('an unstaged file that also has staged changes offers neither', async () => {
  await show('unstaged', { unstaged: [M], staged: [M] });
  expect(within(diff()).queryAllByRole('button', { name: 'Stash hunk…' })).toEqual([]);
  await userEvent.click(btn('Select added line 2'));
  expect(within(diff()).queryByRole('button', { name: 'Stash lines…' })).toBeNull();
});

test('a staged diff offers no stash buttons', async () => {
  await show('staged', { unstaged: [], staged: [M] });
  expect(within(diff()).queryAllByRole('button', { name: 'Stash hunk…' })).toEqual([]);
  await userEvent.click(btn('Select added line 2'));
  expect(within(diff()).queryByRole('button', { name: 'Stash lines…' })).toBeNull();
});

test('Stash lines… sends C4\'s request shape to stash.pushLines and clears the selection on success', async () => {
  const w = await show('unstaged', { unstaged: [M], staged: [] });
  await userEvent.click(btn('Select added line 2'));
  await userEvent.click(btn('Select removed line 10'));
  await userEvent.click(btn('Stash lines…'));
  const d = await screen.findByRole('dialog', { name: 'Stash changes' });
  expect(within(d).getByText('2 lines of src/a.ts')).toBeTruthy();
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(w.posts('stash.pushLines')).toEqual([{
    path: 'src/a.ts', context: 3,
    hunks: [{ header: H1, lines: [{ index: 2, text: 'foo(baz)' }] }, { header: H2, lines: [{ index: 0, text: 'x' }] }],
  }]));
  await waitFor(() => expect(lineSelectionStore.get().get(tabKey(APP))?.keys.size ?? 0).toBe(0));
  expect(w.posts('stage.stageLines')).toEqual([]);
});

test('Stash hunk… sends the whole hunk', async () => {
  const w = await show('unstaged', { unstaged: [M], staged: [] });
  await userEvent.click(within(diff()).getAllByRole('button', { name: 'Stash hunk…' })[1]);
  const d = await screen.findByRole('dialog', { name: 'Stash changes' });
  expect(within(d).getByText('2 lines of src/a.ts')).toBeTruthy();
  await userEvent.click(within(d).getByRole('button', { name: 'Stash' }));
  await waitFor(() => expect(w.posts('stash.pushLines')).toEqual([
    { path: 'src/a.ts', context: 3, hunks: [{ header: H2, lines: [{ index: 0, text: 'x' }, { index: 1, text: 'y' }] }] },
  ]));
});

test('the Changes panel\'s "Stash changes…" is disabled with no changes', async () => {
  workdirWorld({ unstaged: [], staged: [] });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  const b = await screen.findByRole('button', { name: 'Stash changes…' });
  await waitFor(() => expect(b.hasAttribute('disabled')).toBe(true));
});
