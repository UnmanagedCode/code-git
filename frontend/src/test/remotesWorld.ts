import type { RemoteInfo } from '@/features/remotes/api';
import { trackingStore } from '@/state/branchTracking';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { remotesStore } from '@/state/remotes';
import { tabKey, type Tab } from '@/state/tabs';
import { json } from './fixtures';
import { linearWorld, paramsOf, stubGraph } from './graphBackend';
import { oid, ref, refsResult, worktree } from './graphData';

// A stubbed backend and graph state for the remotes UI (test-only): HEAD on `main` tracking origin/main, a free local
// `feature` with no upstream, remotes `origin` (and `upstream` when asked). Every remote op answers ok unless overridden.

export const T: Tab = { project: 'app', worktree: null };
export const HEAD_OID = oid(9);
export const ORIGIN_MAIN = oid(8);

export const remote = (name: string, over: Partial<RemoteInfo> = {}): RemoteInfo => ({
  name, urls: [`https://h/${name}.git`], pushUrls: [], fetch: [`+refs/heads/*:refs/remotes/${name}/*`], displayUrl: `https://h/${name}.git`, displayPushUrl: null, legacy: false, ...over,
});

const emptyUndo = { refs: [], remoteRefs: [], head: null, worktreeSnapshot: null, remotes: [] };
export const OK: Record<string, unknown> = {
  'remote.fetch': { remotes: [{ remote: 'origin', changes: [], pruned: [], symrefsResolved: [], partial: null }], undo: emptyUndo },
  'remote.pull': { mode: 'ff', upstream: 'refs/remotes/origin/main', outcome: 'fastForward', files: [], oid: ORIGIN_MAIN, fetch: {}, undo: emptyUndo },
  'remote.push': { remote: 'origin', branch: 'main', to: 'main', created: false, forced: false, upToDate: false, upstreamSet: false, unrequested: [], undo: emptyUndo },
  'remote.peek': { oid: ORIGIN_MAIN, tracking: { ref: 'refs/remotes/origin/main', oid: ORIGIN_MAIN }, stale: false },
  'remote.add': { name: 'x', undo: emptyUndo },
  'remote.edit': { name: 'x', undo: emptyUndo },
  'remote.rename': { name: 'x', undo: emptyUndo },
  'remote.remove': { name: 'x', deletedRefs: [], clearedUpstreams: [], undo: emptyUndo },
  'head.abort': { undo: emptyUndo },
};

/**
 * Sets the graph's refs and the tracking/remote stores for T, and stubs the backend. `answers`: per op, a result, a
 * Response (a refusal), or a function of the params returning either.
 */
export function remotesWorld({ head = 'main', remotes = [remote('origin')], answers = {}, upstream = true }: {
  head?: string | null; remotes?: RemoteInfo[]; answers?: Record<string, unknown>; upstream?: boolean;
} = {}) {
  const headRef = head ? `refs/heads/${head}` : null;
  const refs = refsResult({
    head: { oid: HEAD_OID, branch: headRef, detached: head === null, unborn: false },
    refs: [
      ref('refs/heads/main', HEAD_OID, { isHead: head === 'main' }), ref('refs/heads/feature', oid(7)),
      ref('refs/heads/code-conductor/wt', oid(6), { isHead: head === 'code-conductor/wt' }), ref('refs/remotes/origin/main', ORIGIN_MAIN),
    ],
    worktrees: [worktree('/p/app', HEAD_OID, headRef ?? '')],
  });
  graphStore.set(new Map([[tabKey(T), { ...EMPTY_GRAPH, status: 'ready', refs }]]));
  const up = (b: string) => (upstream ? `refs/remotes/origin/${b}` : null);
  trackingStore.set(new Map([['app', { loading: false, data: {
    remotes: remotes.map((r) => r.name),
    branches: {
      'refs/heads/main': { upstream: up('main'), ahead: 0, behind: 0, gone: false },
      'refs/heads/feature': { upstream: null, ahead: 0, behind: 0, gone: false },
      'refs/heads/code-conductor/wt': { upstream: up('code-conductor/wt'), ahead: 0, behind: 0, gone: false },
    },
  } }]]));
  remotesStore.set(new Map([['app', { data: remotes, busy: { fetch: false, pull: false, push: false }, autoFetchError: null }]]));
  const route = (op: string) => async (_u: URL, init?: RequestInit) => {
    const a = op in answers ? answers[op] : OK[op];
    const v = typeof a === 'function' ? await (a as (p: unknown) => unknown)(JSON.parse(String(init?.body ?? '{}')).params) : a;
    return v instanceof Response ? v : { ok: true, result: v };
  };
  const world = linearWorld(2);
  world.refs = refs;
  const fetch = stubGraph(world, {
    'POST api/ops/remote.list': { ok: true, result: { remotes } },
    'POST api/ops/branch.tracking': { ok: true, result: trackingStore.get().get('app')!.data },
    ...Object.fromEntries(Object.keys(OK).map((op) => [`POST api/ops/${op}`, route(op)])),
  });
  const posts = (op: string) => paramsOf(fetch, `POST api/ops/${op}`);
  return { fetch, posts, refs };
}

export const refusal = (code: string, error: string, extra: Record<string, unknown> = {}, status = 409) => json({ error, code, ...extra }, status);
