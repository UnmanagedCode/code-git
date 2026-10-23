import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { LG_QUERY } from '@/lib/useMediaQuery';
import { Shell } from '@/shell/Shell';
import { diffStore } from '@/state/diff';
import { getSelection } from '@/state/graphSelection';
import { shownPanelStore } from '@/state/shownPanel';
import { dispatchTabs, tabsStore } from '@/state/tabs';
import { workdirOf } from '@/state/workdir';
import { dfile } from '@/test/diffFixtures';
import { summary } from '@/test/fixtures';
import { commit, oid, ref, refsResult } from '@/test/graphData';
import { workdirWorld } from '@/test/workdirWorld';

// C2's graph and C4's Changes panel together: the WIP row, the right slot, "Edit HEAD message", the narrow toolbar.

const APP = { project: 'app', worktree: null };
const HEAD = oid(2);

function screenWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === LG_QUERY ? wide : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
}

/** A two-commit history on main with a dirty working tree (so a WIP row), and the Changes routes. */
async function show(wide: boolean) {
  screenWidth(wide);
  const w = workdirWorld({
    unstaged: [dfile({ path: 'src/a.ts' })], staged: [],
    summary: summary({ head: { oid: HEAD, branch: 'main', unborn: false }, counts: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 } }),
    head: { summary: 'Second', description: 'Body' },
    answers: {
      'graph.refs': refsResult({ head: { oid: HEAD, branch: 'refs/heads/main', detached: false, unborn: false }, refs: [ref('refs/heads/main', HEAD, { isHead: true })] }),
      'graph.page': { items: [commit(HEAD, [oid(1)], { subject: 'Second' }), commit(oid(1), [], { subject: 'First' })], nextCursor: null },
      'graph.commit': { oid: oid(1), parents: [], author: { name: 'A', email: 'a@x', time: 1 }, committer: { name: 'A', email: 'a@x', time: 1 }, subject: 'First', body: '', coAuthors: [], signature: { status: 'N', signer: null, key: null }, files: [], filesError: null },
    },
  });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await waitFor(() => expect(row('wip:')).not.toBeNull());
  return w;
}
const row = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
const slot = () => document.querySelector<HTMLElement>('[data-slot-name=right]')!;
const changesInSlot = () => within(slot()).queryByRole('region', { name: 'Commit message' });
const detailsInSlot = () => within(slot()).queryByRole('complementary', { name: 'Commit details' });

test('wide: the right slot shows Changes with nothing selected, the details for a clicked commit, Changes again for the WIP row (focus stays in the graph)', async () => {
  await show(true);
  expect(changesInSlot()).not.toBeNull();
  expect(detailsInSlot()).toBeNull();
  fireEvent.click(row(oid(1))!);
  await waitFor(() => expect(detailsInSlot()).not.toBeNull());
  expect(changesInSlot()).toBeNull();
  fireEvent.click(row('wip:')!);
  await waitFor(() => expect(changesInSlot()).not.toBeNull());
  expect(detailsInSlot()).toBeNull();
  expect(workdirOf(APP).focus).toBeNull();
  // The keyboard focus is the graph's list, not the commit summary.
  expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Commits' }));
  expect(document.activeElement).not.toBe(within(changesInSlot()!).getByRole('textbox', { name: 'Summary' }));
  // No diff replaced the graph: the WIP row opens the panel, and the per-file diffs are its rows.
  expect(shownPanelStore.get().get('app\0')).toBeUndefined();
  await userEvent.click(within(within(slot()).getByRole('region', { name: 'Unstaged Files' })).getByText('src/a.ts'));
  expect(diffStore.get().get('app\0')?.source).toEqual({ kind: 'unstaged' });
});

test('wide: moving the selection onto the WIP row with the keyboard (no openWorkingTree) shows Changes, not the details', async () => {
  await show(true);
  fireEvent.click(row(oid(1))!);
  await waitFor(() => expect(detailsInSlot()).not.toBeNull());
  const list = screen.getByRole('listbox', { name: 'Commits' });
  fireEvent.keyDown(list, { key: 'k' });
  await waitFor(() => expect(getSelection(APP).items).toEqual([{ kind: 'commit', oid: HEAD }]));
  expect(detailsInSlot()).not.toBeNull();
  fireEvent.keyDown(list, { key: 'k' });
  await waitFor(() => expect(getSelection(APP).items).toEqual([{ kind: 'wip', checkout: APP }]));
  await waitFor(() => expect(changesInSlot()).not.toBeNull());
  expect(detailsInSlot()).toBeNull();
  // Reached by the keyboard move alone: no focus request was made.
  expect(workdirOf(APP).focus).toBeNull();
  expect(workdirOf(APP).dialogOpen).toBe(false);
});

