import { Refusal } from '../../refusals.js';
import { parseConflictFiles } from '../parse/refs.js';

// Ref and worktree writes whose git failures have a refusal of their own.

/** Runs `args`; git's "… would be overwritten" refusal becomes CHECKOUT_CONFLICT with the `files` it named and its `stderr`. */
export async function guardOverwrite(git, args, opts) {
  try {
    return await git(args, opts);
  } catch (e) {
    const files = e.code === 'GIT_FAILED' ? parseConflictFiles(e.extra.stderr ?? '') : [];
    if (files.length) throw new Refusal('CHECKOUT_CONFLICT', 'local changes would be overwritten', { files, stderr: e.extra.stderr });
    throw e;
  }
}

/** `update-ref` from `expect` to `to` (compare-and-swap); a ref no longer at `expect` → REF_MOVED. */
export async function casUpdate(git, ref, to, expect, message) {
  try {
    await git(['update-ref', '-m', message, ref, to, expect]);
  } catch (e) {
    if (e.code === 'GIT_FAILED' && /but expected|unable to resolve reference|reference already exists/.test(e.extra.stderr ?? '')) {
      throw new Refusal('REF_MOVED', `${ref} is no longer at ${expect}`, { stderr: e.extra.stderr });
    }
    throw e;
  }
}
