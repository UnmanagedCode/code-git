import { Refusal } from '../../refusals.js';
import { assertSubpath } from '../validate.js';
import { SUBMODULE_LIMITS } from './limits.js';

// What a submodule may be called and where it may live. `.gitmodules` is the repository's (untrusted): a name or path
// failing these is listed as blocked and never acted on. Pure.

// Code points HFS+ ignores in a file name, so `.g‌it` is `.git` there (git's is_hfs_dotgit).
const HFS_IGNORABLE = /[‌-‏‪-‮⁪-⁯﻿]/g;

/**
 * Whether a path segment names a repository's `.git` on some filesystem: any case (case-folding), HFS-ignorable code
 * points dropped, trailing dots and spaces stripped (NTFS), or the NTFS 8.3 short name `git~<n>`.
 */
export function isDotGitAlias(seg) {
  const s = seg.toLowerCase().replace(HFS_IGNORABLE, '').replace(/[. ]+$/, '');
  return s === '.git' || /^git~\d+$/.test(s);
}

/**
 * A submodule path, relative to its repo, used as `-C <path>` and after `--`: assertSubpath (no leading `-`, no `..`,
 * not absolute), no empty or `.` segment, no trailing `/`, and no segment aliasing `.git` (isDotGitAlias). Else BAD_PATH.
 */
export function submodulePath(s) {
  assertSubpath(s);
  const segs = s.split('/');
  if (segs.some((g) => g === '' || g === '.')) throw new Refusal('BAD_PATH', 'invalid submodule path: an empty or . segment');
  if (segs.some(isDotGitAlias)) throw new Refusal('BAD_PATH', 'invalid submodule path: a segment names .git');
  return s;
}

const hasControl = (s) => /[\x00-\x1f\x7f]/.test(s);

/**
 * A submodule name, spliced into `submodule.<name>.*` keys and naming `.git/modules/<name>`: non-empty, at most 1024
 * bytes, no control character or backslash, no leading `-`, not absolute, no `..` segment (git's check_submodule_name)
 * and no segment aliasing `.git`. Else BAD_PARAMS.
 */
export function submoduleName(s) {
  const bad = (why) => new Refusal('BAD_PARAMS', `invalid submodule name: ${why}`);
  if (typeof s !== 'string' || s === '') throw bad('empty');
  if (Buffer.byteLength(s) > 1024) throw bad('longer than 1024 bytes');
  if (hasControl(s) || s.includes('\\')) throw bad('contains a control character or a backslash');
  if (s.startsWith('-')) throw bad('starts with -');
  if (s.startsWith('/')) throw bad('absolute');
  const segs = s.split('/');
  if (segs.includes('..')) throw bad('has a .. segment');
  if (segs.some(isDotGitAlias)) throw bad('a segment names .git');
  return s;
}

/**
 * A target's `sub`: the chain of submodule paths from the checkout down, each relative to the repo before it — an
 * array of 1…SUBMODULE_LIMITS.maxDepth submodulePath entries. Else BAD_TARGET.
 */
export function submoduleChain(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > SUBMODULE_LIMITS.maxDepth) {
    throw new Refusal('BAD_TARGET', `target.sub must list 1…${SUBMODULE_LIMITS.maxDepth} submodule paths`);
  }
  return v.map((p) => {
    try {
      return submodulePath(p);
    } catch (e) {
      throw new Refusal('BAD_TARGET', `target.sub: ${e.message}`);
    }
  });
}
