import type { CommitDetail, CommitItem, RefsResult, Stat } from '@/features/graph/types';
import type { RepoSummary, Worktree } from '@/lib/endpoints';
import { filesResult } from './diffFixtures';
import { json, summary } from './fixtures';
import { commit, oid, ref, refsResult } from './graphData';
import { stubFetch } from './stubFetch';

// A stubbed backend for the graph's ops (test-only). `world` is mutable: tests move refs or add commits between calls.

export interface GraphWorld {
  refs: RefsResult;
  /** All commits, topo-ordered; graph.page slices it. */
  commits: CommitItem[];
  worktrees: Worktree[];
  summaries: Record<string, RepoSummary | Response>;
  stats?: Record<string, Stat | null>;
  search?: (params: { mode: string; query: string }) => { matches: string[]; truncated: boolean };
  detail?: (o: string) => CommitDetail | Response;
  /** Answers graph.page itself when set (e.g. a failure). */
  page?: (params: { tips: string[]; skip: number; limit: number }) => unknown;
}

/** A linear history of `n` commits on main, newest first. */
export function linearWorld(n: number): GraphWorld {
  const commits = Array.from({ length: n }, (_, i) => commit(oid(n - i), i < n - 1 ? [oid(n - i - 1)] : [], { subject: `commit ${n - i}` }));
  return {
    refs: refsResult({
      head: { oid: oid(n), branch: 'refs/heads/main', detached: false, unborn: false },
      refs: [ref('refs/heads/main', oid(n), { isHead: true })],
      worktrees: [{ path: '/p/app', head: oid(n), branch: 'refs/heads/main', detached: false, bare: false, locked: false }],
    }),
    commits, worktrees: [], summaries: { '': summary({ head: { oid: oid(n), branch: 'main', unborn: false } }) },
  };
}

export const detailOf = (c: CommitItem, over: Partial<CommitDetail> = {}): CommitDetail => ({
  oid: c.oid, parents: c.parents, author: { ...c.author, time: c.time }, committer: { ...c.author, time: c.time }, subject: c.subject, body: '',
  coAuthors: [], signature: { status: 'N', signer: null, key: null }, files: [], filesError: null, ...over,
});

/** `extra`: more routes (a later card's ops), same form as stubFetch's. */
export function stubGraph(world: GraphWorld, extra: Parameters<typeof stubFetch>[0] = {}) {
  const body = (init?: RequestInit) => JSON.parse(String(init?.body ?? '{}')) as { target: { project: string; worktree?: string }; params?: Record<string, unknown> };
  return stubFetch({
    'POST api/ops/graph.refs': () => ({ ok: true, result: world.refs }),
    [`GET api/repos/app/worktrees`]: () => ({ worktrees: world.worktrees }),
    'POST api/ops/repo.summary': (_u: URL, init?: RequestInit) => {
      const s = world.summaries[body(init).target.worktree ?? ''];
      return s instanceof Response ? s : s ? { ok: true, result: s } : json({ error: 'gone', code: 'WORKTREE_UNKNOWN' }, 404);
    },
    'POST api/ops/graph.page': (_u: URL, init?: RequestInit) => {
      const p = body(init).params as { tips: string[]; skip: number; limit: number };
      if (world.page) return world.page(p);
      // As git does: only the commits reachable from the tips, in the world's (topo) order.
      const byOid = new Map(world.commits.map((c) => [c.oid, c]));
      const reach = new Set<string>();
      const queue = p.tips.filter((t) => byOid.has(t));
      while (queue.length) {
        const o = queue.pop()!;
        if (reach.has(o)) continue;
        reach.add(o);
        queue.push(...(byOid.get(o)?.parents ?? []).filter((x) => byOid.has(x)));
      }
      const all = world.commits.filter((c) => reach.has(c.oid));
      const items = all.slice(p.skip, p.skip + p.limit);
      return { ok: true, result: { items, nextCursor: p.skip + p.limit < all.length ? p.skip + p.limit : null } };
    },
    'POST api/ops/graph.stats': (_u: URL, init?: RequestInit) => {
      const oids = (body(init).params as { oids: string[] }).oids;
      return { ok: true, result: { stats: Object.fromEntries(oids.map((o) => [o, world.stats?.[o] ?? { files: 1, insertions: 2, deletions: 3 }])) } };
    },
    'POST api/ops/graph.search': (_u: URL, init?: RequestInit) => ({ ok: true, result: world.search?.(body(init).params as { mode: string; query: string }) ?? { matches: [], truncated: false } }),
    'POST api/ops/graph.commit': (_u: URL, init?: RequestInit) => {
      const o = (body(init).params as { oid: string }).oid;
      const d = world.detail?.(o) ?? detailOf(world.commits.find((c) => c.oid === o)!);
      return d instanceof Response ? d : { ok: true, result: d };
    },
    'GET api/activity': { entries: [], runs: [] },
    // The toolbar's remotes (the remotes card): none unless a test passes its own.
    'POST api/ops/remote.list': { ok: true, result: { remotes: [] } },
    // The diff the graph opens: its file list only.
    'POST api/ops/diff.files': { ok: true, result: filesResult([]) },
    // The Submodules panel beside the graph.
    'POST api/ops/submodule.list': { ok: true, result: { submodules: [], truncated: false } },
    ...extra,
  });
}

/** The params of every call to `route` ("POST api/ops/…"). */
export const paramsOf = (fetch: ReturnType<typeof stubFetch>, route: string) =>
  fetch.calls.filter((c) => `${c.method} ${c.url.pathname.replace(/^\//, '')}` === route).map((c) => (c.body as { params?: unknown }).params);
