import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { GraphPanel } from '@/features/graph/GraphPanel';
import { jumpStore } from '@/features/graph/jump';
import { refDialogStore } from '@/state/refDialog';
import { loadSummary } from '@/state/useRepoSummary';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { oid, ref } from '@/test/graphData';

const TAB = { project: 'app', worktree: null };

async function show() {
  const w = linearWorld(5);
  w.refs.refs.push(ref('refs/heads/feat', oid(3)), ref('refs/tags/v1', oid(2)));
  const fetch = stubGraph(w, {
    'POST api/ops/branch.checkout': { ok: true, result: { branch: 'refs/heads/feat', created: false, localExisted: true, fastForwarded: false, ffBlocked: null, undo: {} } },
  });
  await loadSummary(TAB);
  render(<GraphPanel tab={TAB} />);
  await waitFor(() => expect(document.querySelector('[data-row-id]')).not.toBeNull());
  return fetch;
}
const chip = (text: string) => [...document.querySelectorAll('[data-label-kind]')].find((e) => e.textContent === text) as HTMLElement;

test('double-click on a branch chip checks it out; on a tag chip it jumps to the tag', async () => {
  const fetch = await show();
  fireEvent.doubleClick(chip('feat'));
  await waitFor(() => expect(paramsOf(fetch, 'POST api/ops/branch.checkout')).toEqual([{ ref: 'refs/heads/feat' }]));
  fireEvent.doubleClick(chip('v1'));
  expect(jumpStore.get()?.oid).toBe(oid(2));
});

test('the toolbar Branch button and Ctrl/⌘+B open "create branch from HEAD"; not while typing in a field', async () => {
  await show();
  fireEvent.click(screen.getByRole('button', { name: /^Branch$/ }));
  expect(refDialogStore.get()).toEqual({ kind: 'createBranch', tab: TAB, from: null });
  act(() => refDialogStore.set(null));
  fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
  expect(refDialogStore.get()?.kind).toBe('createBranch');
  act(() => refDialogStore.set(null));
  const search = screen.getByRole('textbox', { name: 'Search commits' });
  search.focus();
  fireEvent.keyDown(search, { key: 'b', metaKey: true });
  expect(refDialogStore.get()).toBeNull();
});
