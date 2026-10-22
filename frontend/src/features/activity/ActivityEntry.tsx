import { useEffect, useState } from 'react';
import { BanIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon, ClockIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tabLabel } from '@/features/tabs/actions';
import type { ActivityEntry as Entry, ActivityStatus } from '@/lib/endpoints';
import { cn } from '@/lib/utils';

const STATUS: Record<ActivityStatus, { icon: typeof CircleCheckIcon; className: string }> = {
  running: { icon: LoaderCircleIcon, className: 'animate-spin text-info' },
  ok: { icon: CircleCheckIcon, className: 'text-success' },
  failed: { icon: CircleXIcon, className: 'text-destructive' },
  refused: { icon: CircleAlertIcon, className: 'text-warning' },
  timeout: { icon: ClockIcon, className: 'text-warning' },
  cancelled: { icon: BanIcon, className: 'text-muted-foreground' },
};

/** Seconds since `startedAt`, ticking while `live`. */
function useElapsed(startedAt: string, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return Math.max(0, now - Date.parse(startedAt));
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** One git command. Every field is untrusted text and renders as text. */
export function ActivityEntry({ entry, onCancel }: { entry: Entry; onCancel: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const running = entry.status === 'running';
  const elapsed = useElapsed(entry.startedAt, running);
  const { icon: Icon, className } = STATUS[entry.status];
  return (
    <li className="border-b px-3 py-1.5 text-xs last:border-b-0" aria-label={`${entry.op} ${entry.status}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon className={cn('size-3.5 shrink-0', className)} aria-label={entry.status} role="img" />
        <span className="font-medium">{entry.op}</span>
        <span className="text-muted-foreground">{tabLabel(entry.target)}</span>
        <span className="text-muted-foreground tabular-nums">{running ? `${Math.floor(elapsed / 1000)} s…` : entry.durationMs !== null ? fmtMs(entry.durationMs) : ''}</span>
        {entry.exitCode !== null && <span className="text-muted-foreground">exit {entry.exitCode}</span>}
        {entry.code && <span className="text-destructive">{entry.code}</span>}
        <span className="ml-auto flex gap-1">
          {entry.stderr && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide output' : 'Show output'}
            </Button>
          )}
          {running && entry.cancellable && (
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => onCancel(entry.id)}>Cancel</Button>
          )}
        </span>
      </div>
      <code className="mt-0.5 block font-mono break-all text-muted-foreground">{entry.argv.join(' ')}</code>
      {open && (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap">
          {entry.stderrTruncated ? `…(earlier output dropped)\n${entry.stderr}` : entry.stderr}
        </pre>
      )}
    </li>
  );
}
