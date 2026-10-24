import { Refusal } from '../../refusals.js';
import { readNoIndex, worktreeEntry } from '../diff/noIndex.js';
import { LFS_LIMITS } from './limits.js';
import { parseLfsAttributes } from './parse.js';

// The root .gitattributes: what lfs.status lists and what `git lfs track` / `untrack` write.

const FILE = '.gitattributes';

/**
 * The LFS patterns of the root .gitattributes: {attributes: 'ok', patterns} (an absent file has none), or
 * {attributes: 'unsupported', patterns: null} for a symlink (never read through), a directory, a binary file or one over
 * LFS_LIMITS.attributesMaxBytes.
 */
export async function readLfsPatterns(git) {
  const r = await readNoIndex(git, FILE, { maxBytes: LFS_LIMITS.attributesMaxBytes });
  if (r.kind === 'absent') return { attributes: 'ok', patterns: [] };
  if (r.kind !== 'file') return { attributes: 'unsupported', patterns: null };
  return { attributes: 'ok', patterns: parseLfsAttributes(r.bytes) };
}

/** ATTRIBUTES_UNSUPPORTED when the root .gitattributes is a symlink or not a regular file: git-lfs would write through it. */
export async function assertAttributesWritable(git) {
  const { kind } = await worktreeEntry(git, FILE);
  if (kind === 'symlink' || kind === 'other') {
    throw new Refusal('ATTRIBUTES_UNSUPPORTED', `the root ${FILE} is ${kind === 'symlink' ? 'a symbolic link' : 'not a regular file'}: edit it by hand`);
  }
}
