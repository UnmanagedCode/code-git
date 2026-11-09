import { useLayoutEffect, useMemo, useRef, type UIEvent } from 'react';
import { EllipsisVerticalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chunked, CodeLine } from '@/features/diff/CodeLine';
import { useTokenizer } from '@/features/diff/highlight/useTokenizer';
import { mergeSegments } from '@/features/diff/segments';
import { formatTime } from '@/features/graph/time';
import '@/features/graph/graph.css';
import { cn } from '@/lib/utils';
import { anchorOf, ContextMenuHost, openContextMenu } from '@/shell/ContextMenuHost';
import { prefsStore } from '@/state/diff';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { BLAME_RUN_CONTEXT, type BlameRunCtx } from './actions';
import type { BlameLine } from './api';
import { authorClasses } from './authorColors';
import { blameSegments } from './blameHighlight';
import { drillBlame } from './open';
import { clearBlameFocus, loadMoreBlame, topFrame, type FileHistoryState } from './state';

// The blame of the shown drill frame: author colours, syntax highlighting, a run's header drilling to the revision
// before it, and the run menu (right-click, or the ⋮) for the secondary actions. Every value is rendered as text.

const HOST = 'blame';
const abbrev = (oid: string) => oid.slice(0, 7);

export function BlameView({ tab, s }: { tab: Tab; s: FileHistoryState }) {
  const frame = topFrame(s);
  const b = frame.blame;
  const prefs = useStore(prefsStore);
  const tokenize = useTokenizer(prefs.syntax);
  const scroller = useRef<HTMLDivElement>(null);
  const colours = useMemo(() => authorClasses(b.lines.map((l) => b.commits[l.oid]?.author ?? '')), [b.lines, b.commits]);
  const rows = useMemo(() => b.lines.map((l, i) => ({ id: String(l.n), line: l, first: i === 0 || b.lines[i - 1].oid !== l.oid })), [b.lines]);
  const segs = useMemo(() => blameSegments(b.lines, b.total, frame.path, tokenize), [b.lines, b.total, frame.path, tokenize]);
  const more = b.total === null || b.lines.length < b.total;
  const complete = !more;
  // Bring the focus line into view once it is loaded (the file's end stands in for a line the file no longer has).
  useLayoutEffect(() => {
    if (frame.focus === null) return;
    const root = scroller.current;
    const target = root?.querySelector(`[data-blame-line="${frame.focus}"]`) ?? (complete ? [...(root?.querySelectorAll('[data-blame-line]') ?? [])].at(-1) : null);
    if (!target && !complete) return;
    target?.scrollIntoView({ block: 'center' });
    clearBlameFocus(tab, frame.id);
  }, [frame.id, frame.focus, b.lines.length, complete]);
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (more && el.scrollTop + el.clientHeight >= el.scrollHeight - 400) void loadMoreBlame(tab);
  };
  if (b.error) return <p role="alert" className="p-3 text-sm text-destructive">{b.code === 'BINARY_FILE' ? 'A binary file has no blame.' : b.error}</p>;
  const ctxOf = (line: BlameLine): BlameRunCtx => ({ tab, line, commit: b.commits[line.oid], path: frame.path });
  return (
    <>
    <div key={frame.id} ref={scroller} className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5" onScroll={onScroll} role="table" aria-label="Blame">
      <Chunked
        rows={rows}
        render={({ id, line, first }) => {
          const c = b.commits[line.oid];
          const author = c?.author ?? '';
          const sha = abbrev(line.oid);
          const added = !c?.previous;
          const lineSegs = segs?.[line.n - 1];
          return (
            <div
              key={id} role="row" className={cn('flex', first && 'border-t')} data-blame-line={line.n}
              onContextMenu={(e) => { if (openContextMenu({ host: HOST, context: BLAME_RUN_CONTEXT, ctx: ctxOf(line), at: { x: e.clientX, y: e.clientY } })) e.preventDefault(); }}
            >
              <span role="cell" className={cn('flex w-80 shrink-0 items-center gap-1.5 overflow-hidden px-2', colours.get(author))}>
                <span aria-hidden className="h-4 w-1 shrink-0 rounded-sm bg-(--lane)" />
                {first && (
                  <>
                    <button
                      type="button" className={cn('flex min-w-0 gap-1.5 truncate text-left hover:underline', added && 'cursor-default')} title={c?.summary}
                      aria-disabled={added || undefined}
                      aria-label={added ? `${sha} ${author}: no earlier version (this commit added the file)` : `${sha} ${author}: blame previous revision`}
                      onClick={() => { if (!added) drillBlame(tab, line); }}
                    >
                      <span className="text-muted-foreground">{sha}</span>
                      <span className="truncate font-sans">{author}</span>
                      <span className="shrink-0 font-sans text-muted-foreground">{c ? formatTime(c.time) : ''}</span>
                      {added && <span className="shrink-0 font-sans text-muted-foreground" data-added="">added</span>}
                    </button>
                    <Button
                      variant="ghost" size="icon-sm" className="ml-auto size-5 shrink-0" aria-label={`Actions for ${sha}`}
                      onClick={(e) => openContextMenu({ host: HOST, context: BLAME_RUN_CONTEXT, ctx: ctxOf(line), at: anchorOf(e.currentTarget) })}
                    >
                      <EllipsisVerticalIcon />
                    </Button>
                  </>
                )}
              </span>
              <span role="cell" className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none">{line.n}</span>
              <span role="cell" className="whitespace-pre pr-4"><CodeLine segs={mergeSegments(lineSegs ?? [{ text: line.text, cls: null }], [], [])} /></span>
            </div>
          );
        }}
      />
      <div className="px-2 py-1 font-sans text-muted-foreground">
        {b.loading ? 'Loading…' : more ? <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => void loadMoreBlame(tab)}>Load more lines</Button> : `${b.total ?? 0} lines`}
      </div>
    </div>
    <ContextMenuHost host={HOST} />
    </>
  );
}
