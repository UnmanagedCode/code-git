import type { Edge, Lane, LayoutInput, LayoutRow, LayoutState } from './types';

// The lane layout (docs/graph.md → Lane layout). Rows arrive top to bottom, children before parents; each row is
// placed from the lanes left open by the rows above it, so a page laid out after the previous one continues it exactly.

/** Lane colours: `.lane-0` … in graph.css, one per index below this. */
export const LANE_COLOURS = 8;

/** A fresh layout. `pinnedTips` reserve lanes 0…k-1, in order, for those commits and their first-parent chains. */
export function createLayout({ pinnedTips = [] }: { pinnedTips?: string[] } = {}): LayoutState {
  const reserved = [...new Set(pinnedTips.filter(Boolean))];
  return { lanes: reserved.map(() => null), nextColor: 0, reserved, width: reserved.length };
}

/** Lays out `inputs` after the rows `state` has seen. Pure: returns a new state. */
export function extendLayout(prev: LayoutState, inputs: LayoutInput[]): { state: LayoutState; rows: LayoutRow[] } {
  const lanes = [...prev.lanes];
  const reserved = [...prev.reserved];
  let { nextColor, width } = prev;
  const pending = (i: number) => i < reserved.length && reserved[i] !== '';
  const free = () => {
    let i = 0;
    while (lanes[i] || pending(i)) i++;
    return i;
  };
  const newColor = () => nextColor++ % LANE_COLOURS;
  const rows: LayoutRow[] = [];

  for (const { id, parents, dashed } of inputs) {
    const expecting: number[] = [];
    lanes.forEach((l, i) => { if (l?.expect === id) expecting.push(i); });
    const pin = reserved.indexOf(id);
    const col = pin !== -1 ? pin : expecting.length ? expecting[0] : free();
    if (pin !== -1) reserved[pin] = '';
    const color = lanes[col]?.expect === id ? lanes[col]!.color : expecting.length ? lanes[expecting[0]]!.color : newColor();

    const top: Edge[] = [];
    lanes.forEach((l, i) => {
      if (l) top.push({ from: i, to: l.expect === id ? col : i, color: l.color, dashed: l.dashed });
    });
    for (const i of expecting) lanes[i] = null;

    const own = new Map<number, Lane>(); // lanes this node feeds, by index
    if (parents.length) {
      if (lanes[col]) throw new Error(`layout: lane ${col} is still open at ${id}`);
      lanes[col] = { expect: parents[0], color, dashed };
      own.set(col, lanes[col]!);
      for (const p of parents.slice(1)) {
        if (p === parents[0]) continue;
        let j = lanes.findIndex((l) => l?.expect === p);
        const reused = j !== -1;
        if (!reused) {
          j = free();
          lanes[j] = { expect: p, color: newColor(), dashed };
        }
        own.set(j, reused ? { ...lanes[j]!, dashed } : lanes[j]!);
      }
    }

    const bottom: Edge[] = [];
    lanes.forEach((l, i) => {
      if (!l) return;
      const fed = own.get(i);
      // A lane this node opened starts at the node; a reused one also passes through from above.
      if (fed) bottom.push({ from: col, to: i, color: fed.color, dashed: fed.dashed });
      if (!fed || (i !== col && top.some((e) => e.to === i && e.from === i))) bottom.push({ from: i, to: i, color: l.color, dashed: l.dashed });
    });
    width = Math.max(width, lanes.length, col + 1);
    while (lanes.length > reserved.length && !lanes[lanes.length - 1]) lanes.pop();
    rows.push({ col, color, top, bottom });
  }
  return { state: { lanes, nextColor, reserved, width }, rows };
}

/** The whole layout of `inputs` in one go: what extendLayout page by page must equal. */
export const layoutAll = (inputs: LayoutInput[], opts?: { pinnedTips?: string[] }) => extendLayout(createLayout(opts), inputs);
