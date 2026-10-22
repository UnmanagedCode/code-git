import { Refusal } from '../../refusals.js';
import { chunkPaths } from '../params.js';
import { STAGE_LIMITS } from './limits.js';

// Path gates shared by the ops that overwrite worktree files (discard, restore). `ls-files` has no
// --pathspec-from-file, so paths go after `--` in chunks of STAGE_LIMITS.argvChunkBytes.

const decoder = new TextDecoder('utf-8', { fatal: false });
const nulFields = (r) => decoder.decode(r.stdout).split('\0').filter(Boolean);

/** Runs `args -- <chunk>` once per chunk of `paths`; resolves every run's NUL-separated output fields. */
export async function perChunk(git, args, paths, opts) {
  const out = [];
  for (const chunk of chunkPaths(paths, STAGE_LIMITS.argvChunkBytes)) out.push(...nulFields(await git([...args, '--', ...chunk], opts)));
  return out;
}

/**
 * A tracked file now a directory on disk (`df/x` → `df/x/inner`): restoring it replaces the directory with the file and
 * deletes whatever is in it, unlisted. Anything not tracked under the paths — untracked or ignored (no
 * --exclude-standard: restore deletes ignored files too) — refuses UNTRACKED_UNDER_PATH.
 */
export async function assertNothingUntrackedUnder(git, paths) {
  const found = await perChunk(git, ['ls-files', '--others', '-z'], paths);
  if (found.length) throw new Refusal('UNTRACKED_UNDER_PATH', `${found[0]} is not tracked and would be deleted: move or delete it first`, { paths: found.slice(0, 100) });
}
