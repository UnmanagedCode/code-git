import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { MenuAction } from './menus';

interface Ctx { name: string; flag: boolean }
const ran: string[] = [];
const TEST: MenuAction<Ctx>[] = [
  { id: 'late', context: 'x', label: 'Late', order: 900, group: 'copy', run: () => { ran.push('late'); } },
  { id: 'first', context: 'x', label: ({ name }) => `Reset ${name} to this commit`, order: 100, group: 'nav', run: (c) => { ran.push(`first:${c.name}`); } },
  { id: 'second', context: 'x', label: 'Second', order: 100, group: 'nav', run: () => {} },
  { id: 'hidden', context: 'x', label: 'Hidden', when: (c) => c.flag, run: () => {} },
  {
    id: 'reset', context: 'x', label: 'Reset', order: 300, group: 'rewrite', children: [
      { id: 'soft', context: 'x', label: 'Soft', run: () => { ran.push('soft'); } },
      { id: 'hard', context: 'x', label: 'Hard', destructive: true, when: (c) => c.flag, run: () => {} },
    ],
  },
  { id: 'empty', context: 'x', label: 'Empty submenu', order: 300, group: 'rewrite', children: [{ id: 'never', context: 'x', label: 'Never', when: () => false, run: () => {} }] },
  { id: 'other', context: 'y', label: 'Other context', run: () => {} },
];

vi.mock('./menus', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./menus')>();
  return { ...orig, actionsFor: (c: string, ctx: unknown) => (c === 'tab' ? orig.actionsFor(c, ctx) : orig.resolveActions(TEST as MenuAction<unknown>[], c, ctx)) };
});
// test/setup.ts already loaded the real registry: load the menu modules afresh so they see the mock.
vi.resetModules();
const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import('@/components/ui/dropdown-menu');
const { ActionMenuItems } = await import('./ActionMenu');
const { ContextMenuHost, contextMenuStore, openContextMenu } = await import('./ContextMenuHost');
const { resolveActions } = await import('./menus');
afterEach(() => contextMenuStore.set(null));

function open(context: string, ctx: unknown) {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>t</DropdownMenuTrigger>
      <DropdownMenuContent><ActionMenuItems context={context} ctx={ctx} /></DropdownMenuContent>
    </DropdownMenu>,
  );
  return screen.getByRole('menu');
}
const texts = (menu: HTMLElement) => [...menu.querySelectorAll('[role=menuitem], [role=separator]')].map((e) => (e.getAttribute('role') === 'separator' ? '|' : e.textContent));

test('actions sort by order then registration, with a separator between groups and label functions applied', () => {
  const menu = open('x', { name: 'main', flag: false });
  expect(texts(menu)).toEqual(['Reset main to this commit', 'Second', '|', 'Reset', '|', 'Late']);
});

test('`when` filters actions and submenu children; a submenu with no child left is hidden', () => {
  expect(texts(open('x', { name: 'm', flag: true }))).toEqual(['Reset m to this commit', 'Second', '|', 'Reset', '|', 'Hidden', '|', 'Late']);
});

test('a submenu opens its children; choosing one runs it with the ctx', async () => {
  ran.length = 0;
  const menu = open('x', { name: 'main', flag: false });
  const trigger = within(menu).getByRole('menuitem', { name: 'Reset' });
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Soft' }));
  expect(ran).toEqual(['soft']);
  expect(screen.queryByRole('menuitem', { name: 'Hard' })).toBeNull();
});

test('resolveActions: context filter and the default order 500', () => {
  const ids = resolveActions(TEST, 'x', { name: 'n', flag: true }).map((a) => a.id);
  expect(ids).toEqual(['first', 'second', 'reset', 'hidden', 'late']);
  expect(resolveActions(TEST, 'y', { name: 'n', flag: true }).map((a) => a.id)).toEqual(['other']);
});

test("the tab menu's actions still render", () => {
  const menu = open('tab', { tab: { project: 'a', worktree: null }, index: 0, count: 2 });
  expect(texts(menu)).toEqual(['Close', 'Close others', 'Copy name']);
});

test('ContextMenuHost opens the context menu at the pointer in its own host; no action means no menu', async () => {
  ran.length = 0;
  render(<><ContextMenuHost host="a" /><ContextMenuHost host="b" /></>);
  expect(openContextMenu({ host: 'a', context: 'none', ctx: {}, at: { x: 1, y: 2 } })).toBe(false);
  expect(contextMenuStore.get()).toBeNull();
  act(() => { openContextMenu({ host: 'a', context: 'x', ctx: { name: 'dev', flag: false }, at: { x: 40, y: 60 } }); });
  const menu = await screen.findByRole('menu');
  expect(screen.getAllByRole('menu')).toHaveLength(1);
  const anchor = document.querySelector('[data-slot=dropdown-menu-trigger]') as HTMLElement;
  expect([anchor.style.getPropertyValue('--menu-x'), anchor.style.getPropertyValue('--menu-y')]).toEqual(['40px', '60px']);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Reset dev to this commit' }));
  expect(ran[0]).toBe('first:dev');
  expect(contextMenuStore.get()).toBeNull();
});
