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
   * The bound on noIndex.js's stat-only `--raw` probe. A regular file is only stat-ed (no open, no hash: ~1 ms for a
   * 118 MiB file with git 2.55, against 232 ms for `hash-object` reading it), so this covers process spawn and cc's exec
   * round trip, not file size; a FIFO, which git opens, is refused PROBE_TIMEOUT within it. The content read after a
   * `file` verdict keeps the kind's timeout. Read at call time.
   */
  probeTimeoutMs: 10_000,
};
