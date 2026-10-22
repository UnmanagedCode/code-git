import { expect, test, vi } from 'vitest';
import type { MenuAction } from './menus';

interface Ctx { ok: boolean }
const ran: string[] = [];
const TEST: MenuAction<Ctx>[] = [
  { id: 'plain', context: 'x', label: 'Plain', order: 100, run: () => { ran.push('plain'); } },
  { id: 'gated', context: 'x', label: 'Gated', order: 200, primary: true, when: (c) => c.ok, run: () => { ran.push('gated'); } },
  { id: 'fallback', context: 'x', label: 'Fallback', order: 300, primary: true, run: () => { ran.push('fallback'); } },
  { id: 'other', context: 'y', label: 'Y', run: () => { ran.push('y'); } },
];
vi.mock('@/features/graph/actions', () => ({ GRAPH_ACTIONS: TEST }));
// test/setup.ts already loaded the real registry: load menus afresh so it sees the mock.
vi.resetModules();
const { runPrimary } = await import('./menus');

test('runPrimary runs the first primary action that passes `when`, in menu order, and reports it ran', () => {
  ran.length = 0;
  expect(runPrimary('x', { ok: true })).toBe(true);
  expect(runPrimary('x', { ok: false })).toBe(true);
  expect(ran).toEqual(['gated', 'fallback']);
});

test('runPrimary returns false and runs nothing when the context has no primary action', () => {
  ran.length = 0;
  expect(runPrimary('y', { ok: true })).toBe(false);
  expect(runPrimary('none', { ok: true })).toBe(false);
  expect(ran).toEqual([]);
});
