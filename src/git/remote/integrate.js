import { Refusal } from '../../refusals.js';
import { parseConflictFiles } from '../parse/refs.js';
import { guardOverwrite } from '../refs/write.js';

// Integrating a fetched upstream into this checkout's branch: the second half of remote.pull. Pull is never `git pull`:
// a fetch (fetch.js) and then one of these, each with the config that would reshape it overridden on the command line.

const decoder = new TextDecoder('utf-8', { fatal: false });

/** `git merge` with `merge.autoStash` off: local changes are never stashed and re-applied behind the user's back. */
const MERGE = ['-c', 'merge.autoStash=false', 'merge'];
/**
 * `git rebase` with the config that would widen it off: `rebase.autoStash` (a hidden stash), `rebase.updateRefs` (it
 * would move every other branch pointing into the rebased range, code-conductor/* ones included) and
 * `rebase.autoSquash` (it would reorder commits).
 */
const REBASE = ['-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.autoSquash=false', 'rebase'];

const unmergedFiles = async (git) => decoder.decode((await git(['diff', '--name-only', '--diff-filter=U', '-z'])).stdout).split('\0').filter(Boolean);

/** Fast-forwards this checkout's branch to `oid` (CHECKOUT_CONFLICT when local changes are in the way). */
export async function fastForward(git, oid) {
  await guardOverwrite(git, [...MERGE, '--ff-only', '--end-of-options', oid]);
}

/**
 * Merges `oid` into this checkout's branch with a merge commit `message` → {conflicts: false} | {conflicts: true,
 * files}: a conflicted merge stays in progress (`head.abort` `merge` undoes it). CHECKOUT_CONFLICT when local changes
 * are in the way (nothing starts).
 */
export async function merge(git, oid, message) {
  const r = await guardOverwrite(git, [...MERGE, '--ff', '--no-edit', '-m', message, '--end-of-options', oid], { okExit: [0, 1] });
  if (r.exitCode === 0) return { conflicts: false, files: [] };
  const files = await unmergedFiles(git);
  if (files.length) return { conflicts: true, files };
  throw new Refusal('GIT_FAILED', 'git merge exited with 1', { exitCode: 1, stderr: decoder.decode(r.stderr) });
}

/**
 * THE policy for a rebase that stopped on conflicts (`files`): abort it, so the checkout is as it was, and refuse
 * PULL_CONFLICTS. The one place that decides; a later card keeps the rebase in progress by changing only this.
 */
export async function onRebaseStopped(git, files) {
  await git(['rebase', '--abort']);
  throw new Refusal('PULL_CONFLICTS', `rebasing would conflict in ${files.length} ${files.length === 1 ? 'file' : 'files'}; nothing changed`, { files });
}

/**
 * Rebases this checkout's branch onto `oid`. Stopped on conflicts → onRebaseStopped. Any other failure is aborted
 * first if git left a rebase in progress (`rebase --abort`, exit 128 when it did not), then refused: untracked files in
 * the way → CHECKOUT_CONFLICT, else GIT_FAILED with git's stderr.
 */
export async function rebase(git, oid) {
  const r = await git([...REBASE, '--end-of-options', oid], { okExit: [0, 1] });
  if (r.exitCode === 0) return;
  const files = await unmergedFiles(git);
  if (files.length) await onRebaseStopped(git, files);
  const stderr = decoder.decode(r.stderr);
  await git(['rebase', '--abort'], { okExit: [0, 128] });
  const blocked = parseConflictFiles(stderr);
  if (blocked.length) throw new Refusal('CHECKOUT_CONFLICT', 'local changes would be overwritten', { files: blocked, stderr });
  throw new Refusal('GIT_FAILED', 'git rebase exited with 1', { exitCode: 1, stderr });
}
