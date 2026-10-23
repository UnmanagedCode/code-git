import { LIMITS } from '../limits.js';

// The single source for the stash caps. Each byte cap stays within cc's EXEC_MAX_OUTPUT_BYTES (a test pins it).
export const STASH_LIMITS = {
  /** A stash message, in characters. */
  messageMax: 1000,
  /** One path listing of a stash (its tracked or untracked part) or of the changes a save would stash. */
  pathsMaxOutputBytes: LIMITS.read.maxOutputBytes,
};
