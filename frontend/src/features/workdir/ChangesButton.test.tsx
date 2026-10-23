import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Shell } from '@/shell/Shell';
import { diffStore } from '@/state/diff';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { dfile } from '@/test/diffFixtures';
import { summary } from '@/test/fixtures';
import { workdirWorld } from '@/test/workdirWorld';
import { LG_QUERY } from '@/lib/useMediaQuery';
import { openWorkingTree } from './entry';
import { openDiff } from '@/features/diff/openDiff';
import { setDialogOpen } from '@/state/workdir';

const APP = { project: 'app', worktree: null };

/** Pins the lg media query; other queries never match. */
function screenWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === LG_QUERY ? wide : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
}

async function show(wide: boolean) {
  screenWidth(wide);
  const w = workdirWorld({
    unstaged: [dfile({ path: 'src/a.ts' })], staged: [dfile({ path: 'src/b.ts' })],
    summary: summary({ counts: { staged: 1, unstaged: 2, untracked: 3, conflicted: 0 } }),
  });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  // Narrow: the graph toolbar's button; wide: the right slot's panel.
  if (wide) await screen.findByRole('region', { name: 'Commit message' });
  else await screen.findByRole('button', { name: 'Changes (6)' });
  return w;
}
const dialog = () => screen.getByRole('dialog', { name: 'Changes' });

test('the graph toolbar Changes button (n = staged + unstaged + untracked) opens the Changes content in a dialog', async () => {
  await show(false);
  await userEvent.click(screen.getByRole('button', { name: 'Changes (6)' }));
  const d = dialog();
  expect(within(d).getByRole('region', { name: 'Unstaged Files' })).toBeTruthy();
  expect(within(d).getByRole('region', { name: 'Commit message' })).toBeTruthy();
  await userEvent.click(within(d).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('with the unstaged diff open, a plain click in the dialog views that file and closes it; Ctrl-click keeps it open', async () => {
  screenWidth(false);
  workdirWorld({ unstaged: [dfile({ path: 'src/a.ts' }), dfile({ path: 'src/c.ts' })], staged: [] });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  act(() => openDiff(APP, { kind: 'unstaged' }, { path: 'src/a.ts' }));
  await waitFor(() => expect(diffStore.get().get(tabKey(APP))?.list.result).toBeTruthy());
  act(() => setDialogOpen(APP, true));
  const section = () => within(dialog()).getByRole('region', { name: 'Unstaged Files' });
  fireEvent.click(within(section()).getByText('src/c.ts'), { ctrlKey: true });
  expect(diffStore.get().get(tabKey(APP))?.selected).toEqual(['src/a.ts', 'src/c.ts']);
  expect(dialog()).toBeTruthy();
  await userEvent.click(within(section()).getByText('src/c.ts'));
  expect(diffStore.get().get(tabKey(APP))).toMatchObject({ source: { kind: 'unstaged' }, viewed: 'src/c.ts', selected: ['src/c.ts'] });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull());
});

test('clicking a file in the dialog closes it and opens that file\'s diff', async () => {
  await show(false);
  await userEvent.click(screen.getByRole('button', { name: 'Changes (6)' }));
  await userEvent.click(within(within(dialog()).getByRole('region', { name: 'Unstaged Files' })).getByText('src/a.ts'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(diffStore.get().get(tabKey(APP))?.source).toEqual({ kind: 'unstaged' });
});

test('openWorkingTree on a narrow screen opens the dialog with its summary focused', async () => {
  await show(false);
  act(() => openWorkingTree(APP));
  const box = await within(dialog()).findByRole('textbox', { name: 'Summary' });
  await waitFor(() => expect(document.activeElement).toBe(box));
});

test('openWorkingTree on a wide screen focuses the panel summary, no dialog', async () => {
  await show(true);
  act(() => openWorkingTree(APP));
  const box = within(screen.getByRole('region', { name: 'Commit message' })).getByRole('textbox', { name: 'Summary' });
  await waitFor(() => expect(document.activeElement).toBe(box));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test("openWorkingTree {amend: 'message'} ticks Amend and loads HEAD's message", async () => {
  await show(true);
  act(() => openWorkingTree(APP, { amend: 'message' }));
  const box = within(screen.getByRole('region', { name: 'Commit message' })).getByRole('textbox', { name: 'Summary' }) as HTMLInputElement;
  await waitFor(() => expect(box.value).toBe('HEAD summary'));
  expect((screen.getByRole('checkbox', { name: 'Amend previous commit' }) as HTMLInputElement).checked).toBe(true);
});

test('Ctrl+Shift+M brings up the commit summary', async () => {
  await show(false);
  fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
  const box = await within(dialog()).findByRole('textbox', { name: 'Summary' });
  await waitFor(() => expect(document.activeElement).toBe(box));
});
