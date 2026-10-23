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

test('a swallowed release that produces no click leaves no swallow armed: the next real click on an item runs it', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  await screen.findByRole('menuitem', { name: 'Hide' });
  // A right-button release: swallowed, and no click follows it.
  fireEvent.pointerUp(document.body, { pointerId: 1, button: 2 });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Hide' }));
  expect(ran).toEqual(['hide']);
});

test('a key ends an armed click swallow: Enter on an item runs it', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Copy name' });
  fireEvent.pointerUp(document.body, { pointerId: 1, button: 2 });
  item.focus();
  await userEvent.keyboard('{Enter}');
  expect(ran).toEqual(['copy']);
});

test('a lost release (no pointerup ever arrives) does not eat the next click: a new press disarms it', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
  expect(ran).toEqual(['hide']);
});

for (const [what, lose] of [
  ['the window losing focus', () => fireEvent.blur(window)],
  ['the page being hidden', () => fireEvent(document, new Event('visibilitychange'))],
] as const) {
  test(`a lost release is disarmed by ${what}: that pointer's later release over an item activates it`, async () => {
    render(<ContextMenuHost host="h" />);
    fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
    open();
    await screen.findByRole('menuitem', { name: 'Hide' });
    lose();
    // The menu may close with the window's focus: reopen it with no press held. No new pointerdown happens, so only
    // the blur / visibility change can have disarmed the lost release.
    act(() => contextMenuStore.set(null));
    open();
    fireEvent.pointerUp(await screen.findByRole('menuitem', { name: 'Hide' }), { pointerId: 1, button: 0 });
    await waitFor(() => expect(ran).toEqual(['hide']));
  });
}

test('a second pointer\'s press does not disarm the first: the opening finger\'s later release over an item still runs nothing', async () => {
  render(<ContextMenuHost host="h" />);
  // Finger 1 long-presses a row; the menu opens under it.
  fireEvent.pointerDown(document.body, { pointerId: 11, button: 0, pointerType: 'touch' });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  // Finger 2 taps the menu itself (outside it, Radix would rightly dismiss the menu).
  const menuEl = screen.getByRole('menu');
  fireEvent.pointerDown(menuEl, { pointerId: 12, button: 0, pointerType: 'touch' });
  fireEvent.pointerUp(menuEl, { pointerId: 12, button: 0, pointerType: 'touch' });
  // Finger 1 lifts over the item placed under it.
  fireEvent.pointerUp(item, { pointerId: 11, button: 0, pointerType: 'touch' });
  fireEvent.click(item);
  expect(ran).toEqual([]);
  expect(screen.getByRole('menu')).toBeTruthy();
});

test('the click a swallowed release produces is the only one swallowed: a later bare click (no pointerdown) runs the item', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  fireEvent.pointerUp(item, { pointerId: 1, button: 2 });
  fireEvent.click(item);
  expect(ran).toEqual([]);
  fireEvent.click(item);
  await waitFor(() => expect(ran).toEqual(['hide']));
});

test('another pointer\'s press keeps the swallowed pointer\'s click armed: its delayed compatibility click still runs nothing', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 21, button: 0, pointerType: 'touch' });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  // Finger 1 lifts over the item: swallowed, its click is now armed.
  fireEvent.pointerUp(item, { pointerId: 21, button: 0, pointerType: 'touch' });
  // Finger 2 presses and lifts on the menu before finger 1's compatibility click arrives.
  const menuEl = screen.getByRole('menu');
  fireEvent.pointerDown(menuEl, { pointerId: 22, button: 0, pointerType: 'touch' });
  fireEvent.pointerUp(menuEl, { pointerId: 22, button: 0, pointerType: 'touch' });
  // Finger 1's delayed click: swallowed.
  fireEvent.click(item);
  expect(ran).toEqual([]);
  // Only that one: a later click runs the item.
  fireEvent.click(item);
  await waitFor(() => expect(ran).toEqual(['hide']));
});

