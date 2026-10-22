import { cn } from '@/lib/utils';
import { CellCode, Chunked, HunkHeader, LineNo, MARKER, ROW_BG, type Marks } from './CodeLine';
import type { Cell, ViewRow } from './viewRows';

function Half({ cell, marks, wrap, side }: { cell: Cell | null; marks: Marks; wrap: boolean; side: 'old' | 'new' }) {
  if (!cell) return <div className="flex min-w-0 bg-muted/40" data-side={side} data-empty="" />;
  return (
    <div className={cn('flex min-w-0', ROW_BG[cell.kind], side === 'new' && 'border-l')} data-side={side}>
      <LineNo no={cell.no} />
      <span className="w-4 shrink-0 text-center select-none" aria-hidden>{MARKER[cell.kind]}</span>
      <CellCode cell={cell} marks={marks} wrap={wrap} className={wrap ? undefined : 'overflow-hidden'} />
    </div>
  );
}

/** Split mode: the old side beside the new, each with its own line numbers. */
export function SplitView({ rows, marks, wrap }: { rows: ViewRow[]; marks: Marks; wrap: boolean }) {
  return (
    <div className="font-mono text-xs leading-5" data-view="split">
      <Chunked
        rows={rows}
        render={(r) => {
          if (r.type === 'hunk') return <HunkHeader key={r.id} header={r.header} />;
          if (r.type !== 'split') return null;
          return (
            <div key={r.id} className="grid grid-cols-2" data-change-index={r.change ?? undefined}>
              <Half cell={r.left} marks={marks} wrap={wrap} side="old" />
              <Half cell={r.right} marks={marks} wrap={wrap} side="new" />
            </div>
          );
        }}
      />
    </div>
  );
}
