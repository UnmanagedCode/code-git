import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { closeDiff, openDiff } from '@/features/diff/openDiff';
import { Shell } from '@/shell/Shell';
import { getGraph } from '@/state/graph';
import { updatePrefs } from '@/state/graphPrefs';
import { getSelection } from '@/state/graphSelection';
import { dispatchTabs } from '@/state/tabs';
import { commit, oid, ref } from '@/test/graphData';
import { summary } from '@/test/fixtures';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { requestJump } from './jump';
import { ROW_H } from './windowFor';

// The diff replaces the graph in the center slot (the graph panel unmounts) and closing it brings the graph back.

const TAB = { project: 'app', worktree: null };
const rowEl = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
const list = () => screen.getByRole('listbox', { name: 'Commits' });
/**
 * Lets a jump the graph would serve run to its end when its commit is already loaded (found without a page request):
 * macrotask ticks only, so a jump that must page is not waited for. Callers pick loaded targets.
 */
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

async function shell(world = linearWorld(5)) {
  stubGraph(world);
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  await waitFor(() => expect(rowEl(world.commits[0].oid)).not.toBeNull());
}

test('a ref hidden while a diff is open is gone from the graph once the diff closes', async () => {
  const world = linearWorld(5);
  const side = 'c'.repeat(40);
  world.commits.splice(1, 0, commit(side, [oid(4)], { subject: 'side tip' }));
  world.refs.refs.push(ref('refs/heads/side', side));
  await shell(world);
  expect(rowEl(side)).not.toBeNull();
  act(() => openDiff(TAB, { kind: 'commit', rev: oid(5) }));
  await screen.findByRole('region', { name: 'Diff' });
  expect(screen.queryByRole('region', { name: 'Commit graph' })).toBeNull();
  act(() => updatePrefs('app', (p) => ({ ...p, hidden: ['refs/heads/side'] })));
  act(() => closeDiff(TAB));
  await screen.findByRole('region', { name: 'Commit graph' });
  await waitFor(() => expect(rowEl(side)).toBeNull());
  expect(rowEl(oid(5))).not.toBeNull();
});

test('closing a diff brings the graph back scrolled where it was, with the focus on the list', async () => {
  await shell(linearWorld(600));
  const el = list();
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 800 });
  el.scrollTop = 200 * ROW_H + 9;
  fireEvent.scroll(el);
  await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  act(() => openDiff(TAB, { kind: 'commit', rev: oid(400) }));
  await screen.findByRole('region', { name: 'Diff' });
  (document.activeElement as HTMLElement | null)?.blur();
  act(() => closeDiff(TAB));
  const back = await screen.findByRole('listbox', { name: 'Commits' });
  expect(back).not.toBe(el);
  expect(back.scrollTop).toBe(200 * ROW_H + 9);
  expect(document.activeElement).toBe(back);
});

test('a ref clicked while a diff is open closes the diff and the graph jumps to that commit', async () => {
  const world = linearWorld(900);
  world.refs.refs.push(ref('refs/heads/old', oid(200)));
  await shell(world);
  act(() => openDiff(TAB, { kind: 'commit', rev: oid(900) }));
  await screen.findByRole('region', { name: 'Diff' });
  const refs = screen.getByRole('navigation', { name: 'Refs' });
  fireEvent.click(within(within(refs).getByRole('list', { name: 'Local branches' })).getByRole('button', { name: 'old' }));
  await screen.findByRole('region', { name: 'Commit graph' });
  expect(screen.queryByRole('region', { name: 'Diff' })).toBeNull();
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([oid(200)]));
  expect(rowEl(oid(200))).not.toBeNull();
});

