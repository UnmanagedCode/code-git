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
  /**
   * The bound on noIndex.js's stat-only `--raw` probe. A regular file is only stat-ed, never opened or hashed, so this
   * covers process spawn and cc's exec round trip, not file size; a FIFO, which git opens, is refused PROBE_TIMEOUT
   * within it. The measurement and its conditions: wiki gotchas/diff-parsing → "The `--no-index` probe is bounded".
   * It also bounds runGit's attribute probe (src/git/attributes.js: one `check-attr`, ~1 ms locally, ~7 ms with a
   * 100k-entry index it loads), refused ATTRIBUTES_TIMEOUT past it. Read at call time.
   */
  probeTimeoutMs: 10_000,
  /**
   * The bound on a git command that reads the content of one file (noIndex.js's boundedRead: readNoIndex's read,
   * diff.file's untracked diff, `hash-object` of a conflicted worktree file or a legacy remote file): a FIFO there is
   * refused READ_TIMEOUT within it. Text is cut off by the output caps (an 8 MiB file: ~130 ms); a binary file is hashed
   * whole (~1.4 s per GiB idle, ~1.7–1.9 s per GiB on a loaded host), so this covers a binary file of roughly 15–20 GiB
   * on a warm cache; CPU load (hashing is CPU-bound) and a slow disk lower that. Measurement and conditions: wiki
   * gotchas/diff-parsing. Read at call time.
   */
  contentReadTimeoutMs: 30_000,
};
