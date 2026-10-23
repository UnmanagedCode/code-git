import type { DiffLine, FileDiff, Hunk } from './api';
import { wordDiff, type Range } from './wordDiff';

// Pure row models over a file's hunks. A line is addressed as (hunk index, line index).

export interface LineRef {
  line: DiffLine;
  hunk: number;
  index: number;
  /** Word-level changed ranges, for a del/add paired within its change block. */
  emphasis: Range[] | null;
}

/** A run of consecutive del/add lines within one hunk. `start` is the line index of its first line. */
export interface ChangeBlock { hunk: number; start: number; dels: number[]; adds: number[] }

export type UnifiedRow =
  | { type: 'hunk'; hunk: number; header: string }
  | { type: 'line'; ref: LineRef; change: number | null };

export type SplitRow =
  | { type: 'hunk'; hunk: number; header: string }
  | { type: 'pair'; old: LineRef | null; new: LineRef | null; change: number | null };

export function changeBlocks(hunks: Hunk[]): ChangeBlock[] {
  const out: ChangeBlock[] = [];
  hunks.forEach((h, hi) => {
    let cur: ChangeBlock | null = null;
    h.lines.forEach((l, li) => {
      if (l.kind === 'context') { cur = null; return; }
      if (!cur) { cur = { hunk: hi, start: li, dels: [], adds: [] }; out.push(cur); }
      (l.kind === 'del' ? cur.dels : cur.adds).push(li);
    });
  });
  return out;
}

/** Every line as a LineRef, with word emphasis on the i-th del / i-th add pairs of each block. */
function lineRefs(hunks: Hunk[], blocks: ChangeBlock[]): LineRef[][] {
  const refs = hunks.map((h, hi) => h.lines.map((line, index): LineRef => ({ line, hunk: hi, index, emphasis: null })));
  for (const b of blocks) {
    b.dels.forEach((d, i) => {
      const a = b.adds[i];
      if (a === undefined) return;
      const w = wordDiff(displayText(refs[b.hunk][d].line), displayText(refs[b.hunk][a].line));
      if (w) { refs[b.hunk][d].emphasis = w.a; refs[b.hunk][a].emphasis = w.b; }
    });
  }
  return refs;
}

/** Unified rows: a header row per hunk (when `headers`), then its lines; a block's first line carries its change index. */
export function unifiedRows(hunks: Hunk[], headers = true): UnifiedRow[] {
  const blocks = changeBlocks(hunks);
  const refs = lineRefs(hunks, blocks);
  const changeAt = new Map(blocks.map((b, k) => [`${b.hunk}:${b.start}`, k]));
  return hunks.flatMap((h, hi) => [
    ...(headers ? [{ type: 'hunk' as const, hunk: hi, header: h.header }] : []),
    ...refs[hi].map((ref) => ({ type: 'line' as const, ref, change: changeAt.get(`${hi}:${ref.index}`) ?? null })),
  ]);
}

/** Side-by-side rows: context on both sides; per block, the i-th del beside the i-th add, the longer side padded. */
export function splitRows(hunks: Hunk[], headers = true): SplitRow[] {
  const blocks = changeBlocks(hunks);
  const refs = lineRefs(hunks, blocks);
  const rows: SplitRow[] = [];
  hunks.forEach((h, hi) => {
    if (headers) rows.push({ type: 'hunk', hunk: hi, header: h.header });
    for (let li = 0; li < h.lines.length;) {
      const ref = refs[hi][li];
      if (ref.line.kind === 'context') { rows.push({ type: 'pair', old: ref, new: ref, change: null }); li++; continue; }
      const k = blocks.findIndex((b) => b.hunk === hi && b.start === li);
      const b = blocks[k];
      for (let i = 0; i < Math.max(b.dels.length, b.adds.length); i++) {
        const d = b.dels[i];
        const a = b.adds[i];
        rows.push({ type: 'pair', old: d === undefined ? null : refs[hi][d], new: a === undefined ? null : refs[hi][a], change: i === 0 ? k : null });
      }
      li += b.dels.length + b.adds.length;
    }
  });
  return rows;
}

/** One side's lines of a hunk: 'old' = context + deleted, 'new' = context + added. */
export const sideLines = (hunk: Hunk, side: 'old' | 'new'): DiffLine[] =>
  hunk.lines.filter((l) => l.kind === 'context' || l.kind === (side === 'old' ? 'del' : 'add'));

export const sideText = (hunk: Hunk, side: 'old' | 'new'): string => sideLines(hunk, side).map((l) => l.text).join('\n');

/** A file diff's added and deleted lines: exact whatever the context, since every changed line is in a hunk. */
export function lineCounts(fd: FileDiff): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const h of fd.hunks) for (const l of h.lines) { if (l.kind === 'add') added++; else if (l.kind === 'del') deleted++; }
  return { added, deleted };
}

/** A deleted file: no hunk has a new side. */
export const isDeletion = (fd: FileDiff): boolean => fd.hunks.length > 0 && fd.hunks.every((h) => h.newLines === 0);

/**
 * The File view's content, rebuilt from a full-context diff: the new side, or the old side for a deletion.
 * Each line ends in a newline unless git marked it "\ No newline at end of file".
 */
export function fileContent(fd: FileDiff): string {
  const side = isDeletion(fd) ? 'old' : 'new';
  return fd.hunks.flatMap((h) => sideLines(h, side)).map((l) => (l.noNewline ? l.text : `${l.text}\n`)).join('');
}

/** The text as shown: a CRLF file's trailing \r is not displayed. */
export const displayText = (line: { text: string }): string => (line.text.endsWith('\r') ? line.text.slice(0, -1) : line.text);
