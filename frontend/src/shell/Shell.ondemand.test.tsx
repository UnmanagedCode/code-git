import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { linearWorld, stubGraph } from '@/test/graphBackend';

// The diff panel replaced by one that throws on render: its fallback must give the center slot back to the graph.
vi.mock('@/features/diff/panel', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/features/diff/panel')>();
  const Boom = () => { throw new Error('diff exploded'); };
  return { ...orig, DIFF_PANEL: { ...orig.DIFF_PANEL, component: Boom } };
});
vi.resetModules();
const { Shell } = await import('./Shell');
const { dispatchTabs } = await import('@/state/tabs');
const { showPanel, shownPanelStore } = await import('@/state/shownPanel');
const { installFakeEventSource } = await import('@/test/fakeEventSource');

test('a crashed on-demand panel offers Close, which hides it and shows the slot\'s default panel again', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  installFakeEventSource();
  stubGraph(linearWorld(3));
  const TAB = { project: 'app', worktree: null };
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  act(() => showPanel(TAB, 'diff'));
  fireEvent.click(await screen.findByRole('button', { name: 'Close Diff' }));
  expect(shownPanelStore.get().has('app\0')).toBe(false);
  expect(await screen.findByRole('region', { name: 'Commit graph' })).toBeTruthy();
  err.mockRestore();
});
