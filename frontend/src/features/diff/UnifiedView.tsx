import { cn } from '@/lib/utils';
import { CellCode, Chunked, HunkHeader, LineNo, LineToggle, MARKER, NoToggle, ROW_BG, type Marks, type StagingView } from './CodeLine';
import type { ViewRow } from './viewRows';

/** Hunk and Inline modes: one column, old and new line numbers, a +/− marker; with `staging`, a gutter toggle per change. */
export function UnifiedView({ rows, marks, wrap, staging }: { rows: ViewRow[]; marks: Marks; wrap: boolean; staging?: StagingView }) {
  return (
    <div className={cn('font-mono text-xs leading-5', !wrap && 'w-max min-w-full')} data-view="unified">
      <Chunked
        rows={rows}
        render={(r) => {
          if (r.type === 'hunk') return <HunkHeader key={r.id} header={r.header} actions={staging?.hunkActions?.(r.hunk)} />;
          if (r.type !== 'unified') return null;
          return (
            <div key={r.id} className={cn('flex', ROW_BG[r.cell.kind])} data-row={r.cell.kind} data-change-index={r.change ?? undefined}>
              {staging && (r.cell.kind === 'context' ? <NoToggle /> : <LineToggle cell={r.cell} staging={staging} />)}
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
