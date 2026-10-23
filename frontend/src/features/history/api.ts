import { runOp, type Target } from '@/lib/endpoints';

// The history ops' wire shapes (docs/protocol.md → History ops) and thin runOp wrappers.

/** Mirrors HISTORY_LIMITS.pageMax and blameLinesMax (src/git/history/limits.js); a test pins them equal. */
export const HISTORY_PAGE = 100;
export const BLAME_PAGE = 1000;

export interface HistoryItem {
  oid: string; parents: string[]; author: string; email: string; time: number; subject: string;
  /** R100, M, A, … (null for a commit with no entry, a merge). */
  status: string | null;
  /** The file's name at this commit. */
  path: string;
  /** A rename's (or copy's) old name. */
  oldPath: string | null;
}
export interface HistoryPage { items: HistoryItem[]; nextCursor: number | null; truncated: boolean }
export interface BlameLine { n: number; oid: string; origLine: number; text: string }
export interface BlameCommit { author: string; mail: string; time: number; summary: string; filename: string; previous: string | null }
export interface BlamePage { total: number; lines: BlameLine[]; commits: Record<string, BlameCommit> }
export interface ReflogItem { selector: string; oid: string; time: number | null; action: string; who: { name: string; email: string }; subject: string }
export interface ReflogPage { items: ReflogItem[]; nextCursor: number | null }

export const loadFileHistory = (t: Target, p: { rev: string; path: string; skip: number; limit?: number }) =>
  runOp<HistoryPage>('history.file', t, { rev: p.rev, path: p.path, skip: p.skip, limit: p.limit ?? HISTORY_PAGE });
export const loadBlame = (t: Target, p: { rev: string; path: string; start: number; count?: number }) =>
  runOp<BlamePage>('history.blame', t, { rev: p.rev, path: p.path, start: p.start, count: p.count ?? BLAME_PAGE });
export const loadReflog = (t: Target, p: { ref: string; skip: number; limit?: number }) =>
  runOp<ReflogPage>('history.reflog', t, { ref: p.ref, skip: p.skip, limit: p.limit ?? HISTORY_PAGE });
export const loadPaths = (t: Target, rev: string) => runOp<{ paths: string[] }>('history.paths', t, { rev });
