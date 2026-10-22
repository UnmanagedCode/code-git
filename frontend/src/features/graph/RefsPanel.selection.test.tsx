import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { refDialogStore } from '@/state/refDialog';
import { getRefSelection } from '@/state/refSelection';
import { loadSummary } from '@/state/useRepoSummary';
import { trackingStore } from '@/state/branchTracking';
import { oid, ref } from '@/test/graphData';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { jumpStore } from './jump';
import { RefsPanel } from './RefsPanel';
import { openGraph } from '@/state/graph';

const TAB = { project: 'app', worktree: null };

function world() {
  const w = linearWorld(10);
  w.refs.refs.push(
    ref('refs/heads/a', oid(9)), ref('refs/heads/b', oid(8)), ref('refs/heads/c', oid(7)),
    ref('refs/remotes/origin/a', oid(9)), ref('refs/tags/v1', oid(6)),
  );
  return w;
}
async function show() {
  const fetch = stubGraph(world(), {
    'POST api/ops/branch.checkout': { ok: true, result: { branch: 'refs/heads/b', created: false, localExisted: true, fastForwarded: false, ffBlocked: null, undo: {} } },
    'POST api/ops/branch.tracking': { ok: true, result: { remotes: ['origin'], branches: { 'refs/heads/a': { upstream: 'refs/remotes/origin/a', ahead: 2, behind: 1, gone: false } } } },
  });
  await loadSummary(TAB);
  await openGraph(TAB);
  render(<RefsPanel tab={TAB} />);
  await screen.findByRole('navigation', { name: 'Refs' });
  return fetch;
}
const row = (name: string) => document.querySelector(`[data-ref="${name}"]`) as HTMLElement;
const nameButton = (name: string) => within(row(name)).getAllByRole('button').find((b) => b.title === name)!;
const selected = () => [...document.querySelectorAll('[data-selected]')].map((e) => e.getAttribute('data-ref'));

test('a plain click still jumps and clears the selection; Ctrl/⌘-click toggles a row without jumping', async () => {
  await show();
  fireEvent.click(nameButton('refs/heads/a'), { ctrlKey: true });
  fireEvent.click(nameButton('refs/heads/c'), { metaKey: true });
  expect(selected()).toEqual(['refs/heads/a', 'refs/heads/c']);
  expect(jumpStore.get()).toBeNull();
  fireEvent.click(nameButton('refs/heads/a'), { ctrlKey: true });
  expect(selected()).toEqual(['refs/heads/c']);
  fireEvent.click(nameButton('refs/heads/b'));
  expect(jumpStore.get()?.oid).toBe(oid(8));
  expect(selected()).toEqual([]);
  expect(getRefSelection(TAB).names).toEqual([]);
});

test('Shift-click selects the displayed branch range across local and remote rows; tags are not selectable', async () => {
  await show();
  fireEvent.click(nameButton('refs/heads/b'), { ctrlKey: true });
  fireEvent.click(nameButton('refs/remotes/origin/a'), { shiftKey: true });
  expect(selected()).toEqual(['refs/heads/b', 'refs/heads/c', 'refs/remotes/origin/a']);
  fireEvent.click(nameButton('refs/tags/v1'), { ctrlKey: true });
  expect(selected()).toEqual([]);
  expect(jumpStore.get()?.oid).toBe(oid(6));
});

test('right-click on a row of a selection opens the branches menu with exactly the selected refs; elsewhere the row\'s own menu', async () => {
  await show();
  fireEvent.click(nameButton('refs/heads/a'), { ctrlKey: true });
  fireEvent.click(nameButton('refs/heads/c'), { ctrlKey: true });
  fireEvent.contextMenu(row('refs/heads/a'));
  const menu = await screen.findByRole('menu');
  expect(menu.getAttribute('data-context')).toBe('branches');
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete 2 branches…' }));
  const d = refDialogStore.get();
  expect(d?.kind === 'deleteBranches' && d.refs.map((r) => r.name)).toEqual(['refs/heads/a', 'refs/heads/c']);
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  fireEvent.contextMenu(row('refs/heads/b'));
  expect((await screen.findByRole('menu')).getAttribute('data-context')).toBe('branch');
});

test('double-click on a branch row runs Checkout; local rows show their ahead/behind', async () => {
  const fetch = await show();
  fireEvent.doubleClick(nameButton('refs/heads/b'));
  await waitFor(() => expect(paramsOf(fetch, 'POST api/ops/branch.checkout')).toEqual([{ ref: 'refs/heads/b' }]));
  await waitFor(() => expect(within(row('refs/heads/a')).getByLabelText('2 ahead, 1 behind').textContent).toBe('↑2 ↓1'));
  expect(trackingStore.get().get('app')?.data?.remotes).toEqual(['origin']);
});
