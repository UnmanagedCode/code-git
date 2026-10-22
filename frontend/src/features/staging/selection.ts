import type { FileDiff } from '@/features/diff/api';
import type { LineSelection } from '@/features/workdir/api';

// Pure helpers over a line selection: a set of `h:i` keys (hunk index, line index) naming add/del lines of one FileDiff.

export const lineKey = (hunk: number, index: number): string => `${hunk}:${index}`;
const parse = (key: string): [number, number] => key.split(':').map(Number) as [number, number];
const isChange = (fd: FileDiff, h: number, i: number) => {
  const l = fd.hunks[h]?.lines[i];
  return !!l && l.kind !== 'context';
};

/** `keys` with `key` added, or removed when present. */
export function toggle(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

/** Every add/del line from `from` to `to` (either order, both included), in (hunk, line) order. */
export function extendRange(fd: FileDiff, from: string, to: string): string[] {
  const [a, b] = [parse(from), parse(to)].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: string[] = [];
  fd.hunks.forEach((h, hi) => h.lines.forEach((l, li) => {
    const after = hi > a[0] || (hi === a[0] && li >= a[1]);
    const before = hi < b[0] || (hi === b[0] && li <= b[1]);
    if (after && before && l.kind !== 'context') out.push(lineKey(hi, li));
  }));
  return out;
}

/** The op request for `keys`: per hunk (in order) its header and its selected lines (in order) with their exact texts. */
export function toRequest(fd: FileDiff, keys: Iterable<string>): LineSelection[] {
  const byHunk = new Map<number, number[]>();
  for (const k of keys) {
    const [h, i] = parse(k);
    if (isChange(fd, h, i)) byHunk.set(h, [...(byHunk.get(h) ?? []), i]);
  }
  return [...byHunk.entries()].sort(([x], [y]) => x - y).map(([h, idx]) => ({
    header: fd.hunks[h].header,
    lines: [...idx].sort((x, y) => x - y).map((i) => ({ index: i, text: fd.hunks[h].lines[i].text })),
  }));
}

/** The whole hunk `h`: every add/del line of it. */
export const hunkRequest = (fd: FileDiff, h: number): LineSelection[] =>
  toRequest(fd, fd.hunks[h].lines.flatMap((l, i) => (l.kind === 'context' ? [] : [lineKey(h, i)])));

/** The selected lines as a preview: `-text` / `+text`, in request order. */
export const previewLines = (fd: FileDiff, req: LineSelection[]): string[] =>
  req.flatMap((r) => {
    const h = fd.hunks.find((x) => x.header === r.header);
    return r.lines.map((l) => `${h?.lines[l.index].kind === 'del' ? '-' : '+'}${l.text}`);
  });
