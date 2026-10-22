import { runOp, type Target } from '@/lib/endpoints';

// The diff ops' wire shapes (docs/protocol.md → Diff ops) and thin runOp wrappers.

export type Side = { type: 'tree'; oid: string } | { type: 'index' } | { type: 'worktree' };
export type Pair = { old: Side; new: Side };

export type DiffSource =
  | { kind: 'commit'; rev: string; parent?: number }
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'compare'; from: string; to: string; mode: '..' | '...' }
  | { kind: 'worktree'; rev: string }
  | { kind: 'commits'; oids: string[]; wip?: boolean }
  | ({ kind: 'pair' } & Pair);

export type Whitespace = 'none' | 'eol' | 'change' | 'all';
export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  similarity: number | null;
  added: number | null;
  deleted: number | null;
  binary: boolean;
  submodule: boolean;
  oversized: boolean;
  oldMode: string | null;
  newMode: string | null;
  oldOid: string | null;
  newOid: string | null;
}

export interface Resolved {
  pair: Pair;
  commit: { oid: string; parents: string[] } | null;
  mergeBase: string | null;
  series: { oids: string[]; direct: boolean; wip: boolean; merges: boolean } | null;
}

export interface DiffFilesResult extends Resolved { files: DiffFile[] }

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  /** Exact, without its newline. */
  text: string;
  oldNo: number | null;
  newNo: number | null;
  noNewline: boolean;
}

export interface Hunk {
  /** The exact `@@ -a,b +c,d @@ section` line: unique within a file, so it is the hunk's id. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface LfsPointer { oid: string; size: number }

export interface FileDiff {
  path: string;
  oldPath: string | null;
  binary: boolean;
  unmerged: boolean;
  oldMode: string | null;
  newMode: string | null;
  lfs: { old: LfsPointer | null; new: LfsPointer | null } | null;
  submodule: { old: string | null; new: string | null; dirty: boolean } | null;
  hunks: Hunk[];
}

export interface PatchResult { filename: string; base64: string; bytes: number }

export const listDiffFiles = (t: Target, source: DiffSource, whitespace: Whitespace) =>
  runOp<DiffFilesResult>('diff.files', t, { source, whitespace });

export interface FileRequest { path: string; oldPath?: string; untracked?: boolean; context: number | 'full'; whitespace: Whitespace }
export const loadFileDiff = (t: Target, source: DiffSource, req: FileRequest) => runOp<FileDiff>('diff.file', t, { source, ...req });

export const createPatch = (t: Target, source: DiffSource, paths?: string[]) =>
  runOp<PatchResult>('diff.patch', t, { source, ...(paths?.length ? { paths } : {}) });
