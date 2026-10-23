import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { MenuAction } from './menus';

const ran: string[] = [];
const TEST: MenuAction<unknown>[] = [
  { id: 'hide', context: 'x', label: 'Hide', run: () => { ran.push('hide'); } },
  { id: 'copy', context: 'x', label: 'Copy name', run: () => { ran.push('copy'); } },
];
vi.mock('./menus', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./menus')>();
  return { ...orig, actionsFor: (c: string, ctx: unknown) => orig.resolveActions(TEST, c, ctx) };
});
// test/setup.ts already loaded the real registry: load the host afresh so it sees the mock.
vi.resetModules();
const { ContextMenuHost, contextMenuStore, openContextMenu } = await import('./ContextMenuHost');
afterEach(() => { contextMenuStore.set(null); ran.length = 0; });

const open = () => act(() => { openContextMenu({ host: 'h', context: 'x', ctx: {}, at: { x: 10, y: 10 } }); });

test('the pointerup ending the right-press that opened the menu activates nothing, even over an item; a later click still runs it', async () => {
  render(<ContextMenuHost host="h" />);
  // The right-press is down when the menu opens (contextmenu fires on press), as on Linux and macOS.
  fireEvent.pointerDown(document.body, { pointerId: 7, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  // The release lands on the item the menu placed under the pointer; Radix would synthesize a click from it.
  fireEvent.pointerUp(item, { pointerId: 7, button: 2 });
  fireEvent.click(item);
  expect(ran).toEqual([]);
  expect(screen.getByRole('menu')).toBeTruthy();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copy name' }));
  expect(ran).toEqual(['copy']);
});

test('a menu opened with no press held (keyboard, after a drop) keeps the next release: Radix activates the item under it', async () => {
  render(<ContextMenuHost host="h" />);
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  fireEvent.pointerUp(item, { pointerId: 3, button: 0 });
  await waitFor(() => expect(ran).toEqual(['hide']));
});

test('a press released before the menu opens leaves nothing to swallow', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 9, button: 2 });
  fireEvent.pointerUp(document.body, { pointerId: 9, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  fireEvent.pointerUp(item, { pointerId: 9, button: 0 });
  await waitFor(() => expect(ran).toEqual(['hide']));
});