test('narrow: a WIP row click opens the Changes dialog', async () => {
  await show(false);
  fireEvent.click(row('wip:')!);
  const d = await screen.findByRole('dialog', { name: 'Changes' });
  expect(within(d).getByRole('region', { name: 'Unstaged Files' })).toBeTruthy();
});

test('narrow: the graph toolbar has Refs, Compare and Changes (n) side by side; Changes (n) opens the dialog', async () => {
  await show(false);
  const refsBtn = screen.getByRole('button', { name: 'Refs' });
  const bar = refsBtn.parentElement!;
  expect(within(bar).getAllByRole('button').slice(0, 3).map((b) => b.textContent?.trim())).toEqual(['Refs', 'Compare', 'Changes (1)']);
  await userEvent.click(within(bar).getByRole('button', { name: 'Changes (1)' }));
  expect(await screen.findByRole('dialog', { name: 'Changes' })).toBeTruthy();
});

test('narrow: the Changes dialog opens (Ctrl+Shift+M) even while a diff has replaced the graph', async () => {
  await show(false);
  act(() => { fireEvent.click(row(oid(1))!); });
  fireEvent.keyDown(document.querySelector('[role=listbox]') ?? window, { key: 'Enter' });
  await waitFor(() => expect(shownPanelStore.get().get('app\0')).toBe('diff'));
  await waitFor(() => expect(row('wip:')).toBeNull());
  fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
  const d = await screen.findByRole('dialog', { name: 'Changes' });
  await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole('textbox', { name: 'Summary' })));
});

test('wide: Ctrl+Shift+M while a commit diff owns the right slot opens the Changes dialog and leaves the diff and selection alone', async () => {
  await show(true);
  fireEvent.click(row(oid(1))!);
  fireEvent.keyDown(screen.getByRole('listbox', { name: 'Commits' }), { key: 'Enter' });
  await waitFor(() => expect(shownPanelStore.get().get('app\0')).toBe('diff'));
  fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
  const d = await screen.findByRole('dialog', { name: 'Changes' });
  await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole('textbox', { name: 'Summary' })));
  expect(shownPanelStore.get().get('app\0')).toBe('diff');
  expect(getSelection(APP).items).toEqual([{ kind: 'commit', oid: oid(1) }]);
});

test('"Edit HEAD message…" is on the HEAD commit\'s menu only; it shows Changes (clearing the commit selection) with HEAD\'s message under Amend', async () => {
  await show(true);
  fireEvent.click(row(HEAD)!);
  await waitFor(() => expect(detailsInSlot()).not.toBeNull());
  fireEvent.contextMenu(row(oid(1))!);
  expect(within(await screen.findByRole('menu')).queryByRole('menuitem', { name: 'Edit HEAD message…' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  fireEvent.contextMenu(row(HEAD)!);
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Edit HEAD message…' }));
  await waitFor(() => expect(changesInSlot()).not.toBeNull());
  expect(getSelection(APP).items).toEqual([]);
  const box = within(changesInSlot()!).getByRole('textbox', { name: 'Summary' }) as HTMLInputElement;
  await waitFor(() => expect(box.value).toBe('Second'));
  expect((within(slot()).getByRole('checkbox', { name: 'Amend previous commit' }) as HTMLInputElement).checked).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(box));
});

test('the WIP row menu offers Show changes; for another checkout it opens that checkout\'s tab first', async () => {
  await show(true);
  fireEvent.contextMenu(row('wip:')!);
  const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
  // Stash's write action (order 400) comes first, then the views.
  expect(items.slice(0, 2)).toEqual(['Stash changes…', 'Show changes']);
  const { openWip } = await import('./entry');
  act(() => openWip(APP, { project: 'app', worktree: 'wt' }));
  expect(tabsStore.get().open.map((t) => t.worktree)).toEqual([null, 'wt']);
  expect(tabsStore.get().active).toBe(1);
  expect(workdirOf({ project: 'app', worktree: 'wt' }).focus).toBe('slot');
});
