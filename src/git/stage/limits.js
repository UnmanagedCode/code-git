// The single source for the staging, commit, ignore and patch caps. Each byte cap stays within cc's
// EXEC_MAX_OUTPUT_BYTES and each request-borne one within the API's 1 MB body (a test pins both).
export const STAGE_LIMITS = {
  /** Paths in one stage / unstage / discard request. */
  maxPaths: 10_000,
  /** A patch to check or apply, decoded; its base64 must fit the 1 MB request body. */
  applyPatchMaxBytes: 512 * 1024,
  /** A `.gitignore` code-git appends to. */
  gitignoreMaxBytes: 1024 * 1024,
  /** A commit template. */
  templateMaxBytes: 64 * 1024,
  /** Symlink hops followed to a commit template. */
  templateMaxLinks: 8,
  /** Argv bytes of paths per command where git has no --pathspec-from-file (`clean`, `ls-files`). */
  argvChunkBytes: 32 * 1024,
};
