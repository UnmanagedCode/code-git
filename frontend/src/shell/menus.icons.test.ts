import { expect, test } from 'vitest';
import { ACTIONS, type MenuAction } from './menus';

const walk = (list: readonly MenuAction<never>[]): MenuAction<never>[] => list.flatMap((a) => [a, ...(Array.isArray(a.children) ? walk(a.children) : [])]);

test('every registered action, and every submenu child declared as an array, has an icon', () => {
  expect(walk(ACTIONS).filter((a) => !a.icon).map((a) => a.id)).toEqual([]);
});
