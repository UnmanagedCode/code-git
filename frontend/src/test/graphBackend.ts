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

export function stubGraph(world: GraphWorld) {
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
      const items = p.tips.length ? world.commits.slice(p.skip, p.skip + p.limit) : [];
      return { ok: true, result: { items, nextCursor: p.skip + p.limit < world.commits.length && p.tips.length ? p.skip + p.limit : null } };
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
    'GET api/activity': { entries: [] },
    // The diff the graph opens: its file list only.
    'POST api/ops/diff.files': { ok: true, result: filesResult([]) },
  });
}

/** The params of every call to `route` ("POST api/ops/…"). */
export const paramsOf = (fetch: ReturnType<typeof stubFetch>, route: string) =>
  fetch.calls.filter((c) => `${c.method} ${c.url.pathname.replace(/^\//, '')}` === route).map((c) => (c.body as { params?: unknown }).params);
