import { ArrowLeftIcon, CrosshairIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestJump } from '@/features/graph/jump';
import { formatTime } from '@/features/graph/time';
import '@/features/graph/graph.css';
import { cn } from '@/lib/utils';
import type { Tab } from '@/state/tabs';
import { BlameView } from './BlameView';
import { CommitFileView } from './CommitFileView';
import { blameBack, closeHistoryPanel, showFileView } from './open';
import { loadMoreHistory, pickCommit, useFileHistory, type FileHistoryState } from './state';

// A file's history (its commits across renames, each opening its change in the viewer) and its blame (who last
// changed each line, the author's colour at each run's first line). Every value is rendered as text.

const abbrev = (oid: string) => oid.slice(0, 7);

function HistoryList({ tab, s }: { tab: Tab; s: FileHistoryState }) {
  const h = s.history;
  return (
    <div className="flex min-h-0 flex-col md:w-96 md:shrink-0 md:border-r">
      <ul role="listbox" aria-label="File history" className="min-h-0 flex-1 overflow-y-auto">
        {h.items.map((c) => (
          <li
            key={c.oid}
            role="option"
            aria-selected={s.picked?.oid === c.oid}
            tabIndex={0}
            className={cn('cursor-default border-b px-3 py-1.5 text-sm outline-none hover:bg-accent/50 focus-visible:bg-accent', s.picked?.oid === c.oid && 'bg-accent')}
            onClick={() => pickCommit(tab, { oid: c.oid, path: c.path, oldPath: c.oldPath })}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-muted-foreground">{abbrev(c.oid)}</span>
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
            </div>
            <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>{c.author}</span>
              <span>{formatTime(c.time)}</span>
              {c.oldPath && <span data-renamed="">renamed from <span className="font-mono">{c.oldPath}</span></span>}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
        {h.loading && <span>Loading…</span>}
        {h.error && <span role="alert" className="text-destructive">{h.error}</span>}
        {!h.loading && h.next !== null && h.items.length > 0 && <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => void loadMoreHistory(tab)}>Load more</Button>}
        {h.truncated && <span>History stops here (the walk's limit)</span>}
        {!h.loading && h.next === null && !h.truncated && !h.error && <span>{h.items.length} {h.items.length === 1 ? 'commit' : 'commits'}</span>}
      </div>
    </div>
  );
}

/** The drill's path of revisions: one crumb per frame (the file's name only where it changes), and Back to the one before. */
function BlameCrumbs({ tab, s }: { tab: Tab; s: FileHistoryState }) {
  const stack = s.blameStack;
  return (
    <>
      {stack.length > 1 && (
        <Button variant="ghost" size="icon-sm" aria-label={`Back to ${abbrev(stack[stack.length - 2].rev)}`} onClick={() => blameBack(tab, stack.length - 2)}><ArrowLeftIcon /></Button>
      )}
      <nav aria-label="Blame revisions" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {stack.map((f, i) => {
          const label = `${abbrev(f.rev)}${i === 0 || f.path !== stack[i - 1].path ? ` ${f.path}` : ''}`;
          const last = i === stack.length - 1;
          return (
            <span key={f.id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>←</span>}
              {last
                ? <span aria-current="page" className="font-mono text-foreground">{label}</span>
                : <button type="button" className="font-mono hover:underline" onClick={() => blameBack(tab, i)}>{label}</button>}
            </span>
          );
        })}
      </nav>
    </>
  );
}

export function HistoryPanel({ tab }: { tab: Tab | null }) {
  if (!tab) return null;
  return <HistoryPanelFor tab={tab} />;
}

function HistoryPanelFor({ tab }: { tab: Tab }) {
  const s = useFileHistory(tab);
  if (!s) return <p className="p-4 text-sm text-muted-foreground">No file history open.</p>;
  return (
    <section aria-label="File history panel" className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <h2 className="min-w-0 truncate font-mono text-sm font-semibold" title={s.path}>{s.path}</h2>
        {s.view === 'blame' ? <BlameCrumbs tab={tab} s={s} /> : <span className="text-xs text-muted-foreground">at {abbrev(s.rev)}</span>}
        <div className="flex rounded-md border p-0.5" role="group" aria-label="History or blame">
          {(['history', 'blame'] as const).map((v) => (
            <Button key={v} variant={s.view === v ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={s.view === v} onClick={() => showFileView(tab, v)}>
              {v === 'history' ? 'History' : 'Blame'}
            </Button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1">
          {s.picked && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { const oid = s.picked!.oid; closeHistoryPanel(tab); requestJump(tab, oid); }}>
              <CrosshairIcon /> Show in graph
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close file history" onClick={() => closeHistoryPanel(tab)}><XIcon /></Button>
        </span>
      </header>
      {s.view === 'blame' ? <BlameView tab={tab} s={s} /> : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <HistoryList tab={tab} s={s} />
          {s.picked ? <CommitFileView tab={tab} picked={s.picked} /> : <p className="p-3 text-sm text-muted-foreground">{s.history.loading ? 'Loading…' : 'No commits touch this file.'}</p>}
        </div>
      )}
    </section>
  );
}
