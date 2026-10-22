import { cn } from '@/lib/utils';
import { CellCode, Chunked, LineNo, type Marks } from './CodeLine';
import type { ViewRow } from './viewRows';

/** File view: the file's content with line numbers, no +/− markers. */
export function FileContentView({ rows, marks, wrap }: { rows: ViewRow[]; marks: Marks; wrap: boolean }) {
  return (
    <div className={cn('font-mono text-xs leading-5', !wrap && 'w-max min-w-full')} data-view="file">
      <Chunked
        rows={rows}
        render={(r) => (r.type !== 'file' ? null : (
          <div key={r.id} className="flex" data-row="file">
            <LineNo no={r.cell.no} />
            <CellCode cell={r.cell} marks={marks} wrap={wrap} className="pl-2" />
          </div>
        ))}
      />
    </div>
  );
}
