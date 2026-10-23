import { useMemo, type UIEvent } from 'react';
import { CrosshairIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chunked } from '@/features/diff/CodeLine';
import { requestJump } from '@/features/graph/jump';
import { formatTime } from '@/features/graph/time';
import '@/features/graph/graph.css';
import { cn } from '@/lib/utils';
import type { Tab } from '@/state/tabs';
import { authorClasses } from './authorColors';
import { CommitFileView } from './CommitFileView';
import { closeHistoryPanel, showFileView } from './open';
import { loadMoreBlame, loadMoreHistory, pickCommit, useFileHistory, type FileHistoryState } from './state';

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

function BlameView({ tab, s }: { tab: Tab; s: FileHistoryState }) {
  const b = s.blame;
  const colours = useMemo(() => authorClasses(b.lines.map((l) => b.commits[l.oid]?.author ?? '')), [b.lines, b.commits]);
  const rows = useMemo(() => b.lines.map((l, i) => ({ id: String(l.n), line: l, first: i === 0 || b.lines[i - 1].oid !== l.oid })), [b.lines]);
  const more = b.total === null || b.lines.length < b.total;
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (more && el.scrollTop + el.clientHeight >= el.scrollHeight - 400) void loadMoreBlame(tab);
  };
  if (b.error) return <p role="alert" className="p-3 text-sm text-destructive">{b.code === 'BINARY_FILE' ? 'A binary file has no blame.' : b.error}</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5" onScroll={onScroll} role="table" aria-label="Blame">
      <Chunked
        rows={rows}
        render={({ id, line, first }) => {
          const c = b.commits[line.oid];
          const author = c?.author ?? '';
          return (
            <div key={id} role="row" className={cn('flex', first && 'border-t')} data-blame-line={line.n}>
              <span role="cell" className={cn('flex w-80 shrink-0 items-center gap-1.5 overflow-hidden px-2', colours.get(author))}>
                <span aria-hidden className="h-4 w-1 shrink-0 rounded-sm bg-(--lane)" />
                {first && (
                  <button type="button" className="flex min-w-0 gap-1.5 truncate text-left hover:underline" title={c?.summary}
                    aria-label={`${abbrev(line.oid)} ${author}: show in history`}
                    onClick={() => { pickCommit(tab, { oid: line.oid, path: c?.filename || s.path, oldPath: null }); showFileView(tab, 'history'); }}>
                    <span className="text-muted-foreground">{abbrev(line.oid)}</span>
                    <span className="truncate font-sans">{author}</span>
                    <span className="shrink-0 font-sans text-muted-foreground">{c ? formatTime(c.time) : ''}</span>
                  </button>
                )}
              </span>
              <span role="cell" className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none">{line.n}</span>
              <span role="cell" className="whitespace-pre pr-4">{line.text}</span>
            </div>
          );
        }}
      />
      <div className="px-2 py-1 font-sans text-muted-foreground">
        {b.loading ? 'Loading…' : more ? <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => void loadMoreBlame(tab)}>Load more lines</Button> : `${b.total ?? 0} lines`}
      </div>
    </div>
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
        <span className="text-xs text-muted-foreground">at {abbrev(s.rev)}</span>
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
