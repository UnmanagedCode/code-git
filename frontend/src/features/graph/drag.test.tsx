import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { MenuAction } from '@/shell/menus';
import { ref } from '@/test/graphData';
import type { BranchDropCtx } from './contexts';

const DROP_ACTIONS: MenuAction<BranchDropCtx>[] = [];
vi.mock('@/shell/menus', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/shell/menus')>();
  return { ...orig, actionsFor: (c: string, ctx: unknown) => orig.resolveActions(DROP_ACTIONS as MenuAction<unknown>[], c, ctx) };
});
// test/setup.ts already loaded the real registry: load these modules afresh so they see the mock.
vi.resetModules();
const { branchDropStore, dragStore, DragGhost, startBranchDrag, toDragRef, useDropActive } = await import('./drag');
const { ContextMenuHost, contextMenuStore } = await import('@/shell/ContextMenuHost');
afterEach(() => {
  DROP_ACTIONS.length = 0;
  dragStore.set(null);
  branchDropStore.set(null);
  contextMenuStore.set(null);
});

const TAB = { project: 'app', worktree: null };
const REFS = [ref('refs/heads/feature/a', 'a'.repeat(40)), ref('refs/heads/main', 'b'.repeat(40)), ref('refs/remotes/origin/main', 'c'.repeat(40))];
const resolve = (name: string) => { const r = REFS.find((x) => x.name === name); return r ? toDragRef(r) : null; };

function Chip({ name }: { name: string }) {
  const active = useDropActive(name);
  const r = REFS.find((x) => x.name === name)!;
  return (
    <button type="button" data-drop-ref={name} data-drop-active={active ? '' : undefined}
      onPointerDown={(e) => startBranchDrag(e, { tab: TAB, source: toDragRef(r)!, host: 'graph', resolve })}>
      {r.short}
    </button>
  );
}
function world() {
  const clicked: string[] = [];
  render(<div onClick={(e) => clicked.push((e.target as HTMLElement).textContent ?? '')}>{REFS.map((r) => <Chip key={r.name} name={r.name} />)}<DragGhost /><ContextMenuHost host="graph" /></div>);
  const chip = (short: string) => screen.getByRole('button', { name: short });
  return { chip, clicked };
}
const press = (el: Element, x = 10, y = 10) => fireEvent.pointerDown(el, { button: 0, clientX: x, clientY: y });

test('a press that moves under 4 px is not a drag: no ghost, no drop, and its click goes through', () => {
  const { chip, clicked } = world();
  press(chip('feature/a'));
  fireEvent.pointerMove(chip('main'), { clientX: 12, clientY: 12 });
  expect(dragStore.get()).toBeNull();
  fireEvent.pointerUp(chip('main'), { clientX: 12, clientY: 12 });
  fireEvent.click(chip('feature/a'));
  expect(branchDropStore.get()).toBeNull();
  expect(clicked).toEqual(['feature/a']);
});

test('dragging over another branch chip marks it the drop target and shows a ghost; tags are not branches', () => {
  const { chip } = world();
  expect(toDragRef(ref('refs/tags/v1', 'd'.repeat(40)))).toBeNull();
  press(chip('feature/a'));
  fireEvent.pointerMove(chip('main'), { clientX: 40, clientY: 40 });
  expect(chip('main').hasAttribute('data-drop-active')).toBe(true);
  expect(chip('origin/main').hasAttribute('data-drop-active')).toBe(false);
  expect(document.querySelector('[data-drag-ghost]')?.textContent).toBe('feature/a');
  fireEvent.pointerMove(chip('origin/main'), { clientX: 60, clientY: 40 });
  expect(chip('main').hasAttribute('data-drop-active')).toBe(false);
  expect(chip('origin/main').hasAttribute('data-drop-active')).toBe(true);
});

test('a drop publishes source and target with full refnames, swallows the release click, and opens no menu without actions', () => {
  const { chip, clicked } = world();
  press(chip('feature/a'));
  fireEvent.pointerMove(chip('origin/main'), { clientX: 40, clientY: 40 });
  fireEvent.pointerUp(chip('origin/main'), { clientX: 41, clientY: 42 });
  fireEvent.click(chip('origin/main'));
  expect(branchDropStore.get()).toMatchObject({
    tab: TAB, at: { x: 41, y: 42 },
    source: { name: 'refs/heads/feature/a', kind: 'local', short: 'feature/a' },
    target: { name: 'refs/remotes/origin/main', kind: 'remote', remote: 'origin' },
  });
  expect(clicked).toEqual([]);
  expect(contextMenuStore.get()).toBeNull();
  expect(dragStore.get()).toBeNull();
  expect(document.querySelector('[data-drag-ghost]')).toBeNull();
});

test('a dropped-on-itself or Esc-cancelled drag publishes nothing', () => {
  const { chip } = world();
  press(chip('feature/a'));
  fireEvent.pointerMove(chip('feature/a'), { clientX: 40, clientY: 40 });
  expect(chip('feature/a').hasAttribute('data-drop-active')).toBe(false);
  fireEvent.pointerUp(chip('feature/a'), { clientX: 40, clientY: 40 });
  expect(branchDropStore.get()).toBeNull();
  press(chip('feature/a'));
  fireEvent.pointerMove(chip('main'), { clientX: 40, clientY: 40 });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(dragStore.get()).toBeNull();
  fireEvent.pointerUp(chip('main'), { clientX: 40, clientY: 40 });
  expect(branchDropStore.get()).toBeNull();
});

test('with a registered branch-drop action the drop opens its menu, and choosing it runs with the drop ctx', async () => {
  const got: BranchDropCtx[] = [];
  DROP_ACTIONS.push({ id: 'test.merge', context: 'branch-drop', label: (c) => `Merge ${c.source.short} into ${c.target.short}`, run: (c) => { got.push(c); } });
  const { chip } = world();
  press(chip('feature/a'));
  fireEvent.pointerMove(chip('main'), { clientX: 40, clientY: 40 });
  act(() => { fireEvent.pointerUp(chip('main'), { clientX: 40, clientY: 40 }); });
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge feature/a into main' }));
  expect(got).toEqual([{ tab: TAB, source: resolve('refs/heads/feature/a'), target: resolve('refs/heads/main') }]);
});
