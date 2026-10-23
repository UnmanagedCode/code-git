import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { Shell } from '@/shell/Shell';
import { Toasts } from '@/shell/Toasts';
import { activeTab, dispatchTabs, tabsStore } from '@/state/tabs';
import { json } from '@/test/fixtures';
import { COMMITTED, HEAD, subEntry, submoduleWorld, type SubmoduleTarget } from '@/test/submoduleWorld';
import type { SubmoduleEntry } from './api';

afterEach(() => { toast.dismiss(); });

const APP = { project: 'app', worktree: null };
const SUB = { project: 'app', worktree: null, sub: ['libs/a'] };
const PROMPT = 'Commit the new pointer for libs/a in app?';

/** The parent lists libs/a with `parent` (by default moved: HEAD ≠ committed); a submodule tab lists nothing. */
async function world(parent: () => SubmoduleEntry = () => subEntry({ head: HEAD, outOfSync: true }), answers: Record<string, unknown> = {}) {
  const w = submoduleWorld({ list: (t: SubmoduleTarget) => (t.sub ? [] : [parent()]), answers });
  render(<><Shell /><Toasts /></>);
  act(() => { dispatchTabs({ type: 'open', tab: APP }); dispatchTabs({ type: 'open', tab: SUB }); });
  await screen.findByRole('navigation', { name: 'Submodule path' });
  return w;
}
const closeSub = () => act(() => dispatchTabs({ type: 'close', index: tabsStore.get().open.findIndex((t) => t.sub) }));

test('closing a sub tab with head ≠ committed opens the prompt, the message prefilled', async () => {
  const w = await world();
  closeSub();
  const dialog = await screen.findByRole('dialog', { name: PROMPT });
  expect((within(dialog).getByRole('textbox', { name: 'Commit message' }) as HTMLInputElement).value).toBe('Update submodule libs/a');
  expect(w.targets('submodule.list').at(-1)).toEqual({ project: 'app' });
});

test('Commit pointer sends expect (the HEAD shown) to the parent target', async () => {
  const w = await world();
  closeSub();
  const dialog = await screen.findByRole('dialog', { name: PROMPT });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Commit pointer' }));
  await waitFor(() => expect(w.posts('submodule.commitPointer')).toEqual([{ path: 'libs/a', expect: HEAD, summary: 'Update submodule libs/a' }]));
  expect(w.targets('submodule.commitPointer')).toEqual([{ project: 'app' }]);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: PROMPT })).toBeNull());
});

test('Not now sends nothing', async () => {
  const w = await world();
  closeSub();
  await userEvent.click(within(await screen.findByRole('dialog', { name: PROMPT })).getByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: PROMPT })).toBeNull());
  expect(w.posts('submodule.commitPointer')).toEqual([]);
});

test('Back to parent activates the parent and offers the prompt', async () => {
  await world();
  await userEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  expect(activeTab(tabsStore.get())).toEqual(APP);
  expect(tabsStore.get().open).toEqual([APP]);
  expect(await screen.findByRole('dialog', { name: PROMPT })).toBeTruthy();
});

test('clean pointer → no prompt (nor for an entry gone, or not cloned)', async () => {
  let e: SubmoduleEntry | null = subEntry({ head: COMMITTED });
  const w = submoduleWorld({ list: (t) => (t.sub || !e ? [] : [e]) });
  render(<><Shell /><Toasts /></>);
  const cycle = async () => {
    const n = w.fetch.count('POST api/ops/submodule.list');
    act(() => { dispatchTabs({ type: 'open', tab: APP }); dispatchTabs({ type: 'open', tab: SUB }); });
    closeSub();
    await waitFor(() => expect(w.fetch.count('POST api/ops/submodule.list')).toBeGreaterThan(n));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByRole('dialog', { name: PROMPT })).toBeNull();
  };
  await cycle();
  e = subEntry({ head: null, populated: false });
  await cycle();
  e = null;
  await cycle();
});

test('SUBMODULE_POINTER_MOVED checks again: the prompt reopens with the new HEAD', async () => {
  let head = HEAD;
  let n = 0;
  const w = await world(() => subEntry({ head }), {
    'submodule.commitPointer': () => (n++ === 0 ? json({ error: 'moved', code: 'SUBMODULE_POINTER_MOVED', path: 'libs/a' }, 409) : { oid: 'f'.repeat(40) }),
  });
  closeSub();
  const dialog = await screen.findByRole('dialog', { name: PROMPT });
  head = 'e'.repeat(40);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Commit pointer' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: PROMPT }).textContent).toContain('eeeeeee'));
  await userEvent.click(within(screen.getByRole('dialog', { name: PROMPT })).getByRole('button', { name: 'Commit pointer' }));
  await waitFor(() => expect(w.posts('submodule.commitPointer').map((p) => (p as { expect: string }).expect)).toEqual([HEAD, 'e'.repeat(40)]));
});

test('Close others closing two moved submodule tabs offers both, one after the other', async () => {
  const w = submoduleWorld({ list: (t) => (t.sub ? [] : [subEntry({ head: HEAD }), subEntry({ path: 'libs/b', head: HEAD })]) });
  render(<><Shell /><Toasts /></>);
  act(() => {
    dispatchTabs({ type: 'open', tab: APP });
    dispatchTabs({ type: 'open', tab: SUB });
    dispatchTabs({ type: 'open', tab: { ...SUB, sub: ['libs/b'] } });
    dispatchTabs({ type: 'closeOthers', index: 0 });
  });
  await userEvent.click(within(await screen.findByRole('dialog', { name: PROMPT })).getByRole('button', { name: 'Not now' }));
  expect(await screen.findByRole('dialog', { name: 'Commit the new pointer for libs/b in app?' })).toBeTruthy();
  expect(w.posts('submodule.commitPointer')).toEqual([]);
});

test('OPERATION_IN_PROGRESS stays in the pointer prompt as its message; nothing is retried', async () => {
  const w = await world(undefined, {
    'submodule.commitPointer': json({ error: 'a merge is in progress in this repository: finish or abort it first', code: 'OPERATION_IN_PROGRESS', operation: 'merge' }, 409),
  });
  closeSub();
  const dialog = await screen.findByRole('dialog', { name: PROMPT });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Commit pointer' }));
  expect(await within(dialog).findByText('a merge is in progress in this repository: finish or abort it first')).toBeTruthy();
  expect(w.posts('submodule.commitPointer')).toHaveLength(1);
});
