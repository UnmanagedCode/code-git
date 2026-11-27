import { expect, test, vi } from 'vitest';
import { collapsedDirsStore, revealPath, setDirCollapsed } from './collapsedDirs';
import { dispatchTabs, tabKey, type Tab } from './tabs';

const A: Tab = { project: 'a', worktree: null };
const B: Tab = { project: 'b', worktree: 'wt' };
const dirs = (tab: Tab) => collapsedDirsStore.get().get(tabKey(tab)) ?? [];

test('a directory collapses and expands; repeating either is a no-op', () => {
  setDirCollapsed(A, 'src', true);
  setDirCollapsed(A, 'src', true);
  setDirCollapsed(A, 'docs', true);
  expect(dirs(A)).toEqual(['src', 'docs']);
  const before = collapsedDirsStore.get();
  setDirCollapsed(A, 'lib', false);
  expect(collapsedDirsStore.get()).toBe(before);
  setDirCollapsed(A, 'src', false);
  expect(dirs(A)).toEqual(['docs']);
});

test('each tab has its own set', () => {
  setDirCollapsed(A, 'src', true);
  setDirCollapsed(B, 'docs', true);
  expect(dirs(A)).toEqual(['src']);
  expect(dirs(B)).toEqual(['docs']);
});

test('revealPath expands only the file\'s ancestors, and changes nothing (no notification) when none is collapsed', () => {
  for (const d of ['src', 'src/a', 'src/ab', 'docs']) setDirCollapsed(A, d, true);
  setDirCollapsed(B, 'src', true);
  revealPath(A, 'src/a/x.ts');
  expect(dirs(A)).toEqual(['src/ab', 'docs']);
  expect(dirs(B)).toEqual(['src']);
  const listener = vi.fn();
  const off = collapsedDirsStore.subscribe(listener);
  revealPath(A, 'src/a/y.ts');
  revealPath(A, 'README.md');
  revealPath({ project: 'none', worktree: null }, 'src/x');
  off();
  expect(listener).not.toHaveBeenCalled();
});

test('revealPath leaves a collapsed folder whose name prefixes the file\'s folder (src/a for src/ab/x.ts)', () => {
  setDirCollapsed(A, 'src/a', true);
  revealPath(A, 'src/ab/x.ts');
  expect(dirs(A)).toEqual(['src/a']);
});

test('closing a tab drops its set', () => {
  dispatchTabs({ type: 'open', tab: A });
  dispatchTabs({ type: 'open', tab: B });
  setDirCollapsed(A, 'src', true);
  setDirCollapsed(B, 'src', true);
  dispatchTabs({ type: 'close', index: 0 });
  expect(collapsedDirsStore.get().has(tabKey(A))).toBe(false);
  expect(dirs(B)).toEqual(['src']);
});
