import { Refusal } from '../../refusals.js';
import { worktreeEntry } from '../diff/noIndex.js';
import { perChunk } from '../stage/paths.js';
import { STASH_LIMITS } from './limits.js';

// Gates every stash op that writes the worktree runs before git does (wiki: gotchas/stash).

/** Every proper leading directory of `paths` (`a/b/c` → `a`, `a/b`), once each. */
export function leadingDirs(paths) {
  const out = new Set();
  for (const p of paths) {
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) out.add(segs.slice(0, i).join('/'));
  }
  return [...out];
}

const decoder = new TextDecoder('utf-8', { fatal: false });
/** ASCII case folding, as git's own (`core.ignorecase` compares with tolower). */
const fold = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const parentOf = (dir) => (dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '.');

/** Whether the repo says its filesystem ignores case (`core.ignorecase`, set by git at init). */
async function ignoresCase(git) {
  // 128: a value that is not a boolean (`auto`): git itself then treats the filesystem as case-sensitive.
  const r = await git(['config', '--type=bool', '--get', 'core.ignorecase'], { okExit: [0, 1, 128] });
  return r.exitCode === 0 && decoder.decode(r.stdout).trim() === 'true';
}

const blocked = (found) => new Refusal('PATH_BLOCKED', `${found[0]} is not a directory git can write into (an untracked symlink or file?): move it first`, { paths: found.slice(0, 100) });

/**
 * PATH_BLOCKED ({paths}) when a leading directory of `paths` is not a directory git tracks or could create: an untracked
 * (or ignored) symlink or file stands there. Writing `d/x` through an untracked symlink `d` is how `git apply --index`
 * — which `stash push -- <paths>` runs internally — reaches outside the repo. `ls-files --others --directory` lists such
 * an entry as the prefix itself, an untracked directory as `prefix/`, and descends into a tracked one.
 * With `core.ignorecase` the comparison folds case, and each leading directory's parent is listed too (literal
 * pathspecs cannot be made case-insensitive: git refuses GIT_LITERAL_PATHSPECS with GIT_ICASE_PATHSPECS), so the entry
 * is seen in whatever case it has on disk. The directories themselves stay queried: a parent's listing names a fully
 * untracked directory as `u/` and nothing under it.
 */
export async function assertNotBlocked(git, paths) {
  const dirs = leadingDirs(paths);
  if (!dirs.length) return;
  const icase = await ignoresCase(git);
  const key = icase ? fold : (s) => s;
  const wanted = new Set(dirs.map(key));
  const list = (query) => perChunk(git, ['ls-files', '--others', '--directory', '-z'], query, { maxOutputBytes: STASH_LIMITS.pathsMaxOutputBytes });
  const listed = await list(dirs);
  if (icase) {
    const parents = [...new Set(dirs.map(parentOf))];
    listed.push(...await list(parents.includes('.') ? ['.'] : parents));
  }
  const found = [...new Set(listed.filter((e) => wanted.has(key(e))))];
  if (found.length) throw blocked(found);
}

/**
 * PATH_BLOCKED when `path` itself is a directory or a link to one: what a patch naming the file cannot change in place.
 * For the ops that write one named file (stash.applyFile, stash.pushLines): the final component, which
 * assertNotBlocked's leading directories do not cover. A symlink to a file passes: `git apply` replaces or deletes the
 * link itself, never writing through it.
 */
export async function assertFileTarget(git, path) {
  if ((await worktreeEntry(git, path)).kind === 'other') throw blocked([path]);
}

/** CONFLICTED when the index has unmerged entries: a stash save or apply needs a resolved index. */
export async function assertNoUnmerged(git) {
  const r = await git(['ls-files', '-u', '-z']);
  if (r.stdout.length) throw new Refusal('CONFLICTED', 'the index has unresolved conflicts: resolve them first');
}

/**
 * CHECKOUT_CONFLICT ({files}) when any of a stash's untracked paths exists in the worktree or the index. `stash apply`
 * restores the untracked part with a checkout that skips ("already exists, no checkout") an existing file and writes the
 * rest, after the tracked part was merged: checking first is what keeps a refused apply from writing half of it.
 */
export async function assertNoUntrackedCollision(git, untracked) {
  if (!untracked.length) return;
  const found = await perChunk(git, ['ls-files', '-c', '-o', '-z'], untracked);
  if (found.length) throw new Refusal('CHECKOUT_CONFLICT', `${found[0]} already exists: the stash's untracked files would overwrite it`, { files: [...new Set(found)].slice(0, 100) });
}
