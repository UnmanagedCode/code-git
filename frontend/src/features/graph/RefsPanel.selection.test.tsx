import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { refDialogStore } from '@/state/refDialog';
import { getRefSelection } from '@/state/refSelection';
import { loadSummary } from '@/state/useRepoSummary';
import { trackingStore } from '@/state/branchTracking';
import { oid, ref } from '@/test/graphData';
import type { Ref } from './types';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { jumpStore } from './jump';
import { RefsPanel } from './RefsPanel';
import { openGraph } from '@/state/graph';

const TAB = { project: 'app', worktree: null };

function world(extra: Ref[] = []) {
  const w = linearWorld(10);
  w.refs.refs.push(
    ref('refs/heads/a', oid(9)), ref('refs/heads/b', oid(8)), ref('refs/heads/c', oid(7)),
    ref('refs/remotes/origin/a', oid(9)), ref('refs/tags/v1', oid(6)), ...extra,
  );
  return w;
}
async function show(extra: Ref[] = []) {
  const fetch = stubGraph(world(extra), {
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
const DIR = [ref('refs/heads/dir/x', oid(5)), ref('refs/heads/dir/y', oid(4))];
const UP = [ref('refs/remotes/up/m/x', oid(5), { remote: 'up' }), ref('refs/remotes/up/m/y', oid(4), { remote: 'up' }), ref('refs/remotes/up/z', oid(3), { remote: 'up' })];
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
  expect(selected()).toEqual(['refs/heads/b', 'refs/heads/c', 'refs/heads/main', 'refs/remotes/origin/a']);
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

// Invariant: a leaf inside a folder takes part in Ctrl/⌘ selection and in the Shift range, in rendered (folders-first) order.
test('Ctrl/⌘-click toggles a leaf inside a folder; a Shift range spans the folder\'s rows', async () => {
  await show(DIR);
  fireEvent.click(nameButton('refs/heads/dir/y'), { ctrlKey: true });
  expect(selected()).toEqual(['refs/heads/dir/y']);
  fireEvent.click(nameButton('refs/heads/b'), { shiftKey: true });
  expect(selected()).toEqual(['refs/heads/dir/y', 'refs/heads/a', 'refs/heads/b']);
  fireEvent.click(nameButton('refs/heads/dir/y'), { ctrlKey: true });
  expect(selected()).toEqual(['refs/heads/a', 'refs/heads/b']);
});

// Invariant: the Shift range follows the rows as rendered: a collapsed folder's refs are not in it.
test('with a folder collapsed, a Shift range across it skips its refs', async () => {
  await show(UP);
  fireEvent.click(nameButton('refs/remotes/origin/a'), { ctrlKey: true });
  fireEvent.click(nameButton('refs/remotes/up/z'), { shiftKey: true });
  expect(selected()).toEqual(['refs/remotes/origin/a', 'refs/remotes/up/m/x', 'refs/remotes/up/m/y', 'refs/remotes/up/z']);
  fireEvent.click(nameButton('refs/remotes/origin/a'));
  expect(selected()).toEqual([]);
  fireEvent.click(document.querySelector('[data-folder="refs/remotes/up/m/"] button[aria-expanded]')!);
  expect(row('refs/remotes/up/m/x')).toBeNull();
  fireEvent.click(nameButton('refs/remotes/origin/a'), { ctrlKey: true });
  fireEvent.click(nameButton('refs/remotes/up/z'), { shiftKey: true });
  expect(selected()).toEqual(['refs/remotes/origin/a', 'refs/remotes/up/z']);
});

// Invariant: an anchor that left `order` (collapsed away) starts a new selection at the clicked row, and selection is not pruned.
test('an anchor inside a collapsed folder starts a new selection at the clicked row', async () => {
  await show(DIR);
  fireEvent.click(nameButton('refs/heads/dir/x'), { ctrlKey: true });
  fireEvent.click(document.querySelector('[data-folder="refs/heads/dir/"] button[aria-expanded]')!);
  expect(selected()).toEqual([]);
  expect(getRefSelection(TAB).names).toEqual(['refs/heads/dir/x']);
  fireEvent.click(nameButton('refs/heads/b'), { shiftKey: true });
  expect(selected()).toEqual(['refs/heads/b']);
});

const collapseFolder = (prefix: string) => fireEvent.click(document.querySelector(`[data-folder="${prefix}"] button[aria-expanded]`)!);
const collapseButton = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name, expanded: true }));

// Invariant: the order handed to the reducer is the rendered rows: a range over a collapsed folder stores only rendered refs, so the multi-selection menu never acts on hidden ones.
test('the stored selection of a Shift range over a collapsed local folder or remote-group folder holds only rendered refs', async () => {
  await show([...DIR, ...UP]);
  collapseFolder('refs/heads/dir/');
  fireEvent.click(nameButton('refs/heads/a'), { ctrlKey: true });
  fireEvent.click(nameButton('refs/heads/c'), { shiftKey: true });
  expect(getRefSelection(TAB).names).toEqual(['refs/heads/a', 'refs/heads/b', 'refs/heads/c']);
  fireEvent.click(nameButton('refs/heads/main'));
  collapseFolder('refs/remotes/up/m/');
  fireEvent.click(nameButton('refs/remotes/origin/a'), { ctrlKey: true });
  fireEvent.click(nameButton('refs/remotes/up/z'), { shiftKey: true });
  expect(getRefSelection(TAB).names).toEqual(['refs/remotes/origin/a', 'refs/remotes/up/z']);
});

// Invariant: a collapsed remote group is left out of the range order.
test('a Shift range skips the refs of a collapsed remote group', async () => {
  await show(UP);
  fireEvent.click(nameButton('refs/heads/b'), { ctrlKey: true });
  collapseButton('origin');
  fireEvent.click(nameButton('refs/remotes/up/z'), { shiftKey: true });
  expect(getRefSelection(TAB).names).toEqual(['refs/heads/b', 'refs/heads/c', 'refs/heads/main', 'refs/remotes/up/m/x', 'refs/remotes/up/m/y', 'refs/remotes/up/z']);
});

// Invariant: a collapsed section is left out of the range order, so an anchor inside it is gone and the click starts a new selection.
test('a Shift range with a collapsed Local or Remotes section starts a new selection when the anchor is inside it', async () => {
  await show(UP);
  fireEvent.click(nameButton('refs/heads/b'), { ctrlKey: true });
  collapseButton(/^Local/);
  fireEvent.click(nameButton('refs/remotes/origin/a'), { shiftKey: true });
  expect(getRefSelection(TAB).names).toEqual(['refs/remotes/origin/a']);
  fireEvent.click(nameButton('refs/remotes/up/z'), { ctrlKey: true });
  collapseButton(/^Remotes/);
  expect(getRefSelection(TAB).names).toEqual(['refs/remotes/origin/a', 'refs/remotes/up/z']);
  fireEvent.click(screen.getByRole('button', { name: /^Local/ }));
  fireEvent.click(nameButton('refs/heads/c'), { shiftKey: true });
  expect(getRefSelection(TAB).names).toEqual(['refs/heads/c']);
});
