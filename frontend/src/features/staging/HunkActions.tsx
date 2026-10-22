import { Button } from '@/components/ui/button';

/** A hunk header's buttons (Hunk mode): Stage hunk + Discard hunk… on an unstaged diff, Unstage hunk on a staged one. */
export function HunkActions({ section, busy, onAction }: { section: 'unstaged' | 'staged'; busy: boolean; onAction: (a: 'stage' | 'unstage' | 'discard') => void }) {
  const b = (label: string, a: 'stage' | 'unstage' | 'discard') => (
    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs" disabled={busy} onClick={() => onAction(a)}>{label}</Button>
  );
  return section === 'unstaged' ? <span className="flex shrink-0 gap-1">{b('Discard hunk…', 'discard')}{b('Stage hunk', 'stage')}</span> : <span className="flex shrink-0">{b('Unstage hunk', 'unstage')}</span>;
}
