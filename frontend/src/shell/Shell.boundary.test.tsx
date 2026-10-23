import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { filesResult } from '@/test/diffFixtures';
import { summary } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';

// The graph panel replaced by one that throws on render: the shell must keep the header and the other panels.
vi.mock('@/features/graph/panel', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/features/graph/panel')>();
  const Boom = () => { throw new RangeError('Invalid time value'); };
  return { ...orig, GRAPH_PANEL: { ...orig.GRAPH_PANEL, component: Boom } };
});
vi.resetModules();
const { Shell } = await import('./Shell');
const { dispatchTabs } = await import('@/state/tabs');
// The fresh module graph has its own SSE module: give it the fake EventSource too.
const { installFakeEventSource } = await import('@/test/fakeEventSource');

test('a panel that throws while rendering is contained: the header and the other panels stay', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  installFakeEventSource();
  stubFetch({
    'GET api/activity': { entries: [] },
    'POST api/ops/repo.summary': { ok: true, result: summary() },
    'POST api/ops/graph.refs': { ok: true, result: { head: { oid: null, branch: 'refs/heads/main', detached: false, unborn: true }, refs: [], stashes: [], worktrees: [], worktreesError: null } },
    'GET api/repos/app/worktrees': { worktrees: [] },
    // The Changes panel beside the graph loads too; it must not add an alert of its own.
    'POST api/ops/diff.files': { ok: true, result: filesResult([], { commit: null }) },
    'POST api/ops/commit.state': { ok: true, result: { merging: false } },
    'POST api/ops/commit.template': { ok: true, result: { path: null, draft: null, problem: null } },
    'POST api/ops/submodule.list': { ok: true, result: { submodules: [], truncated: false } },
  });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: { project: 'app', worktree: null } }));
  expect(await screen.findByText('The Commit graph panel failed: Invalid time value')).toBeTruthy();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'app' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
  // A default panel's fallback has no Close: there is no other panel to give its slot to.
  expect(screen.queryByRole('button', { name: 'Close Commit graph' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  err.mockRestore();
});
