import type { DiffFile, FileDiff } from '@/features/diff/api';
import type { Conflict, Operation } from '@/features/sequence/api';
import type { RepoSummary } from '@/lib/endpoints';
import { filesResult, OID } from './diffFixtures';
import { summary as summaryFx } from './fixtures';
import { stubFetch } from './stubFetch';

// A stubbed backend for the Changes panel: the lists by source kind, the commit box reads, and every write op answered
// ok unless `answers` overrides it. `posts(op)` returns the params each call sent.

export interface WorkdirWorld {
  unstaged?: DiffFile[];
  staged?: DiffFile[];
  merging?: boolean;
  /** commit.state's operation and conflicts; left out of the answer when undefined (an older backend's shape). */
  operation?: Operation | null;
  conflicts?: Conflict[];
  template?: { summary: string; description: string } | null;
  head?: { summary: string; description: string };
  summary?: RepoSummary;
  /** diff.file answers by path. */
  fileDiffs?: Record<string, FileDiff>;
  /** Per op name: a body (sent as the op result), a Response, or a function of the params (and the target). */
  answers?: Record<string, unknown>;
}

const WRITES = ['stage.files', 'stage.unstageFiles', 'stage.discardFiles', 'stage.stageLines', 'stage.unstageLines', 'stage.discardLines',
  'commit.create', 'ignore.add', 'files.restore', 'patch.check', 'patch.apply', 'head.continue', 'head.skip', 'head.abort',
  'stash.push', 'stash.pushLines', 'stash.apply', 'stash.pop', 'stash.applyFile', 'stash.drop', 'stash.rename', 'stash.branch',
  'submodule.add', 'submodule.init', 'submodule.update', 'submodule.sync', 'submodule.setUrl', 'submodule.remove', 'submodule.commitPointer'];

export function workdirWorld(w: WorkdirWorld = {}) {
  const lists = { unstaged: w.unstaged ?? [], staged: w.staged ?? [] };
  const op = (name: string, fallback: (params: Record<string, unknown>) => unknown) => (_u: URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { target: unknown; params?: Record<string, unknown> };
    const params = body.params ?? {};
    const a = w.answers?.[name];
    const v = a === undefined ? fallback(params) : typeof a === 'function' ? (a as (p: unknown, target: unknown) => unknown)(params, body.target) : a;
    return v instanceof Response ? v : { ok: true, result: v };
  };
  const routes: Record<string, unknown> = {
    'GET api/activity': { entries: [], runs: [] },
    'POST api/ops/repo.summary': op('repo.summary', () => w.summary ?? summaryFx()),
    'POST api/ops/diff.files': op('diff.files', (p) => {
      const kind = (p.source as { kind: string }).kind as 'unstaged' | 'staged';
      const pair = kind === 'unstaged'
        ? { old: { type: 'index' as const }, new: { type: 'worktree' as const } }
        : { old: { type: 'tree' as const, oid: OID('a') }, new: { type: 'index' as const } };
      return filesResult(lists[kind] ?? [], { pair, commit: null });
    }),
    'POST api/ops/diff.file': op('diff.file', (p) => {
      const d = w.fileDiffs?.[p.path as string];
      if (!d) throw new Error(`no diff stubbed for ${String(p.path)}`);
      return d;
    }),
    // The commit graph beside the panel: an empty history.
    'POST api/ops/graph.refs': op('graph.refs', () => ({
      head: { oid: OID('a'), branch: 'refs/heads/main', detached: false, unborn: false }, refs: [], stashes: [], worktrees: [], worktreesError: null,
    })),
    'POST api/ops/graph.page': op('graph.page', () => ({ items: [], nextCursor: null })),
    'GET api/repos/app/worktrees': { worktrees: [] },
    // The Submodules panel beside the graph.
    'POST api/ops/submodule.list': op('submodule.list', () => ({ submodules: [], truncated: false })),
    'POST api/ops/commit.state': op('commit.state', () => ({
      merging: w.merging ?? false,
      ...(w.operation !== undefined ? { operation: w.operation } : {}), ...(w.conflicts !== undefined ? { conflicts: w.conflicts } : {}),
    })),
    'POST api/ops/commit.template': op('commit.template', () => ({ path: w.template ? '/t' : null, draft: w.template ?? null, problem: null })),
    'POST api/ops/commit.headMessage': op('commit.headMessage', () => ({ oid: 'a'.repeat(40), ...(w.head ?? { summary: 'HEAD summary', description: 'HEAD body' }) })),
    'POST api/ops/conflict.read': op('conflict.read', () => { throw new Error('no conflict.read stubbed'); }),
    // The remotes card's reads (push after commit): no remote unless answered.
    'POST api/ops/remote.list': op('remote.list', () => ({ remotes: [] })),
    'POST api/ops/branch.tracking': op('branch.tracking', () => ({ remotes: [], branches: {} })),
    'POST api/ops/remote.push': op('remote.push', () => ({ remote: 'origin', branch: 'main', to: 'main', created: false, forced: false, upToDate: false, upstreamSet: false, unrequested: [], undo: {} })),
  };
  for (const name of WRITES) routes[`POST api/ops/${name}`] = op(name, () => ({ oid: 'b'.repeat(40) }));
  const fetch = stubFetch(routes);
  const posts = (name: string) => fetch.calls.filter((c) => c.url.pathname.endsWith(`/ops/${name}`)).map((c) => (c.body as { params?: unknown }).params);
  return { fetch, posts, lists };
}
