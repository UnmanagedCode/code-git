import type { RepoSummary } from '@/lib/endpoints';

/** A commit on a detached HEAD lands on no branch: say so above the commit box. */
export function DetachedBanner({ summary }: { summary: RepoSummary | null }) {
  if (!summary || summary.head.branch !== null || summary.head.unborn) return null;
  return (
    <div role="status" className="border-b bg-warning/15 px-3 py-2 text-xs text-warning">
      Detached HEAD at <span className="font-mono">{summary.head.oid?.slice(0, 10)}</span>. A commit made here is on no branch.
    </div>
  );
}
