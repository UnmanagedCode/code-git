import { useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { listWorktrees, type Repo, type Worktree } from '@/lib/endpoints';
import { disabledReason, systemLabel, useRepos } from '@/state/useRepos';
import type { Tab } from '@/state/tabs';

type WorktreesState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; worktrees: Worktree[] };

function RepoRow({ repo, onOpen }: { repo: Repo; onOpen: (t: Tab) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [wts, setWts] = useState<WorktreesState | null>(null);
  const reason = disabledReason(repo);
  const system = systemLabel(repo);
  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || wts?.status === 'ok') return;
    setWts({ status: 'loading' });
    try {
      setWts({ status: 'ok', worktrees: await listWorktrees(repo.project) });
    } catch (e) {
      setWts({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <li className="rounded-md">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost" size="icon-sm" className="size-7" disabled={!!reason} aria-expanded={expanded}
          aria-label={`Show worktrees of ${repo.project}`} onClick={() => void toggle()}
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
        <button
          type="button"
          disabled={!!reason}
          className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
          onClick={() => onOpen({ project: repo.project, worktree: null })}
        >
          {repo.project}
        </button>
        {repo.unbornHead && <Badge variant="outline">no commits</Badge>}
        {system && <Badge variant="info">{system}</Badge>}
      </div>
      {reason && <p className="ml-9 truncate text-xs text-muted-foreground" title={reason}>{reason}</p>}
      {expanded && wts && (
        <ul className="mb-1 ml-9 border-l pl-2" aria-label={`Checkouts of ${repo.project}`}>
          {wts.status === 'loading' && <li className="text-xs text-muted-foreground">Loading worktrees…</li>}
          {wts.status === 'error' && <li className="text-xs text-destructive">{wts.message}</li>}
          {wts.status === 'ok' && (
            <>
              <li>
                <button type="button" className="w-full rounded px-1 py-0.5 text-left text-sm hover:bg-accent" onClick={() => onOpen({ project: repo.project, worktree: null })}>
                  (main checkout)
                </button>
              </li>
              {wts.worktrees.map((w) => (
                <li key={w.worktreeName}>
                  <button
                    type="button" className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-accent"
                    onClick={() => onOpen({ project: repo.project, worktree: w.worktreeName })}
                  >
                    <span>{w.worktreeName}</span>
                    {w.branch && <span className="truncate font-mono text-xs text-muted-foreground">{w.branch}</span>}
                    {w.locked && <Badge variant="outline">locked</Badge>}
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </li>
  );
}

/** The dialog that opens a cc project's checkout in a tab. Every project is listed; one that cannot be opened is disabled with its reason. */
export function RepoPicker({ open, onOpenChange, onOpen }: { open: boolean; onOpenChange: (o: boolean) => void; onOpen: (t: Tab) => void }) {
  const { repos, error, loading, reload } = useRepos();
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = (repos ?? []).filter((r) => !f || r.project.toLowerCase().includes(f) || (r.workspace ?? '').toLowerCase().includes(f));
    const by = new Map<string, Repo[]>();
    for (const r of [...shown].sort((a, b) => a.project.localeCompare(b.project))) {
      const k = r.workspace ?? '';
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [repos, filter]);
  const pick = (t: Tab) => { onOpen(t); onOpenChange(false); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Open a repository</DialogTitle>
          <DialogDescription>Projects registered in code-conductor, on any System.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Filter projects" placeholder="Filter projects" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-[60dvh] overflow-y-auto pr-1">
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void reload()}>Retry</Button>
            </div>
          )}
          {!repos && loading && <p className="text-sm text-muted-foreground">Loading projects…</p>}
          {repos && !groups.length && <p className="text-sm text-muted-foreground">No project matches.</p>}
          {groups.map(([workspace, rows]) => (
            <section key={workspace} aria-label={workspace || 'No workspace'} className="mb-3">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{workspace || 'No workspace'}</h3>
              <ul>{rows.map((r) => <RepoRow key={r.project} repo={r} onOpen={pick} />)}</ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
