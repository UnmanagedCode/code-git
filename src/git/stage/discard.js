import { Refusal } from '../../refusals.js';
import { chunkPaths, FROM_STDIN, nulPaths } from '../params.js';
import { identEnv } from '../stash/ident.js';
import { OID_RE } from '../validate.js';
import { STAGE_LIMITS } from './limits.js';
import { assertNothingUntrackedUnder, perChunk } from './paths.js';

// Discarding whole files, shared by stage.discardFiles and its redo (docs/undo.md → Steps): the gates, the snapshot an
// undo restores from, and the writes.

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout).trim();
/** The temporary index the snapshot is built in, under the checkout's git dir (`rev-parse --git-path`). */
const SNAPSHOT_INDEX = 'code-git-discard-index';

/** Every path must be a file in the index (a directory or `.` would restore everything under it): BAD_PATH otherwise. */
async function assertIndexFiles(git, paths) {
  const listed = new Set(await perChunk(git, ['ls-files', '-c', '-z'], paths));
  const missing = paths.find((p) => !listed.has(p));
  if (missing !== undefined) throw new Refusal('BAD_PATH', `${missing} is not a file in the index`);
}

/** Refuses CONFLICTED when any of `paths` is unmerged: restoring it would throw away the merge state. */
async function assertNotConflicted(git, paths) {
  const unmerged = await perChunk(git, ['ls-files', '-u', '-z'], paths);
  if (unmerged.length) {
    const path = unmerged[0].slice(unmerged[0].indexOf('\t') + 1);
    throw new Refusal('CONFLICTED', `${path} has a merge conflict: resolve it first`);
  }
}

/**
 * Every path must be one git itself lists as untracked and not ignored — so `clean` can never delete an ignored or tracked
 * file, or reach through a symlinked directory. A nested repository (`dir/`) is refused before asking.
 */
async function assertUntracked(git, paths) {
  const dir = paths.find((p) => p.endsWith('/'));
  if (dir) throw new Refusal('BAD_PATH', `${dir} is a directory (a nested repository?): it is never discarded`);
  const listed = new Set(await perChunk(git, ['ls-files', '--others', '--exclude-standard', '-z'], paths));
  const wanted = new Set(paths);
  const stray = paths.find((p) => !listed.has(p)) ?? [...listed].find((p) => !wanted.has(p));
  if (stray !== undefined) throw new Refusal('BAD_PATH', `${stray} is not an untracked file`);
}

/** The discard's gates, all before anything is changed, so a refused request discards nothing. */
export async function discardGates(git, { tracked, untracked }) {
  if (tracked.length) await assertIndexFiles(git, tracked);
  if (tracked.length) await assertNotConflicted(git, tracked);
  if (tracked.length) await assertNothingUntrackedUnder(git, tracked);
  if (untracked.length) await assertUntracked(git, untracked);
}

/** The discard's writes: tracked files back to their index content, untracked files deleted (no -d, no -x). */
export async function discardWrites(git, { tracked, untracked }) {
  if (tracked.length) await git(['restore', '--worktree', ...FROM_STDIN], { stdin: nulPaths(tracked) });
  for (const chunk of chunkPaths(untracked, STAGE_LIMITS.argvChunkBytes)) await git(['clean', '-f', '-q', '--', ...chunk]);
}

/** Gates, then writes: what stage.discardFiles does after its snapshot, and what its redo does. */
export async function discardPaths(git, p) {
  await discardGates(git, p);
  await discardWrites(git, p);
}

/**
 * The tree of `paths` as they are in the worktree — content, mode and symlinks; a missing path is left out — built in a
 * temporary index (`read-tree --empty`, `update-index --add --remove`, `write-tree`), which is emptied afterwards (git
 * cannot delete the file: no filesystem access here). The real index is never touched.
 */
export async function worktreeTree(git, paths) {
  const index = decoder.decode((await git(['rev-parse', '--git-path', SNAPSHOT_INDEX])).stdout).replace(/\n$/, '');
  const tmp = { env: { GIT_INDEX_FILE: index } };
  try {
    await git(['read-tree', '--empty'], tmp);
    await git(['update-index', '--add', '--remove', '-z', '--stdin'], { ...tmp, stdin: nulPaths(paths) });
    const tree = text(await git(['write-tree'], tmp));
    if (!OID_RE.test(tree)) throw new Refusal('GIT_FAILED', 'git write-tree printed no tree for the discard snapshot');
    return tree;
  } finally {
    await git(['read-tree', '--empty'], { ...tmp, okExit: [0, 128] });
  }
}

/** A dangling commit of `worktreeTree(paths)`: what an undo of the discard restores from (until gc). */
export async function discardSnapshot(git, paths) {
  const tree = await worktreeTree(git, paths);
  const env = await identEnv(git);
  const commit = text(await git(['commit-tree', '--no-gpg-sign', '-F', '-', tree], { stdin: 'code-git: discarded changes\n', env }));
  if (!OID_RE.test(commit)) throw new Refusal('GIT_FAILED', 'git commit-tree printed no commit for the discard snapshot');
  return commit;
}
