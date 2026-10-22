import { cn } from '@/lib/utils';
import { CellCode, Chunked, HunkHeader, LineNo, MARKER, ROW_BG, type Marks } from './CodeLine';
import type { ViewRow } from './viewRows';

/** Hunk and Inline modes: one column, old and new line numbers, a +/− marker. */
export function UnifiedView({ rows, marks, wrap }: { rows: ViewRow[]; marks: Marks; wrap: boolean }) {
  return (
    <div className={cn('font-mono text-xs leading-5', !wrap && 'w-max min-w-full')} data-view="unified">
      <Chunked
        rows={rows}
        render={(r) => {
          if (r.type === 'hunk') return <HunkHeader key={r.id} header={r.header} />;
          if (r.type !== 'unified') return null;
          return (
            <div key={r.id} className={cn('flex', ROW_BG[r.cell.kind])} data-row={r.cell.kind} data-change-index={r.change ?? undefined}>
              <LineNo no={r.oldNo} />
              <LineNo no={r.newNo} />
              <span className="w-4 shrink-0 text-center select-none" aria-hidden>{MARKER[r.cell.kind]}</span>
              <CellCode cell={r.cell} marks={marks} wrap={wrap} />
            </div>
          );
        }}
      />
    </div>
  );
}
