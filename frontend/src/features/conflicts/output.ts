import type { SideLabels } from '@/features/sequence/labels';
import type { Region } from './diff3';

// The conflict tool's Output pane (docs/merge.md → The conflict tool): the whole result text, and where each conflict
// block sits in it. Pure. A block starts as git-style markers; picking lines replaces it with them; typing over it marks it
// edited (then it is the user's text, picks no longer apply to it).

export type { SideLabels };
export type BlockState = 'markers' | 'picked' | 'edited';
/** Line indices picked within the conflict's own ours / theirs lines, in the order they are output. */
export interface Picks { ours: number[]; theirs: number[] }
/** Conflict `i`'s place in the text: [start, end) character offsets. */
export interface Block { start: number; end: number; state: BlockState; picks: Picks }
export interface Output { text: string; blocks: Block[] }

type Conflict = Extract<Region, { kind: 'conflict' }>;
export const conflictsOf = (regions: Region[]): Conflict[] => regions.filter((r): r is Conflict => r.kind === 'conflict');

const NO_PICKS: Picks = { ours: [], theirs: [] };
const withNewline = (s: string) => (s && !s.endsWith('\n') ? `${s}\n` : s);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

/** A conflict as git writes it: `<<<<<<< current`, ours, `=======`, theirs, `>>>>>>> incoming`. */
export function markers(c: Conflict, labels: SideLabels): string {
  return `<<<<<<< ${oneLine(labels.current)}\n${withNewline(c.ours.join(''))}=======\n${withNewline(c.theirs.join(''))}>>>>>>> ${oneLine(labels.incoming)}\n`;
}

/** The stable lines as they are, each conflict as markers. */
export function initialOutput(regions: Region[], labels: SideLabels): Output {
  let text = '';
  const blocks: Block[] = [];
  for (const r of regions) {
    if (r.kind === 'stable') { text += r.lines.join(''); continue; }
    const start = text.length;
    text += markers(r, labels);
    blocks.push({ start, end: text.length, state: 'markers', picks: NO_PICKS });
  }
  return { text, blocks };
}

/** Block `i`'s text replaced by `content`; the blocks after it shift. */
function replaceBlock(out: Output, i: number, content: string, state: BlockState, picks: Picks): Output {
  const b = out.blocks[i];
  const delta = content.length - (b.end - b.start);
  return {
    text: out.text.slice(0, b.start) + content + out.text.slice(b.end),
    blocks: out.blocks.map((x, j) => (j === i ? { start: b.start, end: b.start + content.length, state, picks }
      : j > i ? { ...x, start: x.start + delta, end: x.end + delta } : x)),
  };
}

/** Block `i` set to the picked lines (ours first, then theirs, each in file order); no pick puts its markers back. */
export function setPick(out: Output, conflicts: Conflict[], labels: SideLabels, i: number, picks: Picks): Output {
  const c = conflicts[i];
  const sorted = { ours: [...new Set(picks.ours)].sort((a, b) => a - b), theirs: [...new Set(picks.theirs)].sort((a, b) => a - b) };
  if (!sorted.ours.length && !sorted.theirs.length) return replaceBlock(out, i, markers(c, labels), 'markers', NO_PICKS);
  const content = sorted.ours.map((l) => c.ours[l]).join('') + sorted.theirs.map((l) => c.theirs[l]).join('');
  return replaceBlock(out, i, content, 'picked', sorted);
}

/**
 * The blocks after the text changed from `oldText` to `newText` (one edit: the common prefix and suffix are kept): a
 * block before the edit stays, one after it shifts, one the edit touches grows to cover it and becomes `edited`.
 */
export function applyEdit(blocks: Block[], oldText: string, newText: string): Block[] {
  let p = 0;
  const min = Math.min(oldText.length, newText.length);
  while (p < min && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < min - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const oldEnd = oldText.length - s;
  const delta = newText.length - oldText.length;
  return blocks.map((b) => {
    if (b.end <= p) return b;
    if (b.start >= oldEnd) return { ...b, start: b.start + delta, end: b.end + delta };
    return { start: Math.min(b.start, p), end: Math.max(b.end, oldEnd) + delta, state: 'edited', picks: NO_PICKS };
  });
}

/** The blocks still showing their markers. */
export const unresolved = (blocks: Block[]): number[] => blocks.flatMap((b, i) => (b.state === 'markers' ? [i] : []));
/** The block after / before `from` (null at either end); from -1, the first. */
export const nextBlock = (blocks: Block[], from: number): number | null => (from + 1 < blocks.length ? from + 1 : null);
export const prevBlock = (_blocks: Block[], from: number): number | null => (from > 0 ? from - 1 : null);
/** A line of the text starts a conflict marker (what Mark resolved asks about). */
export const hasMarkers = (text: string): boolean => /^<<<<<<< /m.test(text);
