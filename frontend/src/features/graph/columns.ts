// The graph's column catalogue: the single source for ids, labels, default widths and resize bounds (px).

export type ColumnId = 'refs' | 'graph' | 'message' | 'author' | 'date' | 'sha' | 'changes';
export type OptionalColumnId = Extract<ColumnId, 'author' | 'date' | 'sha' | 'changes'>;

export interface ColumnDef { label: string; optional: boolean; resizable: boolean; width: number; min: number; max: number }

export const COLUMNS: Record<ColumnId, ColumnDef> = {
  refs: { label: 'Branch / Tag', optional: false, resizable: true, width: 180, min: 80, max: 480 },
  graph: { label: 'Graph', optional: false, resizable: true, width: 120, min: 40, max: 600 },
  // Takes the remaining width.
  message: { label: 'Commit message', optional: false, resizable: false, width: 240, min: 120, max: 240 },
  author: { label: 'Author', optional: true, resizable: true, width: 160, min: 80, max: 400 },
  date: { label: 'Date', optional: true, resizable: true, width: 170, min: 100, max: 300 },
  sha: { label: 'SHA', optional: true, resizable: true, width: 80, min: 60, max: 200 },
  changes: { label: 'Changes', optional: true, resizable: true, width: 120, min: 80, max: 300 },
};

export const COLUMN_IDS = Object.keys(COLUMNS) as ColumnId[];
export const OPTIONAL_COLUMNS = COLUMN_IDS.filter((id) => COLUMNS[id].optional) as OptionalColumnId[];
export const isColumnId = (v: unknown): v is ColumnId => typeof v === 'string' && Object.hasOwn(COLUMNS, v);

/** `w` within the column's resize bounds. */
export const clampWidth = (id: ColumnId, w: number): number => Math.min(COLUMNS[id].max, Math.max(COLUMNS[id].min, Math.round(w)));

/** Each column's width class: resizable widths come from `--col-<id>` (set with setCssPx), the message takes the rest. */
export const CELL_CLASS: Record<ColumnId, string> = {
  refs: 'w-(--col-refs)', graph: 'w-(--col-graph)', message: 'min-w-30 flex-1', author: 'w-(--col-author)',
  date: 'w-(--col-date)', sha: 'w-(--col-sha)', changes: 'w-(--col-changes)',
};
