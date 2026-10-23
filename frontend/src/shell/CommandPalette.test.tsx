import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { refDialogStore } from '@/state/refDialog';
import { dispatchTabs, tabKey, tabsStore } from '@/state/tabs';
import { oid, ref, refsResult } from '@/test/graphData';
import { stubFetch } from '@/test/stubFetch';
import { CommandPalette } from './CommandPalette';
import { COMMANDS, filterCommands, filterPicks, subsequence } from './commands';
import { overlayStore } from './overlays';
import { matches, shortcutLabel } from './shortcuts';
import { useShellKeys } from './useShellKeys';
import { CREATE_BRANCH_KEY } from '@/features/branches/keys';

const TAB = { project: 'app', worktree: null };

function Harness() {
  useShellKeys();
  return <><input aria-label="Some field" /><CommandPalette /></>;
}

function world() {
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  graphStore.set(new Map([[tabKey(TAB), {
    ...EMPTY_GRAPH, status: 'ready',
    refs: refsResult({
      head: { oid: oid(1), branch: 'refs/heads/main', detached: false, unborn: false },
      refs: [ref('refs/heads/main', oid(1), { isHead: true }), ref('refs/heads/feature', oid(2)), ref('refs/remotes/origin/main', oid(1)), ref('refs/remotes/origin/HEAD', oid(1))],
    }),
  }]]));
  render(<Harness />);
}
const ctrl = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ctrlKey: true, ...init });

// Invariant: the subsequence filter matches query characters in order, case-insensitively, spaces ignored.
test('subsequence and filterPicks', () => {
  expect(subsequence('crb', 'Create branch…')).toBe(true);
  expect(subsequence('C R', 'Create branch…')).toBe(true);
  expect(subsequence('hb', 'Create branch…')).toBe(false);
  expect(subsequence('', 'anything')).toBe(true);
  const items = [{ id: 'a', label: 'src/a.ts' }, { id: 'b', label: 'docs/b.md' }];
  expect(filterPicks(items, 'sat', (t) => ({ id: t, label: t })).map((i) => i.id)).toEqual(['a', 'sat']);
  expect(filterPicks(items, 'src/a.ts', (t) => ({ id: t, label: t })).map((i) => i.id)).toEqual(['a']);
});

// Invariant: with no tab only global commands are offered; `when` hides commands for a tab.
test('filterCommands: global commands without a tab, when() per tab', () => {
  expect(filterCommands(COMMANDS, null, '').map((c) => c.id)).toEqual(['shell.shortcuts']);
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  const ids = filterCommands(COMMANDS, TAB, '').map((c) => c.id);
  expect(ids).toContain('workdir.stageAll');
  expect(ids).not.toContain('branches.create'); // no graph refs: HEAD is not known to be born
  expect(ids).not.toContain('tabs.goto'); // one tab
});

// Invariant: Ctrl/⌘+P opens the palette and is defaultPrevented (no print); from a text field it does nothing.
test('Ctrl+P opens the palette, preventing the default; not from a text field', async () => {
  world();
  screen.getByRole('textbox', { name: 'Some field' }).focus();
  ctrl('p');
  expect(overlayStore.get()).toBe(null);
  (document.activeElement as HTMLElement).blur();
  const e = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true });
  act(() => { window.dispatchEvent(e); });
  expect(e.defaultPrevented).toBe(true);
  expect(await screen.findByRole('combobox', { name: 'Command' })).toBeTruthy();
});

// Invariant: typing filters, Enter runs the highlighted command and closes the palette; arrows move the highlight.
test('filter, arrows and Enter run a command', async () => {
  world();
  ctrl('p');
  const user = userEvent.setup();
  const box = await screen.findByRole('combobox', { name: 'Command' });
  await user.type(box, 'create br');
  const options = within(screen.getByRole('listbox', { name: 'Commands' })).getAllByRole('option');
  expect(options.map((o) => o.textContent)).toEqual([`Create branch…Branches${shortcutLabel(CREATE_BRANCH_KEY)}`]);
  await user.keyboard('{Enter}');
  expect(refDialogStore.get()).toMatchObject({ kind: 'createBranch', from: null });
  expect(overlayStore.get()).toBe(null);
  ctrl('p');
  const again = await screen.findByRole('combobox', { name: 'Command' });
  expect(again).toHaveProperty('value', '');
  await user.keyboard('{ArrowDown}');
  const rows = screen.getAllByRole('option');
  expect(rows[1].getAttribute('aria-selected')).toBe('true');
  expect(again.getAttribute('aria-activedescendant')).toBe(rows[1].id);
});

// Invariant: a picking command opens a second stage of its items; Enter runs it with the picked one; Esc there goes back.
test('two-stage pick: Checkout branch… lists the other branches (no HEAD alias) and checks the picked one out', async () => {
  world();
  const fetch = stubFetch({ 'POST api/ops/branch.checkout': { ok: true, result: { branch: 'refs/heads/feature', created: false, localExisted: true, fastForwarded: false, ffBlocked: null, undo: {} } }, 'POST api/ops/graph.refs': { ok: true, result: refsResult() } });
  ctrl('p');
  const user = userEvent.setup();
  await user.type(await screen.findByRole('combobox', { name: 'Command' }), 'checkout');
  await user.keyboard('{Enter}');
  const box = await screen.findByRole('combobox', { name: 'Checkout branch…' });
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['feature', 'origin/mainremote']);
  await user.keyboard('{Escape}');
  expect(await screen.findByRole('combobox', { name: 'Command' })).toBeTruthy();
  expect(overlayStore.get()).toBe('palette');
  await user.type(screen.getByRole('combobox', { name: 'Command' }), 'checkout');
  await user.keyboard('{Enter}');
  await screen.findByRole('combobox', { name: 'Checkout branch…' });
  await user.type(box.isConnected ? box : screen.getByRole('combobox', { name: 'Checkout branch…' }), 'feat');
  await user.keyboard('{Enter}');
  await act(async () => {});
  expect(fetch.calls.find((c) => c.url.pathname.endsWith('branch.checkout'))?.body).toMatchObject({ params: { ref: 'refs/heads/feature' } });
});

// Invariant: Esc at the command stage closes the palette.
test('Esc closes the palette', async () => {
  world();
  ctrl('p');
  const user = userEvent.setup();
  await screen.findByRole('combobox', { name: 'Command' });
  await user.keyboard('{Escape}');
  expect(overlayStore.get()).toBe(null);
});

// Invariant: a row's shortcut hint is the catalog's label for that command's shortcut, and that shortcut opens it.
test('the shown shortcut is the catalog entry', () => {
  const withKeys = COMMANDS.filter((c) => c.shortcut);
  expect(withKeys.length).toBeGreaterThan(2);
  for (const c of withKeys) expect(c.shortcut!.combos.length).toBeGreaterThan(0);
  const create = COMMANDS.find((c) => c.id === 'branches.create')!;
  expect(create.shortcut).toBe(CREATE_BRANCH_KEY);
  expect(matches({ key: 'b', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, create.shortcut!)).toBe(true);
  expect(tabsStore.get().open).toEqual([]);
});
