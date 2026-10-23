import { ArrowDownToLineIcon, ArrowUpFromLineIcon, ChevronDownIcon, CloudDownloadIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { clip } from '@/lib/clip';
import { cn } from '@/lib/utils';
import { useTracking } from '@/state/branchTracking';
import { useGraphData } from '@/state/graph';
import { AUTO_FETCH_MINUTES, PULL_MODES, updateRemotePrefs, useRemotePrefs } from '@/state/remotePrefs';
import { useRemotes } from '@/state/remotes';
import type { Tab } from '@/state/tabs';
import type { PullMode } from './api';
import { pushHead } from './pushFlow';
import { fetchFlow, PULL_LABEL, pullFlow } from './run';

// The graph toolbar's Fetch, Pull (a split button: the default mode, and a menu of modes, the default, prune and
// auto-fetch) and Push. Each shows a spinner and is disabled while its op runs; the activity panel has the elapsed
// time and Cancel (fetch, push).

const MODE_SHORT: Record<PullMode, string> = { ff: 'Fast-forward if possible', ffOnly: 'Fast-forward only', rebase: 'Rebase' };
const minutesLabel = (m: number) => (m === 0 ? 'Off' : `Every ${m} min`);

function ToolButton({ label, title, busy, disabled, icon, onClick, className, badge, children }: {
  label: string; title: string; busy: boolean; disabled: boolean; icon: ReactNode; onClick: () => void; className?: string; badge?: ReactNode; children?: ReactNode;
}) {
  return (
    <Button variant="outline" size="sm" className={cn('relative h-7 gap-1 px-2', className)} aria-label={label} title={title} aria-busy={busy || undefined}
      disabled={disabled || busy} onClick={onClick}>
      {busy ? <LoaderCircleIcon className="animate-spin" /> : icon}
      <span className="max-sm:hidden">{children}</span>
      {badge}
    </Button>
  );
}

export function RemoteToolbar({ tab }: { tab: Tab }) {
  const remotes = useRemotes(tab);
  const tracking = useTracking(tab);
  const prefs = useRemotePrefs(tab.project);
  const head = useGraphData(tab).refs?.head;
  const branch = head && !head.detached && head.branch ? head.branch : null;
  const upstream = branch ? tracking.data?.branches[branch]?.upstream ?? null : null;
  const canPull = !!upstream?.startsWith('refs/remotes/');
  const hasRemote = (remotes.data?.length ?? 0) > 0;
  const canPush = !!branch && !head?.unborn && !!head?.oid;
  const fetchError = remotes.autoFetchError;
  return (
    <span className="flex items-center gap-1" role="group" aria-label="Remote">
      <ToolButton label={fetchError ? `Fetch (auto-fetch failed: ${clip(fetchError)})` : 'Fetch'} title={fetchError ? `Auto-fetch failed: ${clip(fetchError)}` : 'Fetch all remotes'}
        busy={remotes.busy.fetch} disabled={!hasRemote} icon={<CloudDownloadIcon />} onClick={() => void fetchFlow(tab, null)}
        badge={fetchError ? <span aria-hidden className="absolute -top-1 -right-1 size-2 rounded-full bg-warning" data-fetch-warning /> : undefined}>
        Fetch
      </ToolButton>
      <span className="flex items-center">
        <ToolButton label="Pull" title={canPull ? PULL_LABEL[prefs.pullMode] : 'HEAD has no upstream on a remote'} busy={remotes.busy.pull} disabled={!canPull}
          icon={<ArrowDownToLineIcon />} className="rounded-r-none" onClick={() => pullFlow(tab, prefs.pullMode)}>
          Pull
        </ToolButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" className="h-7 w-5 rounded-l-none border-l-0" aria-label="Pull options"><ChevronDownIcon /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Pull</DropdownMenuLabel>
            {PULL_MODES.map((m) => (
              <DropdownMenuItem key={m} disabled={!canPull || remotes.busy.pull} onSelect={() => pullFlow(tab, m)}>{PULL_LABEL[m]}</DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>The Pull button runs</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={prefs.pullMode} onValueChange={(v) => updateRemotePrefs(tab.project, { pullMode: v as PullMode })}>
              {PULL_MODES.map((m) => <DropdownMenuRadioItem key={m} value={m}>{MODE_SHORT[m]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!hasRemote || remotes.busy.fetch} onSelect={() => void fetchFlow(tab, null, true)}>Fetch all (prune)…</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Auto-fetch: {minutesLabel(prefs.autoFetchMinutes)}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={String(prefs.autoFetchMinutes)} onValueChange={(v) => updateRemotePrefs(tab.project, { autoFetchMinutes: Number(v) })}>
                  {AUTO_FETCH_MINUTES.map((m) => <DropdownMenuRadioItem key={m} value={String(m)}>{minutesLabel(m)}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <ToolButton label="Push" title={canPush ? 'Push HEAD\'s branch' : 'HEAD is detached or has no commit'} busy={remotes.busy.push} disabled={!canPush}
        icon={<ArrowUpFromLineIcon />} onClick={() => pushHead(tab)}>
        Push
      </ToolButton>
    </span>
  );
}
