import { Button } from '@/components/ui/button';

/** A hunk header's buttons (Hunk mode): Stash hunk… + Discard hunk… + Stage hunk on an unstaged diff, Unstage hunk on a staged one. */
export function HunkActions({ section, busy, onAction, onStash }: {
  section: 'unstaged' | 'staged'; busy: boolean; onAction: (a: 'stage' | 'unstage' | 'discard') => void; onStash?: () => void;
}) {
  const b = (label: string, a: 'stage' | 'unstage' | 'discard') => (
    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs" disabled={busy} onClick={() => onAction(a)}>{label}</Button>
  );
  if (section === 'staged') return <span className="flex shrink-0">{b('Unstage hunk', 'unstage')}</span>;
  return (
    <span className="flex shrink-0 gap-1">
      {onStash && <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs" disabled={busy} onClick={onStash}>Stash hunk…</Button>}
      {b('Discard hunk…', 'discard')}{b('Stage hunk', 'stage')}
    </span>
  );
}
