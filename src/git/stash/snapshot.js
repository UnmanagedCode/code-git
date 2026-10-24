import { Refusal } from '../../refusals.js';
import { worktreeTree } from '../stage/discard.js';

// A checkout's state around a stash op, for its undo (docs/undo.md → Steps, `worktree`): HEAD, the index as a tree, and
// the worktree content of the paths the op writes, as a tree. Written back over a temporary index with a two-way
// `read-tree -m -u`, never with `apply --index` (wiki: gotchas/staging-patches).

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout).trim();
const UNDO_INDEX = 'code-git-undo-index';

/** HEAD's oid, or null when it is unborn. */
export async function headOid(git) {
  const r = await git(['rev-parse', '-q', '--verify', 'HEAD'], { okExit: [0, 1] });
  return r.exitCode === 0 ? text(r) : null;
}

/** `{head, index, files}`: HEAD's oid, the index's `write-tree`, `worktreeTree(paths)`. The index must have no unmerged entry. */
export async function checkoutState(git, paths) {
  return { head: await headOid(git), index: text(await git(['write-tree'])), files: await worktreeTree(git, paths) };
}

/**
 * Turns the worktree's `paths` from `fromFiles` (a tree they must still match) into `to.files`, then the index into
 * `to.index`; HEAD is not touched. On a temporary index: `read-tree <fromFiles>`, `update-index --refresh` (exit 1: a
 * file no longer matches → UNDO_STALE), `read-tree -m -u <fromFiles> <to.files>` (changed paths written with their modes
 * and symlinks, removed ones deleted with their emptied directories, an untracked file in the way refused), then
 * emptied. The real index is replaced last with `read-tree` (no `-u`).
 */
export async function writeCheckoutState(git, fromFiles, to) {
  const index = decoder.decode((await git(['rev-parse', '--git-path', UNDO_INDEX])).stdout).replace(/\n$/, '');
  const tmp = { env: { GIT_INDEX_FILE: index } };
  try {
    await git(['read-tree', '--end-of-options', fromFiles], tmp);
    const fresh = await git(['update-index', '--refresh'], { ...tmp, okExit: [0, 1] });
    if (fresh.exitCode !== 0) throw new Refusal('UNDO_STALE', 'cannot undo: a file changed since');
    await git(['read-tree', '-m', '-u', '--end-of-options', fromFiles, to.files], tmp);
  } finally {
    await git(['read-tree', '--empty'], { ...tmp, okExit: [0, 128] });
  }
  await git(['read-tree', '--end-of-options', to.index]);
}
