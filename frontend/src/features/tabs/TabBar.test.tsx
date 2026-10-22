import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { dispatchTabs, tabsStore } from '@/state/tabs';
import { TabBar } from './TabBar';
import { useTabShortcuts } from './useTabShortcuts';

function Harness() {
  useTabShortcuts();
  return <TabBar onAdd={() => {}} />;
}

function openTabs(...names: string[]) {
  for (const n of names) dispatchTabs({ type: 'open', tab: { project: n, worktree: null } });
}
const selected = () => screen.getAllByRole('tab').find((el) => el.getAttribute('aria-selected') === 'true')?.textContent;

test('Ctrl+3 and Meta+3 activate the third tab; Ctrl+9 the last', () => {
  openTabs('a', 'b', 'c', 'd');
  render(<Harness />);
  fireEvent.keyDown(window, { key: '1', ctrlKey: true });
  expect(selected()).toBe('a');
  fireEvent.keyDown(window, { key: '3', ctrlKey: true });
  expect(selected()).toBe('c');
  fireEvent.keyDown(window, { key: '2', metaKey: true });
  expect(selected()).toBe('b');
  fireEvent.keyDown(window, { key: '9', ctrlKey: true });
  expect(selected()).toBe('d');
});

test('the shortcut prevents the browser default; with a modifier other than Ctrl/Meta, or none, it is ignored', () => {
  openTabs('a', 'b', 'c');
  render(<Harness />);
  fireEvent.keyDown(window, { key: '1', ctrlKey: true });
  expect(fireEvent.keyDown(window, { key: '2', ctrlKey: true })).toBe(false);
  expect(selected()).toBe('b');
  expect(fireEvent.keyDown(window, { key: '3', ctrlKey: true, shiftKey: true })).toBe(true);
  fireEvent.keyDown(window, { key: '3', ctrlKey: true, altKey: true });
  fireEvent.keyDown(window, { key: '3' });
  fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
  expect(selected()).toBe('b');
  fireEvent.keyDown(window, { key: '5', ctrlKey: true });
  expect(selected()).toBe('b');
});

test('clicking a tab activates it; its close button closes it', async () => {
  openTabs('a', 'b');
  render(<Harness />);
  await userEvent.click(screen.getByRole('tab', { name: 'a' }));
  expect(tabsStore.get().active).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: 'Close a' }));
  expect(tabsStore.get().open.map((t) => t.project)).toEqual(['b']);
});

test('a worktree tab is labelled project/worktree', () => {
  dispatchTabs({ type: 'open', tab: { project: 'app', worktree: 'feat' } });
  render(<Harness />);
  expect(screen.getByRole('tab', { name: 'app/feat' })).toBeTruthy();
});

test('the tab context menu offers Close and Close others; Close others keeps only that tab', async () => {
  openTabs('a', 'b', 'c');
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Actions for b' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Close' })).toBeTruthy();
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Close others' }));
  expect(tabsStore.get()).toEqual({ open: [{ project: 'b', worktree: null }], active: 0 });
});

test('right-clicking a tab opens its menu; with one tab there is no Close others', async () => {
  openTabs('a');
  render(<Harness />);
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'a' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).queryByRole('menuitem', { name: 'Close others' })).toBeNull();
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Close' }));
  expect(tabsStore.get().open).toEqual([]);
});
