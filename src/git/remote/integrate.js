import { Refusal } from '../../refusals.js';
import { parseConflictFiles } from '../parse/refs.js';
import { guardOverwrite } from '../refs/write.js';
import { operationState } from '../sequence/state.js';

// Integrating a commit into this checkout's branch: the second half of remote.pull (never `git pull`: a fetch, fetch.js,
// and then one of these) and every merge and rebase op. Each runs with the config that would reshape it overridden on the
// command line.

const decoder = new TextDecoder('utf-8', { fatal: false });

/** `git merge` with `merge.autoStash` off: local changes are never stashed and re-applied behind the user's back. */
const MERGE = ['-c', 'merge.autoStash=false', 'merge'];
/**
 * `git rebase` with the config that would widen it off: `rebase.autoStash` (a hidden stash), `rebase.updateRefs` (it
 * would move every other branch pointing into the rebased range, code-conductor/* ones included), `rebase.autoSquash`
 * (it would reorder commits); and pinned: `rebase.backend=merge` (the state lives in `rebase-merge/`, the interactive
 * todo is git's), `rebase.rebaseMerges=false` (merge commits are refused before a rebase starts, never recreated).
 */
export const REBASE = [
  '-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.autoSquash=false',
  '-c', 'rebase.backend=merge', '-c', 'rebase.rebaseMerges=false', 'rebase',
];
/** How each merge mode runs: `--ff` / `--no-ff` make a commit with the given message, `--squash` only stages. */
const MERGE_MODE = { ff: ['--ff'], noFf: ['--no-ff'], squash: ['--squash'] };

const unmergedFiles = async (git) => decoder.decode((await git(['diff', '--name-only', '--diff-filter=U', '-z'])).stdout).split('\0').filter(Boolean);

/** Fast-forwards this checkout's branch to `oid` (CHECKOUT_CONFLICT when local changes are in the way). */
export async function fastForward(git, oid) {
  await guardOverwrite(git, [...MERGE, '--ff-only', '--end-of-options', oid]);
}

/**
 * Merges `oid` into this checkout: `mode` `ff` (fast-forward when possible, else a merge commit `message`), `noFf`
 * (always a merge commit) or `squash` (the changes staged, no commit, no MERGE_HEAD) → {conflicts: false} |
 * {conflicts: true, files}: a conflicted merge stays in progress (`head.abort` `merge` undoes it; a squash's conflicts
 * have no operation). CHECKOUT_CONFLICT when local changes are in the way (nothing starts).
 */
export async function merge(git, oid, { mode, message, timeoutMs }) {
  const commit = mode === 'squash' ? [] : ['--no-edit', '-m', message];
  const args = [...MERGE, ...MERGE_MODE[mode], ...commit, '--no-stat', '--end-of-options', oid];
  const r = await guardOverwrite(git, args, { okExit: [0, 1], timeoutMs });
  if (r.exitCode === 0) return { conflicts: false, files: [] };
  const files = await unmergedFiles(git);
  if (files.length) return { conflicts: true, files };
  throw new Refusal('GIT_FAILED', 'git merge exited with 1', { exitCode: 1, stderr: decoder.decode(r.stderr) });
}

/**
 * THE policy for a rebase that stopped on conflicts (`files`): it stays in progress, as a merge's conflicts do, and the
 * caller answers `conflicts` with the files (`head.continue` / `head.skip` / `head.abort` take it from there). The one
 * place that decides.
 */
export async function onRebaseStopped(git, files) {
  return { outcome: 'conflicts', files };
}

/** Whether a rebase is in progress in this checkout (an `edit` stop leaves one after exit 0). */
const rebasing = async (git) => (await operationState(git)).operation?.kind === 'rebase';

/**
 * `git rebase <args>` (REBASE's pins first; `env`, `stdin` and `timeoutMs` for the run) → {outcome: 'done' | 'stopped',
 * files: []} (exit 0; `stopped`: an `edit` stop left the rebase in progress), or onRebaseStopped's answer when it stopped
 * on conflicts. Any other failure is aborted first if git left a rebase in progress (`rebase --abort`, exit 128 when it
 * did not), then refused: untracked files in the way → CHECKOUT_CONFLICT, else GIT_FAILED with git's stderr.
 */
export async function rebase(git, args, { env, stdin, timeoutMs } = {}) {
  const r = await git([...REBASE, ...args], { okExit: [0, 1], env, stdin, timeoutMs });
  if (r.exitCode === 0) return { outcome: (await rebasing(git)) ? 'stopped' : 'done', files: [] };
  const files = await unmergedFiles(git);
  if (files.length) return onRebaseStopped(git, files);
  const stderr = decoder.decode(r.stderr);
  await git(['rebase', '--abort'], { okExit: [0, 128] });
  const blocked = parseConflictFiles(stderr);
  if (blocked.length) throw new Refusal('CHECKOUT_CONFLICT', 'local changes would be overwritten', { files: blocked, stderr });
  throw new Refusal('GIT_FAILED', 'git rebase exited with 1', { exitCode: 1, stderr });
}
