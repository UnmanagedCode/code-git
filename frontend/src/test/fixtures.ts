import type { ActivityEntry, Repo, RepoSummary } from '@/lib/endpoints';

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const repo = (over: Partial<Repo> = {}): Repo => ({
  project: 'app', path: '/p/app', workspace: 'Dev', system: 'local', remoteId: null, isGitRepo: true, unbornHead: false,
  systemUnreachable: null, gitRefusal: null, degraded: null, ...over,
});

export const summary = (over: Partial<RepoSummary> = {}): RepoSummary => ({
  head: { oid: 'a'.repeat(40), branch: 'main', unborn: false }, upstream: null, ahead: null, behind: null,
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }, ...over,
});

export const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 1, opRunId: 'run-1', op: 'repo.summary', target: { project: 'app', worktree: null },
  argv: ['git', '--no-pager', 'status', '--porcelain=v2'], env: {}, stdinBytes: 0, cancellable: true,
  startedAt: '2026-01-01T00:00:00.000Z', durationMs: 12, exitCode: 0, stderr: '', stderrTruncated: false, status: 'ok', code: null, ...over,
});