test('closing a diff keeps the search the user was in: its query, its mode and its matches', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const world = linearWorld(20);
    world.search = ({ mode, query }) => ({ matches: mode === 'path' && query === 'src/a.ts' ? [oid(17)] : [], truncated: false });
    await shell(world);
    fireEvent.click(screen.getByRole('button', { name: 'Path' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search commits' }), { target: { value: 'src/a.ts' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(rowEl(oid(17))!.hasAttribute('data-match')).toBe(true));
    act(() => openDiff(TAB, { kind: 'commit', rev: oid(17) }));
    await screen.findByRole('region', { name: 'Diff' });
    act(() => closeDiff(TAB));
    const box = await screen.findByRole('textbox', { name: 'Search commits' });
    expect((box as HTMLInputElement).value).toBe('src/a.ts');
    expect(screen.getByRole('button', { name: 'Path' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(rowEl(oid(17))!.hasAttribute('data-match')).toBe(true));
  } finally {
    vi.useRealTimers();
  }
});

test('a served jump is not served again when the graph remounts: the selection and scroll the user moved to stay', async () => {
  const world = linearWorld(900);
  world.refs.refs.push(ref('refs/heads/old', oid(200)));
  await shell(world);
  const refs = screen.getByRole('navigation', { name: 'Refs' });
  fireEvent.click(within(within(refs).getByRole('list', { name: 'Local branches' })).getByRole('button', { name: 'old' }));
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([oid(200)]));
  // Move away: select the top commit and scroll back to the top.
  const el = list();
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 800 });
  el.scrollTop = 0;
  fireEvent.scroll(el);
  await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  fireEvent.click(rowEl(oid(900))!);
  expect(getSelection(TAB).ids).toEqual([oid(900)]);
  act(() => openDiff(TAB, { kind: 'commit', rev: oid(900) }));
  await screen.findByRole('region', { name: 'Diff' });
  act(() => closeDiff(TAB));
  const back = await screen.findByRole('listbox', { name: 'Commits' });
  await settle();
  expect(getSelection(TAB).ids).toEqual([oid(900)]);
  expect(back.scrollTop).toBe(0);
});

test("a jump is served only by its own tab's graph: not when another tab's mounts, still when its own does", async () => {
  const WT = { project: 'app', worktree: 'wt' };
  const world = linearWorld(900);
  world.worktrees = [{ worktreeName: 'wt', branch: 'code-conductor/wt', baseBranch: 'main', locked: false }];
  world.summaries.wt = summary({ head: { oid: oid(900), branch: 'main', unborn: false } });
  stubGraph(world);
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  act(() => dispatchTabs({ type: 'open', tab: WT }));
  await waitFor(() => expect(rowEl(oid(900))).not.toBeNull());
  // A target in the first page of both graphs: a graph that took the jump would select it without paging,
  // within settle().
  const target = oid(600);
  expect(getGraph(WT).commits.some((c) => c.oid === target)).toBe(true);
  // The jump is for the main checkout's tab while the worktree's tab is shown, its graph mounted and subscribed.
  act(() => requestJump(TAB, target));
  await settle();
  expect(getSelection(WT).ids).toEqual([]);
  // Remounting the worktree tab's graph (a diff in its place, closed again) does not take it either.
  act(() => openDiff(WT, { kind: 'unstaged' }));
  await screen.findByRole('region', { name: 'Diff' });
  act(() => closeDiff(WT));
  await screen.findByRole('region', { name: 'Commit graph' });
  await settle();
  expect(getSelection(WT).ids).toEqual([]);
  expect(getSelection(TAB).ids).toEqual([]);
  act(() => dispatchTabs({ type: 'activateIndex', index: 0 }));
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([target]));
  expect(getSelection(WT).ids).toEqual([]);
  // Control: a jump the shown worktree graph does own, to the same loaded commit, completes within settle().
  act(() => dispatchTabs({ type: 'activateIndex', index: 1 }));
  await waitFor(() => expect(rowEl(oid(900))).not.toBeNull());
  act(() => requestJump(WT, target));
  await settle();
  expect(getSelection(WT).ids).toEqual([target]);
});
