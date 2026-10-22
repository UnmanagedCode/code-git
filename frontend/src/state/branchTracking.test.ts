import { renderHook, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { ref } from '@/test/graphData';
import { stubFetch } from '@/test/stubFetch';
import { refreshTracking, trackingStore, useTracking } from './branchTracking';
import { refreshGraph } from './graph';

const T = { project: 'app', worktree: null };
const tracking = (behind: number) => ({
  ok: true, result: { remotes: ['origin'], branches: { 'refs/heads/main': { upstream: 'refs/remotes/origin/main', ahead: 0, behind, gone: false } } },
});

test('tracking is fetched once per refs change, shared by every consumer, and follows the graph\'s refs', async () => {
  const world = linearWorld(2);
  let behind = 1;
  const fetch = stubGraph(world, { 'POST api/ops/branch.tracking': () => tracking(behind) });
  await refreshGraph(T, 'open');
  const a = renderHook(() => useTracking(T));
  renderHook(() => useTracking(T));
  await waitFor(() => expect(a.result.current.data?.branches['refs/heads/main'].behind).toBe(1));
  expect(fetch.count('POST api/ops/branch.tracking')).toBe(1);
  // Refs move (a write, a fetch elsewhere): the graph's refs object changes and tracking is read again.
  behind = 0;
  world.refs = { ...world.refs, refs: [...world.refs.refs, ref('refs/heads/new', world.refs.head.oid)] };
  await refreshGraph(T, 'manual');
  await waitFor(() => expect(a.result.current.data?.branches['refs/heads/main'].behind).toBe(0));
  expect(fetch.count('POST api/ops/branch.tracking')).toBe(2);
});

test('refreshTracking coalesces: calls while one request is in flight send no request of their own, then exactly one rerun', async () => {
  const pending: ((v: unknown) => void)[] = [];
  const fetch = stubFetch({ 'POST api/ops/branch.tracking': () => new Promise((resolve) => { pending.push(resolve); }) });
  const first = refreshTracking(T);
  void refreshTracking(T);
  void refreshTracking(T);
  await waitFor(() => expect(pending).toHaveLength(1));
  expect(fetch.count('POST api/ops/branch.tracking')).toBe(1);
  pending[0](tracking(3));
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(fetch.count('POST api/ops/branch.tracking')).toBe(2);
  pending[1](tracking(4));
  await first;
  expect(fetch.count('POST api/ops/branch.tracking')).toBe(2);
  expect(trackingStore.get().get('app')?.data?.branches['refs/heads/main'].behind).toBe(4);
  expect(trackingStore.get().get('app')?.loading).toBe(false);
});
