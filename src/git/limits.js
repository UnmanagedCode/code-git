// The plugin's own per-kind defaults. Each must stay within cc's exec caps (CC_EXEC_CAPS in
// src/conductor/exec.js): a larger request is cc's INVALID_ARGUMENT, which surfaces as INTERNAL.
export const LIMITS = {
  read: { timeoutMs: 60_000, maxOutputBytes: 32 * 1024 * 1024 },
  write: { timeoutMs: 300_000, maxOutputBytes: 8 * 1024 * 1024 },
  /** Bytes of stderr kept on an activity entry (the tail: git's verdict comes last). */
  stderrCap: 64 * 1024,
  /** Activity entries kept in memory. */
  activityRing: 500,
  /** Deadline for cc's own REST reads (project and worktree listings). */
  ccReadTimeoutMs: 30_000,
};
