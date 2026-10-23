import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, ChevronRightIcon, CommandIcon, GitBranchIcon, RefreshCwIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { backToParent, tabLabel } from '@/features/tabs/actions';
import type { RepoSummary } from '@/lib/endpoints';
import { PALETTE_KEY } from '@/shell/keys';
import { openPalette } from '@/shell/overlays';
import { shortcutLabel } from '@/shell/shortcuts';
import { dispatchTabs, parentTab, type Tab } from '@/state/tabs';
import { useRepoSummary } from '@/state/useRepoSummary';
import { reposStore, systemLabel } from '@/state/useRepos';
import { useStore } from '@/state/store';

function Head({ s }: { s: RepoSummary }) {
  if (s.head.unborn) {
    return (
      <span className="flex items-center gap-1.5" role="group" aria-label="HEAD">
        <GitBranchIcon className="size-4 text-muted-foreground" />
        <span className="font-mono text-sm">{s.head.branch}</span>
        <Badge variant="outline">no commits yet</Badge>
      </span>
    );
  }
  if (s.head.branch === null) {
    return (
      <span className="flex items-center gap-1.5" role="group" aria-label="HEAD">
        <Badge variant="warning">detached</Badge>
        <span className="font-mono text-sm">{s.head.oid?.slice(0, 10)}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5" role="group" aria-label="HEAD">
      <GitBranchIcon className="size-4 text-muted-foreground" />
      <span className="font-mono text-sm">{s.head.branch}</span>
    </span>
  );
}

/** The first `n` entries of a submodule tab's chain: its ancestors, the checkout at 0. */
const ancestor = (tab: Tab, n: number): Tab => ({ project: tab.project, worktree: tab.worktree, ...(n ? { sub: tab.sub!.slice(0, n) } : {}) });
/** A tab's own name as a breadcrumb or Back shows it: the last path of its chain, else its tab label. */
const ownName = (t: Tab): string => t.sub?.at(-1) ?? tabLabel(t);

/** A submodule tab's chain, each ancestor opening (or activating) its repo's tab; then Back to the parent. */
function SubmoduleTrail({ tab }: { tab: Tab }) {
  const sub = tab.sub!;
  const parent = parentTab(tab);
  return (
    <>
      <nav aria-label="Submodule path">
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          {sub.map((_, n) => (
            <li key={n} className="flex items-center gap-1">
              <button type="button" className="rounded px-1 hover:bg-accent hover:underline" onClick={() => dispatchTabs({ type: 'open', tab: ancestor(tab, n) })}>
                {ownName(ancestor(tab, n))}
              </button>
              <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
            </li>
          ))}
          <li><h1 className="text-sm font-semibold" aria-current="page">{sub.at(-1)}</h1></li>
        </ol>
      </nav>
      <Button variant="outline" size="sm" onClick={() => backToParent(tab)}>
        <ArrowLeftIcon />Back to {ownName(parent)}
      </Button>
    </>
  );
}

const COUNTS = ['staged', 'unstaged', 'untracked', 'conflicted'] as const;

/** The active checkout at a glance: HEAD, upstream, change counts and System. */
export function RepoHeader({ tab }: { tab: Tab }) {
  const { summary, loading, error, refresh } = useRepoSummary(tab);
  const repo = useStore(reposStore).repos?.find((r) => r.project === tab.project);
  const system = repo ? systemLabel(repo) : null;
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2" aria-label="Repository summary">
      {tab.sub ? <SubmoduleTrail tab={tab} /> : <h1 className="text-sm font-semibold">{tabLabel(tab)}</h1>}
      {system && <Badge variant="info">{system}</Badge>}
      {summary && (
        <>
          <Head s={summary} />
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Upstream">
            {summary.upstream === null ? 'no upstream' : (
              <>
                <span className="font-mono">{summary.upstream}</span>
                {summary.ahead !== null && <span className="flex items-center" aria-label={`${summary.ahead} ahead`}><ArrowUpIcon className="size-3.5" />{summary.ahead}</span>}
                {summary.behind !== null && <span className="flex items-center" aria-label={`${summary.behind} behind`}><ArrowDownIcon className="size-3.5" />{summary.behind}</span>}
              </>
            )}
          </span>
          <ul className="flex gap-3 text-sm" aria-label="Changes">
            {COUNTS.map((k) => (
              <li key={k} className={summary.counts[k] ? (k === 'conflicted' ? 'text-destructive' : 'text-foreground') : 'text-muted-foreground'}>
                {summary.counts[k]} {k}
              </li>
            ))}
          </ul>
        </>
      )}
      {!summary && loading && <span className="text-sm text-muted-foreground">Loading…</span>}
      <span className="ml-auto flex items-center gap-1" role="group" aria-label="Quick actions">
        <Button variant="ghost" size="icon-sm" aria-label={`Commands (${shortcutLabel(PALETTE_KEY)})`} title={`Commands (${shortcutLabel(PALETTE_KEY)})`} onClick={openPalette}>
          <CommandIcon />
        </Button>
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Refresh" disabled={loading} onClick={refresh}>
        <RefreshCwIcon className={loading ? 'animate-spin' : undefined} />
      </Button>
      {error && (
        <div className="basis-full text-sm" role="alert">
          <p className="text-destructive">{error.code === 'NOT_A_REPO' ? 'Not a git repository' : error.message}</p>
          {error.detail && <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{error.detail}</pre>}
        </div>
      )}
    </header>
  );
}
