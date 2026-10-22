import { LIMITS } from '../limits.js';

// The single source for diff caps. Each byte cap stays within cc's EXEC_MAX_OUTPUT_BYTES (a test pins it).
export const DIFF_LIMITS = {
  /** The whole file list: one `diff --raw --numstat -z` command. */
  listMaxOutputBytes: LIMITS.read.maxOutputBytes,
  /** One file's diff. */
  fileMaxOutputBytes: 8 * 1024 * 1024,
  patchMaxOutputBytes: LIMITS.read.maxOutputBytes,
  /** A file with more added + deleted lines is listed `oversized`: the UI asks before loading it. */
  oversizeLines: 10_000,
  /** Commits in one multi-selection. */
  maxCommits: 1000,
  /** Paths in one diff.patch selection. */
  maxPaths: 1000,
};
