// Caps on the merge, rebase and conflict ops (docs/merge.md). One owner per value.

export const SEQUENCE_LIMITS = {
  /** A merge, rebase, continue or skip may replay many commits and run hooks: cc's exec maximum. */
  timeoutMs: 600_000,
};

export const REBASE_LIMITS = {
  /** Commits one rebase.plan lists and one interactive rebase takes. */
  maxCommits: 300,
  /** A reworded or squashed commit message, in UTF-8 bytes. */
  messageMaxBytes: 64 * 1024,
};

export const CONFLICT_LIMITS = {
  /** Each side conflict.read returns as text; larger is `large`. */
  sideMaxBytes: 512 * 1024,
  /** What conflict.save writes; base64 of it must fit the /api JSON body limit (src/app.js). */
  saveMaxBytes: 512 * 1024,
  /** Paths one conflict.take resolves. */
  takeMax: 100,
  /** Directory levels conflict.save builds a one-file tree through. */
  pathDepthMax: 64,
};
