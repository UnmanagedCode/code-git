import type { FileDiff, Hunk } from './api';
import { highlightLines, type Seg, type Tokenize } from './highlight';
import { displayText, isDeletion, sideLines, splitRows, unifiedRows, type LineRef } from './model';
import type { Range } from './wordDiff';

// What the views render: rows of cells, each cell one displayed line with its syntax segments and word emphasis.

export interface Cell {
  id: string; kind: 'context' | 'add' | 'del'; no: number | null; text: string; segs: Seg[]; emphasis: Range[];
  /** The line's address in the FileDiff (hunk index, line index): what line staging selects. */
  hunk: number; index: number;
}

export type ViewRow =
  | { type: 'hunk'; id: string; hunk: number; header: string }
  | { type: 'unified'; id: string; cell: Cell; oldNo: number | null; newNo: number | null; change: number | null }
  | { type: 'split'; id: string; left: Cell | null; right: Cell | null; change: number | null }
  | { type: 'file'; id: string; cell: Cell };

export type Layout = 'hunk' | 'inline' | 'split' | 'file';

export interface SideSegs { old: Seg[][]; new: Seg[][] }

/** Both file sides highlighted, each as one text across its hunks (so each side is capped as a whole). */
export function highlightSides(hunks: Hunk[], lang: string | null, tokenize: Tokenize | null): SideSegs {
  const side = (s: 'old' | 'new') => highlightLines(hunks.flatMap((h) => sideLines(h, s)).map(displayText).join('\n'), lang, tokenize);
  return { old: side('old'), new: side('new') };
}

/** Where each line sits in each side's flat line list. */
function sideIndexes(hunks: Hunk[]): Map<string, { old?: number; new?: number }> {
  const out = new Map<string, { old?: number; new?: number }>();
  let o = 0;
  let n = 0;
  hunks.forEach((h, hi) => h.lines.forEach((l, li) => {
    out.set(`${hi}:${li}`, l.kind === 'context' ? { old: o++, new: n++ } : l.kind === 'del' ? { old: o++ } : { new: n++ });
  }));
  return out;
}

export function buildRows(fd: FileDiff, layout: Layout, segs: SideSegs | null): ViewRow[] {
  const at = sideIndexes(fd.hunks);
  const cell = (ref: LineRef, side: 'old' | 'new', prefix: string): Cell => {
    const text = displayText(ref.line);
    const i = at.get(`${ref.hunk}:${ref.index}`)?.[side];
    return {
      id: `${prefix}:${ref.hunk}:${ref.index}`, kind: ref.line.kind, no: side === 'old' ? ref.line.oldNo : ref.line.newNo, text,
      segs: (i !== undefined && segs?.[side][i]) || [{ text, cls: null }], emphasis: ref.emphasis ?? [], hunk: ref.hunk, index: ref.index,
    };
  };
  const sideOf = (ref: LineRef) => (ref.line.kind === 'del' ? 'old' : 'new');
  if (layout === 'file') {
    const side = isDeletion(fd) ? 'old' : 'new';
    return fd.hunks.flatMap((h, hi) => h.lines.map((line, index) => ({ line, hunk: hi, index, emphasis: null }))
      .filter((r) => r.line.kind === 'context' || r.line.kind === (side === 'old' ? 'del' : 'add'))
      .map((r) => {
        const c = cell(r, side, 'f');
        return { type: 'file' as const, id: c.id, cell: { ...c, kind: 'context' as const, emphasis: [] } };
      }));
  }
  const headers = layout === 'hunk';
  if (layout === 'split') {
    return splitRows(fd.hunks, headers).map((r, i) => (r.type === 'hunk'
      ? { type: 'hunk', id: `h${r.hunk}`, hunk: r.hunk, header: r.header }
      : { type: 'split', id: `s${i}`, left: r.old && cell(r.old, 'old', 'l'), right: r.new && cell(r.new, 'new', 'r'), change: r.change }));
  }
  return unifiedRows(fd.hunks, headers).map((r) => (r.type === 'hunk'
    ? { type: 'hunk', id: `h${r.hunk}`, hunk: r.hunk, header: r.header }
    : { type: 'unified', id: `u${r.ref.hunk}:${r.ref.index}`, cell: cell(r.ref, sideOf(r.ref), 'u'), oldNo: r.ref.line.oldNo, newNo: r.ref.line.newNo, change: r.change }));
}

export interface Match { cellId: string; start: number; end: number }

/** Case-insensitive plain-substring matches over the displayed cells, in row order (left before right). */
export function findMatches(rows: ViewRow[], query: string): Match[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const out: Match[] = [];
  const scan = (c: Cell | null) => {
    if (!c) return;
    const t = c.text.toLowerCase();
    for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) out.push({ cellId: c.id, start: i, end: i + q.length });
  };
  for (const r of rows) {
    if (r.type === 'unified' || r.type === 'file') scan(r.cell);
    else if (r.type === 'split') { scan(r.left); scan(r.right); }
  }
  return out;
}
