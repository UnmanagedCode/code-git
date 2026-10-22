import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { closeDiff, openDiff } from '@/features/diff/openDiff';
import { Shell } from '@/shell/Shell';
import { updatePrefs } from '@/state/graphPrefs';
import { getSelection } from '@/state/graphSelection';
import { dispatchTabs } from '@/state/tabs';
import { commit, oid, ref } from '@/test/graphData';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { ROW_H } from './windowFor';

// The diff replaces the graph in the center slot (the graph panel unmounts) and closing it brings the graph back.

const TAB = { project: 'app', worktree: null };
const rowEl = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
const list = () => screen.getByRole('listbox', { name: 'Commits' });

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
