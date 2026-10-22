import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { mergeSegments, type MarkedSeg } from './segments';
import type { Cell } from './viewRows';
import type { Range } from './wordDiff';

/** A line's segments as spans; the text is only ever React text. */
export function CodeLine({ segs, emphasisClass }: { segs: MarkedSeg[]; emphasisClass?: string }) {
  return (
    <>
      {segs.map((s, i) => (
        <span
          key={i}
          className={cn(s.cls, s.em && emphasisClass, s.match && 'rounded-sm bg-warning/40', s.current && 'ring-2 ring-warning')}
          data-token={s.cls ? '' : undefined}
          data-emphasis={s.em ? '' : undefined}
          data-match={s.match ? '' : undefined}
          data-match-current={s.current ? '' : undefined}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}

export interface Marks {
  /** Search matches per cell id. */
  byCell: ReadonlyMap<string, Range[]>;
  current: { cellId: string; range: Range } | null;
}

const EMPHASIS: Record<string, string | undefined> = { add: 'bg-success/35', del: 'bg-destructive/35' };
export const ROW_BG: Record<string, string | undefined> = { add: 'bg-success/15', del: 'bg-destructive/15' };
export const MARKER: Record<string, string> = { add: '+', del: '−', context: ' ' };

/** One cell's code: syntax, word emphasis and search marks merged. */
export function CellCode({ cell, marks, wrap, className }: { cell: Cell; marks: Marks; wrap: boolean; className?: string }) {
  const current = marks.current?.cellId === cell.id ? marks.current.range : undefined;
  const segs = mergeSegments(cell.segs, cell.emphasis, marks.byCell.get(cell.id) ?? [], current);
  return (
    <span className={cn('min-w-0 flex-1 pr-4', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre', className)}>
      <CodeLine segs={segs} emphasisClass={EMPHASIS[cell.kind]} />
    </span>
  );
}

export const CHUNK_ROWS = 200;

/** Rows in chunks the browser can skip laying out while off screen. */
export function Chunked<R extends { id: string }>({ rows, render }: { rows: R[]; render: (r: R) => ReactNode }) {
  const chunks: R[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) chunks.push(rows.slice(i, i + CHUNK_ROWS));
  return (
    <>
      {chunks.map((c) => (
        <div key={c[0].id} className="[content-visibility:auto] [contain-intrinsic-block-size:auto_4000px]">
          {c.map(render)}
        </div>
      ))}
    </>
  );
}

export const LineNo = ({ no }: { no: number | null }) => (
  <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground select-none">{no ?? ''}</span>
);

export const HunkHeader = ({ header }: { header: string }) => (
  <div className="bg-info/10 px-2 text-info select-none" data-hunk-header="">{header}</div>
);
