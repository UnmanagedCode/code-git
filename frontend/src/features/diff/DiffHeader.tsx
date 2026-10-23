import type { ReactNode } from 'react';
import { ChevronDownIcon, FileDiffIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DiffFilesResult, DiffSource, Side } from './api';

const short = (oid: string) => oid.slice(0, 7);
const sideLabel = (s: Side) => (s.type === 'tree' ? short(s.oid) : s.type === 'index' ? 'index' : 'working directory');

/** What the diff shows, from the source as given and, once resolved, its pinned commits. */
export function sourceLabel(source: DiffSource, r: DiffFilesResult | null): string {
  switch (source.kind) {
    case 'commit': return `Commit ${r?.commit ? short(r.commit.oid) : source.rev}`;
    case 'unstaged': return 'Unstaged changes';
    case 'staged': return 'Staged changes';
    case 'compare': return `${source.from}${source.mode}${source.to}${r?.mergeBase ? ` (merge base ${short(r.mergeBase)})` : ''}`;
    case 'worktree': return `${source.rev} → working directory`;
    case 'commits': {
      const s = r?.series;
      if (!s) return `${source.oids.length} commits`;
      if (s.direct) return `${short(s.oids[1])} → ${short(s.oids[0])}`;
      const n = s.oids.length;
      const range = n === 1 ? short(s.oids[0]) : `${short(s.oids[n - 1])}…${short(s.oids[0])}`;
      return `${n === 1 ? 'Commit' : `${n} commits`} ${range}${s.wip ? ' + working directory' : ''}`;
    }
    case 'pair': return `${sideLabel(source.old)} → ${sideLabel(source.new)}`;
  }
}

interface Props {
  source: DiffSource;
  result: DiffFilesResult | null;
  loading: boolean;
  selectedCount: number;
  notice: string | null;
  /** Shown in place of the parent select (a stash's view switch). */
  parentControl?: ReactNode;
  /** Shown before the header's buttons (the narrow Files (n)). */
  filesControl?: ReactNode;
  onParent: (n: number) => void;
  onRefresh: () => void;
  onPatch: (how: 'download' | 'copy', selectedOnly: boolean) => void;
  onClose: () => void;
}

export function DiffHeader({ source, result, loading, selectedCount, notice, parentControl, filesControl, onParent, onRefresh, onPatch, onClose }: Props) {
  const parents = result?.commit?.parents ?? [];
  const parent = source.kind === 'commit' ? source.parent ?? 1 : 1;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
      <FileDiffIcon className="size-4 text-muted-foreground" />
      <h2 className="min-w-0 truncate font-mono text-sm" aria-label="Diff source">{sourceLabel(source, result)}</h2>
      {parentControl ?? (parents.length > 1 && (
        <select
          aria-label="Compare with parent"
          className="h-7 rounded-md border bg-background px-1 text-xs"
          value={parent}
          onChange={(e) => onParent(Number(e.target.value))}
        >
          {parents.map((p, i) => <option key={p} value={i + 1}>vs parent {i + 1} ({short(p)})</option>)}
        </select>
      ))}
      <div className="ml-auto flex items-center gap-1">
        {filesControl}
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Refresh diff" disabled={loading} onClick={onRefresh}>
          <RefreshCwIcon className={loading ? 'animate-spin' : undefined} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!result}>Create patch <ChevronDownIcon /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onPatch('download', false)}>Download .patch</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPatch('copy', false)}>Copy patch</DropdownMenuItem>
            {selectedCount > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onPatch('download', true)}>Download .patch of {selectedCount} selected files</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPatch('copy', true)}>Copy patch of {selectedCount} selected files</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Close diff" onClick={onClose}><XIcon /></Button>
      </div>
      {notice && <p className="basis-full text-xs text-destructive" role="alert">{notice}</p>}
    </div>
  );
}
