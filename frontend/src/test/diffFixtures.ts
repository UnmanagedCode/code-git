import type { DiffFile, DiffFilesResult, DiffLine, FileDiff, Hunk } from '@/features/diff/api';

// Builders for the diff ops' answers.

export const OID = (c: string) => c.repeat(40);

export const dfile = (over: Partial<DiffFile> = {}): DiffFile => ({
  path: 'src/a.ts', oldPath: null, status: 'M', similarity: null, added: 1, deleted: 1, binary: false, submodule: false,
  oversized: false, oldMode: '100644', newMode: '100644', oldOid: OID('1'), newOid: OID('2'), ...over,
});

export const filesResult = (files: DiffFile[], over: Partial<DiffFilesResult> = {}): DiffFilesResult => ({
  pair: { old: { type: 'tree', oid: OID('a') }, new: { type: 'tree', oid: OID('b') } },
  commit: { oid: OID('b'), parents: [OID('a')] }, mergeBase: null, series: null, files, ...over,
});

/** A hunk from compact lines: ' x' context, '-x' del, '+x' add; numbers follow from the starts. */
export function hunk(oldStart: number, newStart: number, lines: string[], section = ''): Hunk {
  let o = oldStart;
  let n = newStart;
  const out: DiffLine[] = lines.map((l) => {
    const text = l.slice(1);
    if (l[0] === '-') return { kind: 'del', text, oldNo: o++, newNo: null, noNewline: false };
    if (l[0] === '+') return { kind: 'add', text, oldNo: null, newNo: n++, noNewline: false };
    return { kind: 'context', text, oldNo: o++, newNo: n++, noNewline: false };
  });
  const oldLines = out.filter((l) => l.kind !== 'add').length;
  const newLines = out.filter((l) => l.kind !== 'del').length;
  return { header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${section ? ` ${section}` : ''}`, oldStart, oldLines, newStart, newLines, lines: out };
}

export const fdiff = (hunks: Hunk[], over: Partial<FileDiff> = {}): FileDiff => ({
  path: 'src/a.ts', oldPath: null, binary: false, unmerged: false, oldMode: '100644', newMode: '100644', lfs: null, submodule: null, hunks, ...over,
});
