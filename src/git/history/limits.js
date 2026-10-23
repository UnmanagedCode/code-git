import { LIMITS } from '../limits.js';

// The single source for the history, blame, reflog and paths caps (docs/history.md). Each byte cap stays within cc's
// EXEC_MAX_OUTPUT_BYTES, and followMaxCommits × followRecordBudgetBytes within fileMaxOutputBytes (a test pins both).
export const HISTORY_LIMITS = {
  /** Commits in one history.file or history.reflog page. */
  pageMax: 100,
  /**
   * How deep history.file pages: each page re-walks `log --follow` from the start (its --skip is broken: docs/protocol.md
   * → Paging convention), so at most this many commits are ever walked; past it the answer says `truncated`.
   */
  followMaxCommits: 2000,
  /**
   * One history.file record at its worst that the cap is sized for: two 64-hex oids and two parents, author, email and
   * subject up to 4 KiB together, the status and two paths of up to 4 KiB each. Longer records can only make a deep page
   * refuse OUTPUT_TOO_LARGE, never come back clipped.
   */
  followRecordBudgetBytes: 16 * 1024,
  /** The output of one history.file re-walk. */
  fileMaxOutputBytes: LIMITS.read.maxOutputBytes,
  /** Lines in one history.blame page. */
  blameLinesMax: 1000,
  /** The output of one blame page (porcelain: the lines and each commit's headers once). */
  blameMaxOutputBytes: 8 * 1024 * 1024,
  /** The output of one reflog page. */
  reflogMaxOutputBytes: 4 * 1024 * 1024,
  /** A commit's whole path list (history.paths, the palette's file pick). */
  pathsMaxOutputBytes: 4 * 1024 * 1024,
};