/** A real click as Chromium dispatches it: a PointerEvent carrying its pointer's id. */
const clickOf = (pointerId: number) => new PointerEvent('click', { bubbles: true, cancelable: true, pointerId });

test('the armed click is the swallowed pointer\'s own: another pointer\'s click runs its item, the first pointer\'s delayed click is still swallowed, then its next click runs', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  // The opening right-press is released over Hide: swallowed, pointer 1's click armed.
  fireEvent.pointerUp(await screen.findByRole('menuitem', { name: 'Hide' }), { pointerId: 1, button: 2 });
  // A second finger's tap on Copy name: a legitimate click, not eaten.
  fireEvent(screen.getByRole('menuitem', { name: 'Copy name' }), clickOf(2));
  await waitFor(() => expect(ran).toEqual(['copy']));
  // Pointer 1's delayed click arrives after it: still swallowed before any handler sees it.
  const seen = vi.fn();
  document.body.addEventListener('click', seen);
  fireEvent(document.body, clickOf(1));
  document.body.removeEventListener('click', seen);
  expect(seen).not.toHaveBeenCalled();
  // Only that one: reopened with no press held, pointer 1's next click runs Hide.
  act(() => contextMenuStore.set(null));
  open();
  fireEvent(await screen.findByRole('menuitem', { name: 'Hide' }), clickOf(1));
  await waitFor(() => expect(ran).toEqual(['copy', 'hide']));
});

test('a click with no pointerId (a plain MouseEvent) is swallowed while a click is armed: the safe side', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  fireEvent.pointerUp(item, { pointerId: 1, button: 2 });
  fireEvent(item, new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(ran).toEqual([]);
});

// Each invariant below fails if its disarm line goes: the events carry the armed pointer's id, and a bubble-phase spy
// shows whether the capture-phase swallow let the event through.

/** Opens the menu during pointer 1's right-press and releases it over Hide: pointer 1's click is armed. */
async function armPointer1() {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  fireEvent.pointerUp(item, { pointerId: 1, button: 2 });
  return item;
}
/** Whether a pointer-1 click on the body gets past the swallow. */
function pointer1ClickReachesBody() {
  const seen = vi.fn();
  document.body.addEventListener('click', seen);
  fireEvent(document.body, clickOf(1));
  document.body.removeEventListener('click', seen);
  return seen.mock.calls.length > 0;
}

test('a same-pointer pointerdown clears that pointer\'s armed click: its next click is not swallowed', async () => {
  const item = await armPointer1();
  fireEvent.pointerDown(item, { pointerId: 1, button: 0 });
  expect(pointer1ClickReachesBody()).toBe(true);
});

test('a keydown ends an armed click: the armed pointer\'s next click is not swallowed', async () => {
  await armPointer1();
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(pointer1ClickReachesBody()).toBe(true);
});

test('a same-pointer press disarms its own lost release: that pointer\'s next release reaches the item', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  // The opening release was lost; pointer 1 presses again, on the item.
  fireEvent.pointerDown(item, { pointerId: 1, button: 0 });
  const seen = vi.fn();
  item.addEventListener('pointerup', seen);
  fireEvent.pointerUp(item, { pointerId: 1, button: 0 });
  item.removeEventListener('pointerup', seen);
  expect(seen).toHaveBeenCalledTimes(1);
});

test('control: with nothing disarming it, the armed pointer\'s click is swallowed (so the three tests above can fail)', async () => {
  await armPointer1();
  expect(pointer1ClickReachesBody()).toBe(false);
});

test('control: without a new press, the opening pointer\'s release is swallowed before it reaches the item', async () => {
  render(<ContextMenuHost host="h" />);
  fireEvent.pointerDown(document.body, { pointerId: 1, button: 2 });
  open();
  const item = await screen.findByRole('menuitem', { name: 'Hide' });
  const seen = vi.fn();
  item.addEventListener('pointerup', seen);
  fireEvent.pointerUp(item, { pointerId: 1, button: 0 });
  item.removeEventListener('pointerup', seen);
  expect(seen).not.toHaveBeenCalled();
});
