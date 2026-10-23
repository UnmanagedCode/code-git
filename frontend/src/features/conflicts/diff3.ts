// A three-way line merge for the conflict tool (docs/merge.md → The conflict tool). Pure. A line keeps its "\n" (a "\r"
// stays in its text), so a missing final newline is a difference like any other and the output is the lines joined.
// It can differ from git's own merge: no merge drivers, no -X options, no rename handling.

/** Lines per side above which the tool does not merge line by line (null: take a side instead). */
export const DIFF3_MAX_LINES = 20_000;
/** Edit distance (inserted + deleted lines) above which a two-way diff gives up (null): bounds time and memory. */
export const DIFF_MAX_EDITS = 2_000;

/** `text` as lines, each with its "\n" (the last one without, when the text does not end with one). */
export function splitLines(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const end = nl === -1 ? text.length : nl + 1;
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/**
 * Myers' O(ND) diff of `a` and `b` → the matched index pairs [i, j] (a common subsequence, increasing), or null past
 * DIFF_MAX_EDITS. The common prefix and suffix are matched first.
 */
export function matchLines(a: readonly string[], b: readonly string[]): [number, number][] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length;
  const m = B.length;
  const mid: [number, number][] = [];
  if (n && m) {
    const max = Math.min(n + m, DIFF_MAX_EDITS);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= max && found === -1; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && A[x] === B[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) { found = d; break; }
      }
    }
    if (found === -1) return null;
    // Walk the trace back from (n, m): each step's snake (its diagonal, matching moves) back to the edit before it.
    let x = n;
    let y = m;
    for (let d = found; d > 0; d--) {
      const vd = trace[d];
      const at = (k: number) => vd[k + d + 1];
      const k = x - y;
      const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
      const prevX = at(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { x--; y--; mid.push([x, y]); }
      x = prevX;
      y = prevY;
    }
    while (x > 0 && y > 0) { x--; y--; mid.push([x, y]); }
    mid.reverse();
  }
  const out: [number, number][] = [];
  for (let i = 0; i < pre; i++) out.push([i, i]);
  for (const [i, j] of mid) out.push([i + pre, j + pre]);
  for (let i = suf; i > 0; i--) out.push([a.length - i, b.length - i]);
  return out;
}

export interface Range { start: number; end: number }
export type Region =
  | { kind: 'stable'; lines: string[] }
  | { kind: 'conflict'; base: string[]; ours: string[]; theirs: string[]; oursRange: Range; theirsRange: Range };

const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((l, i) => l === y[i]);

/**
 * diff3 over `base`, `ours` and `theirs` (texts) → regions: `stable` lines (unchanged, or changed on one side only, or
 * the same on both) and `conflict` regions (changed differently on both), with each conflict's line range in ours and in
 * theirs. null past DIFF3_MAX_LINES or DIFF_MAX_EDITS.
 */
export function merge3(base: string, ours: string, theirs: string): Region[] | null {
  const O = splitLines(base);
  const A = splitLines(ours);
  const B = splitLines(theirs);
  if (Math.max(O.length, A.length, B.length) > DIFF3_MAX_LINES) return null;
  const ma = matchLines(O, A);
  const mb = matchLines(O, B);
  if (!ma || !mb) return null;
  const toA = new Map(ma);
  const toB = new Map(mb);
  const regions: Region[] = [];
  const stable = (lines: string[]) => {
    if (!lines.length) return;
    const last = regions.at(-1);
    if (last?.kind === 'stable') last.lines.push(...lines); else regions.push({ kind: 'stable', lines: [...lines] });
  };
  const chunk = (o: [number, number], a: [number, number], b: [number, number]) => {
    const oL = O.slice(...o);
    const aL = A.slice(...a);
    const bL = B.slice(...b);
    if (same(aL, oL)) stable(bL);
    else if (same(bL, oL) || same(aL, bL)) stable(aL);
    else regions.push({ kind: 'conflict', base: oL, ours: aL, theirs: bL, oursRange: { start: a[0], end: a[1] }, theirsRange: { start: b[0], end: b[1] } });
  };
  let io = 0;
  let ia = 0;
  let ib = 0;
  for (;;) {
    let k = 0;
    while (io + k < O.length && toA.get(io + k) === ia + k && toB.get(io + k) === ib + k) k++;
    if (k > 0) { stable(O.slice(io, io + k)); io += k; ia += k; ib += k; continue; }
    let o = io;
    while (o < O.length && (toA.get(o) === undefined || toB.get(o) === undefined)) o++;
    if (o === O.length) {
      if (io < O.length || ia < A.length || ib < B.length) chunk([io, O.length], [ia, A.length], [ib, B.length]);
      break;
    }
    const ea = toA.get(o)!;
    const eb = toB.get(o)!;
    chunk([io, o], [ia, ea], [ib, eb]);
    io = o;
    ia = ea;
    ib = eb;
  }
  return regions;
}
