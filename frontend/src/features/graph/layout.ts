import type { Edge, Lane, LayoutInput, LayoutRow, LayoutState, Span } from './types';

// The lane layout (docs/graph.md → Lane layout). Rows arrive top to bottom, children before parents; each row is
// placed from the lanes left open by the rows above it, so a page laid out after the previous one continues it exactly.
//
// Memory and drawing are bounded by the drawn width, not by the number of refs: a row stores only the edges of its own
// node, clamped to the first `cap` lanes plus one overflow gutter; the lines that merely pass through a row are not
// stored per row but as one Span per lane run, and drawn for the visible rows only (passThroughs).

/** Lane colours: `.lane-0` … in graph.css, one per index below this. */
export const LANE_COLOURS = 8;
/**
 * Lanes drawn; every lane from here on is drawn in one overflow gutter, at index LANE_CAP. The lanes and the gutter
 * fit the graph column's widest setting (COLUMNS.graph.max; a test pins it).
 */
export const LANE_CAP = 35;

/** Where lane `i` is drawn: itself, or the gutter. */
export const drawnLane = (i: number, cap = LANE_CAP): number => Math.min(i, cap);

/**
 * A fresh layout. `pinnedTips` reserve lanes 0…k-1, in order, for those commits and their first-parent chains.
 * `cap` (default LANE_CAP) is the drawn width; tests lay out uncapped with Infinity.
 */
export function createLayout({ pinnedTips = [], cap = LANE_CAP }: { pinnedTips?: string[]; cap?: number } = {}): LayoutState {
  const reserved = [...new Set(pinnedTips.filter(Boolean))];
  return { lanes: reserved.map(() => null), nextColor: 0, reserved, width: reserved.length, rows: 0, spans: [], cap };
}

/** Lays out `inputs` after the rows `state` has seen. Pure: returns a new state. */
export function extendLayout(prev: LayoutState, inputs: LayoutInput[]): { state: LayoutState; rows: LayoutRow[] } {
  const lanes = [...prev.lanes];
  const reserved = [...prev.reserved];
  const spans = [...prev.spans];
  const { cap } = prev;
  let { nextColor, width, rows: row } = prev;
  const pending = (i: number) => i < reserved.length && reserved[i] !== '';
  const free = () => {
    let i = 0;
    while (lanes[i] || pending(i)) i++;
    return i;
  };
  const newColor = () => nextColor++ % LANE_COLOURS;
  const open = (lane: number, color: number, dashed: boolean): Lane => {
    spans.push({ lane, color, dashed, from: row, to: null });
    return { expect: '', color, dashed, span: spans.length - 1 };
  };
  const out: LayoutRow[] = [];

  for (const { id, parents, dashed } of inputs) {
    const expecting: number[] = [];
    lanes.forEach((l, i) => { if (l?.expect === id) expecting.push(i); });
    const pin = reserved.indexOf(id);
    const col = pin !== -1 ? pin : expecting.length ? expecting[0] : free();
    if (pin !== -1) reserved[pin] = '';
    const color = lanes[col]?.expect === id ? lanes[col]!.color : expecting.length ? lanes[expecting[0]]!.color : newColor();

    // Edges are stored once per drawn shape: every lane past the cap draws as the gutter.
    const keep = (list: Edge[], seen: Set<string>, e: Edge) => {
      if (e.from >= cap && e.to >= cap) return;
      const k = `${drawnLane(e.from, cap)}>${drawnLane(e.to, cap)}`;
      if (seen.has(k)) return;
      seen.add(k);
      list.push(e);
    };
    const into: Edge[] = [];
    const seenIn = new Set<string>();
    for (const i of expecting) {
      const l = lanes[i]!;
      keep(into, seenIn, { from: i, to: col, color: l.color, dashed: l.dashed });
      spans[l.span] = { ...spans[l.span], to: row };
      lanes[i] = null;
    }

    const from: Edge[] = [];
    const seenOut = new Set<string>();
    if (parents.length) {
      if (lanes[col]) throw new Error(`layout: lane ${col} is still open at ${id}`);
      lanes[col] = { ...open(col, color, dashed), expect: parents[0] };
      keep(from, seenOut, { from: col, to: col, color, dashed });
      for (const p of parents.slice(1)) {
        if (p === parents[0]) continue;
        let j = lanes.findIndex((l) => l?.expect === p);
        if (j === -1) {
          j = free();
          lanes[j] = { ...open(j, newColor(), dashed), expect: p };
        }
        keep(from, seenOut, { from: col, to: j, color: lanes[j]!.color, dashed });
      }
    }
    width = Math.max(width, lanes.length, col + 1);
    while (lanes.length > reserved.length && !lanes[lanes.length - 1]) lanes.pop();
    out.push({ col, color, in: into, out: from });
    row++;
  }
  return { state: { lanes, nextColor, reserved, width, rows: row, spans, cap }, rows: out };
}

/** The whole layout of `inputs` in one go: what extendLayout page by page must equal. */
export const layoutAll = (inputs: LayoutInput[], opts?: { pinnedTips?: string[]; cap?: number }) => extendLayout(createLayout(opts), inputs);

/** A line through a whole row: a lane neither ending nor starting at that row's node. */
export interface Through { lane: number; color: number; dashed: boolean }

/**
 * The pass-through lines of rows [start, end), by row: lanes of the first `cap` drawn one by one, every lane past it
 * as a single gutter line (lane `cap`). Spans are in row order of their start, so only those starting before `end`
 * are read.
 */
export function passThroughs(spans: readonly Span[], start: number, end: number, cap = LANE_CAP): Through[][] {
  const rows: Through[][] = Array.from({ length: Math.max(0, end - start) }, () => []);
  const gutter = new Set<number>();
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (spans[m].from < end) lo = m + 1; else hi = m; }
  for (let s = 0; s < lo; s++) {
    const sp = spans[s];
    const a = Math.max(sp.from + 1, start);
    const b = Math.min(sp.to ?? end, end);
    for (let r = a; r < b; r++) {
      if (sp.lane < cap) rows[r - start].push({ lane: sp.lane, color: sp.color, dashed: sp.dashed });
      else if (!gutter.has(r)) {
        gutter.add(r);
        rows[r - start].push({ lane: cap, color: sp.color, dashed: false });
      }
    }
  }
  return rows;
}

/** Every edge of row `r` as the two halves draw them: its node's edges plus the lines passing through. */
export function edgesAt(state: LayoutState, rows: readonly LayoutRow[], r: number): { top: Edge[]; bottom: Edge[] } {
  const through = passThroughs(state.spans, r, r + 1, state.cap)[0].map((t): Edge => ({ from: t.lane, to: t.lane, color: t.color, dashed: t.dashed }));
  return { top: [...rows[r].in, ...through], bottom: [...rows[r].out, ...through] };
}
