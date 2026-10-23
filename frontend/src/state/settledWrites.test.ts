import { expect, test, vi } from 'vitest';
import { entry, opRun } from '@/test/fixtures';
import type { OpRun } from '@/lib/endpoints';
import { onSettledWrite, writeRunning } from './settledWrites';
import { activityStore } from './useActivity';

const anyApp = () => true;
const setRuns = (runs: OpRun[]) => activityStore.set((s) => ({ ...s, runs }));
const running = (id: number, over: Partial<OpRun> = {}) => opRun({ id, opRunId: `run-${id}`, status: 'running', endedAt: null, ...over });
const ended = (id: number, over: Partial<OpRun> = {}) => opRun({ id, opRunId: `run-${id}`, ...over });

// Invariant: "a write is running" is a running run of that project, whatever its entries say.
test('writeRunning: a running run of the project, not a running entry, and not another project', () => {
  activityStore.set({ entries: [entry({ status: 'running', kind: 'write' })], runs: [ended(1)], error: null });
  expect(writeRunning('app')).toBe(false);
  setRuns([ended(1), running(2, { target: { project: 'other', worktree: null } })]);
  expect(writeRunning('app')).toBe(false);
  setRuns([ended(1), running(3)]);
  expect(writeRunning('app')).toBe(true);
});

// Invariant: entries closing inside a running run never fire; the run's end fires exactly once.
test('onSettledWrite: commands closing inside a running run never fire; its end fires once', () => {
  const fn = vi.fn();
  const stop = onSettledWrite('app', anyApp, fn);
  setRuns([running(1)]);
  activityStore.set((s) => ({ ...s, entries: [entry({ id: 1, kind: 'write', opRunId: 'run-1', status: 'ok' })] }));
  activityStore.set((s) => ({ ...s, entries: [...s.entries, entry({ id: 2, kind: 'write', opRunId: 'run-1', status: 'ok' })] }));
  expect(fn).not.toHaveBeenCalled();
  setRuns([ended(1)]);
  expect(fn).toHaveBeenCalledTimes(1);
  activityStore.set((s) => ({ ...s, entries: [...s.entries] }));
  setRuns([ended(1)]);
  expect(fn).toHaveBeenCalledTimes(1);
  stop();
  setRuns([ended(1), ended(2)]);
  expect(fn).toHaveBeenCalledTimes(1);
});

// Invariant: overlapping writes on one project give one call, after the last of them ended — whichever ends first.
test('onSettledWrite: overlapping runs fire once, after the last ends, even when the older one ends last', () => {
  const fn = vi.fn();
  onSettledWrite('app', anyApp, fn);
  setRuns([running(1), running(2)]);
  setRuns([running(1), ended(2)]);
  expect(fn).not.toHaveBeenCalled();
  setRuns([ended(1), ended(2)]);
  expect(fn).toHaveBeenCalledTimes(1);
});

// Invariant: a run running when the watcher starts is waited for, and its own end (nothing else added) fires once.
test('onSettledWrite: a run already running at subscribe time fires when it ends; runs ended before subscribing do not', () => {
  setRuns([ended(1), running(2)]);
  const fn = vi.fn();
  onSettledWrite('app', anyApp, fn);
  activityStore.set((s) => ({ ...s, entries: [entry({ id: 9 })] }));
  expect(fn).not.toHaveBeenCalled();
  setRuns([ended(1), ended(2)]);
  expect(fn).toHaveBeenCalledTimes(1);
  setRuns([ended(1), ended(2)]);
  expect(fn).toHaveBeenCalledTimes(1);
});

// Invariant: at fire time the high-water mark moves to the newest settled run, so a set of runs ending together fires
// once, and later unrelated store updates fire nothing.
test('onSettledWrite: runs ending together fire once; unrelated updates afterwards fire nothing', () => {
  const fn = vi.fn();
  onSettledWrite('app', anyApp, fn);
  setRuns([running(1), running(2)]);
  setRuns([ended(1), ended(2)]);
  expect(fn).toHaveBeenCalledTimes(1);
  activityStore.set((s) => ({ ...s, entries: [entry({ id: 10 })] }));
  activityStore.set((s) => ({ ...s, entries: [...s.entries, entry({ id: 11 })] }));
  setRuns([ended(1), ended(2), ended(3, { target: { project: 'other', worktree: null } })]);
  expect(fn).toHaveBeenCalledTimes(1);
});

// Invariant: another project's runs, or runs whose target does not match, neither fire nor hold the call back past
// the project's own settle; another project's running run does not defer this project's call.
test('onSettledWrite: other projects and non-matching targets are ignored', () => {
  const fn = vi.fn();
  onSettledWrite('app', (t) => (t.worktree ?? null) === 'wt', fn);
  setRuns([ended(1, { target: { project: 'other', worktree: 'wt' } })]);
  setRuns([ended(1, { target: { project: 'other', worktree: 'wt' } }), ended(2)]);
  expect(fn).not.toHaveBeenCalled();
  setRuns([ended(2), running(3, { target: { project: 'other', worktree: 'wt' } }), ended(4, { target: { project: 'app', worktree: 'wt' } })]);
  expect(fn).toHaveBeenCalledTimes(1);
});

// Invariant: a missed run event is recovered by any later refetch (e.g. the reconnect's) that shows the run ended.
test('onSettledWrite: a refetch revealing a run that opened and ended unseen fires', () => {
  const fn = vi.fn();
  onSettledWrite('app', anyApp, fn);
  setRuns([ended(7)]);
  expect(fn).toHaveBeenCalledTimes(1);
});
