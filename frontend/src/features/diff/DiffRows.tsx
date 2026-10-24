import type { Marks, StagingView } from './CodeLine';
import { FileContentView } from './FileContentView';
import { SplitView } from './SplitView';
import { UnifiedView } from './UnifiedView';
import type { Layout, ViewRow } from './viewRows';

/** The view for `layout`'s rows: File view, Split, or the one-column diff. */
export function DiffRows({ rows, layout, marks, wrap, staging }: { rows: ViewRow[]; layout: Layout; marks: Marks; wrap: boolean; staging?: StagingView }) {
  if (layout === 'file') return <FileContentView rows={rows} marks={marks} wrap={wrap} />;
  if (layout === 'split') return <SplitView rows={rows} marks={marks} wrap={wrap} staging={staging} />;
  return <UnifiedView rows={rows} marks={marks} wrap={wrap} staging={staging} />;
}
