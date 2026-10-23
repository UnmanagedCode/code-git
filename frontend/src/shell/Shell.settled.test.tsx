import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { ActivityEntry, OpRun } from '@/lib/endpoints';
import { dispatchTabs } from '@/state/tabs';
import { FakeEventSource } from '@/test/fakeEventSource';
import { entry, json, opRun } from '@/test/fixtures';
import { workdirWorld } from '@/test/workdirWorld';
import { Shell } from './Shell';

// The whole chain a write run travels in the UI: the SSE stream → the activity refetch → the activity store → every
// watcher reading git state (graph refs and summaries, the Submodules panel, undo).

const TAB = { project: 'app', worktree: null };
const WATCHED = ['graph.refs', 'graph.page', 'repo.summary', 'submodule.list', 'undo.state'];

// Invariant: replaying a multi-command write run (run open, three commands opening and closing, run end) through the
// real SSE → store chain makes no watcher read before the run ends, and one round after it.
test('a write run replayed through the stream: no watcher read until the run ends, then one round', async () => {
  let activity: { entries: ActivityEntry[]; runs: OpRun[] } = { entries: [], runs: [] };
  const w = workdirWorld();
  const routes = w.fetch.fn.getMockImplementation()!;
  const seen: string[] = [];
  w.fetch.fn.mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://x/').pathname;
    seen.push(path);
    if (path === '/api/activity') return json(activity);
    if (path === '/api/ops/undo.state') return json({ ok: true, result: { undo: null, redo: null } });
    return routes(input, init);
  });
  const count = (op: string) => seen.filter((p) => p === `/api/ops/${op}`).length;
  const counts = () => Object.fromEntries(WATCHED.map((op) => [op, count(op)]));
  const refetches = () => seen.filter((p) => p === '/api/activity').length;

  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  await screen.findByRole('region', { name: 'Submodules' });
  await waitFor(() => expect(['graph.refs', 'submodule.list', 'undo.state'].every((op) => count(op) > 0)).toBe(true));
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
  const base = counts();

  /** Serves `next` and signals it as `type`, then waits for the refetch to land. */
  const step = async (next: typeof activity, type: 'activity' | 'run') => {
    activity = next;
    const before = refetches();
    act(() => FakeEventSource.last!.emit({}, type));
    await waitFor(() => expect(refetches()).toBe(before + 1));
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
  };

  const run = opRun({ id: 1, opRunId: 'run-1', op: 'submodule.remove', status: 'running', endedAt: null });
  await step({ entries: [], runs: [run] }, 'run');
  let entries: ActivityEntry[] = [];
  for (const id of [1, 2, 3]) {
    const open = entry({ id, opRunId: 'run-1', op: 'submodule.remove', kind: 'write', status: 'running', exitCode: null, durationMs: null });
    entries = [...entries, open];
    await step({ entries, runs: [run] }, 'activity');
    entries = entries.map((e) => (e.id === id ? { ...e, status: 'ok', exitCode: 0, durationMs: 5 } : e));
    await step({ entries, runs: [run] }, 'activity');
    expect(counts()).toEqual(base);
  }
  await step({ entries, runs: [{ ...run, status: 'ended', endedAt: '2026-01-01T00:00:02.000Z' }] }, 'run');
  await waitFor(() => expect(count('undo.state')).toBe(base['undo.state'] + 1));
  await waitFor(() => expect(count('submodule.list')).toBe(base['submodule.list'] + 1));
  await waitFor(() => expect(count('graph.refs')).toBe(base['graph.refs'] + 1));
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect([count('graph.refs'), count('submodule.list'), count('undo.state')])
    .toEqual([base['graph.refs'] + 1, base['submodule.list'] + 1, base['undo.state'] + 1]);
  expect(count('repo.summary')).toBeGreaterThan(base['repo.summary']);
});
