import { Button } from '@/components/ui/button';

/** The selected lines' actions, above the diff body: Stage / Discard… (unstaged) or Unstage (staged), and Clear. */
export function SelectionBar({ count, section, busy, onAction, onClear }: {
  count: number; section: 'unstaged' | 'staged'; busy: boolean; onAction: (a: 'stage' | 'unstage' | 'discard') => void; onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-accent/40 px-3 py-1 text-xs" role="toolbar" aria-label="Line selection">
      <span className="font-medium">{count} {count === 1 ? 'line' : 'lines'} selected</span>
      <div className="ml-auto flex gap-1">
        {section === 'unstaged' ? (
          <>
            <Button size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={() => onAction('stage')}>Stage lines</Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={() => onAction('discard')}>Discard lines…</Button>
          </>
        ) : (
          <Button size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={() => onAction('unstage')}>Unstage lines</Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}
