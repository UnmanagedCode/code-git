import { api } from './api';

// The backend's API as the UI uses it; shapes are documented in docs/protocol.md.

/** A cc checkout, or a submodule inside one: `sub` is the chain of submodule paths, absent for the checkout itself. */
export interface Target { project: string; worktree: string | null; sub?: string[] }

export interface Repo {
  project: string;
  path: string;
  workspace: string | null;
  system: string;
  remoteId: string | null;
  /** Absent when cc could not look; a reason field then says why. */
  isGitRepo?: boolean;
  unbornHead: boolean;
  systemUnreachable: string | null;
  gitRefusal: string | null;
  degraded: string | null;
}

export interface Worktree { worktreeName: string; branch: string | null; baseBranch: string | null; locked: boolean }

export interface RepoSummary {
  head: { oid: string | null; branch: string | null; unborn: boolean };
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  counts: { staged: number; unstaged: number; untracked: number; conflicted: number };
}

export type ActivityStatus = 'running' | 'ok' | 'failed' | 'refused' | 'timeout' | 'cancelled';

export interface ActivityEntry {
  id: number;
  opRunId: string;
  op: string;
  target: Target;
  argv: string[];
  env: Record<string, string>;
  stdinBytes: number;
  kind: 'read' | 'write';
  cancellable: boolean;
  startedAt: string;
  durationMs: number | null;
  exitCode: number | null;
  stderr: string;
  stderrTruncated: boolean;
  status: ActivityStatus;
  code: string | null;
}

const targetBody = (t: Target) => ({
  project: t.project, ...(t.worktree ? { worktree: t.worktree } : {}), ...(t.sub?.length ? { sub: t.sub } : {}),
});

export const listRepos = () => api<{ repos: Repo[] }>('api/repos').then((r) => r.repos);
export const listWorktrees = (project: string) =>
  api<{ worktrees: Worktree[] }>(`api/repos/${encodeURIComponent(project)}/worktrees`).then((r) => r.worktrees);
/** Runs a backend op on a checkout. Aborting `signal` drops the request, which cancels a cancellable op. */
export const runOp = <T>(name: string, target: Target, params?: unknown, opts?: { signal?: AbortSignal }) =>
  api<{ ok: true; result: T }>(`api/ops/${encodeURIComponent(name)}`, {
    method: 'POST', body: { target: targetBody(target), ...(params === undefined ? {} : { params }) }, signal: opts?.signal,
  }).then((r) => r.result);
export const listActivity = () => api<{ entries: ActivityEntry[] }>('api/activity').then((r) => r.entries);
export const cancelActivity = (id: number) => api<{ ok: true }>(`api/activity/${id}/cancel`, { method: 'POST' });
