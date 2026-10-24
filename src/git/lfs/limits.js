import { bad } from '../params.js';

// Caps on the LFS ops (docs/lfs.md). Each within cc's exec caps (CC_EXEC_CAPS).

export const LFS_LIMITS = {
  /** `git lfs ls-files --json` output; over it, OUTPUT_TOO_LARGE. */
  listMaxOutputBytes: 16 * 1024 * 1024,
  /** A pull downloads every object HEAD needs: cc's exec maximum. */
  netTimeoutMs: 600_000,
  /** A pattern track and untrack take, in characters. */
  patternMaxLength: 256,
  /** The root .gitattributes lfs.status reads; larger is `unsupported`. */
  attributesMaxBytes: 1024 * 1024,
};

// ASCII control characters, DEL included.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A pattern for `git lfs track` / `untrack`: 1…patternMaxLength characters, no control character, no whitespace at either
 * end, and no leading `-` (an option), `#` (a comment line), `!` (a negative pattern git ignores) or `"` (a quoted
 * pattern git would unquote). It always follows `--`. BAD_PARAMS otherwise.
 */
export function checkPattern(v) {
  if (typeof v !== 'string' || v.length < 1 || v.length > LFS_LIMITS.patternMaxLength) throw bad(`pattern must be 1…${LFS_LIMITS.patternMaxLength} characters`);
  if (CONTROL.test(v)) throw bad('pattern may not contain a control character');
  if (v.trim() !== v) throw bad('pattern may not start or end with whitespace');
  if (/^[-#!"]/.test(v)) throw bad('pattern may not start with -, #, ! or "');
  return v;
}
