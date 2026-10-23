import { Refusal } from '../../refusals.js';
import { perChunk } from '../stage/paths.js';

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

/**
 * PATH_BLOCKED ({paths}) when a leading directory of `paths` is not a directory git tracks or could create: an untracked
 * (or ignored) symlink or file stands there. Writing `d/x` through an untracked symlink `d` is how `git apply --index`
 * — which `stash push -- <paths>` runs internally — reaches outside the repo. `ls-files --others --directory` lists such
 * an entry as the prefix itself, an untracked directory as `prefix/`, and descends into a tracked one.
 */
export async function assertNotBlocked(git, paths) {
  const dirs = leadingDirs(paths);
  if (!dirs.length) return;
  const wanted = new Set(dirs);
  const found = (await perChunk(git, ['ls-files', '--others', '--directory', '-z'], dirs)).filter((e) => wanted.has(e));
  if (found.length) throw new Refusal('PATH_BLOCKED', `${found[0]} is not a directory git can write into (an untracked symlink or file?): move it first`, { paths: found.slice(0, 100) });
}

/** CONFLICTED when the index has unmerged entries: a stash save or apply needs a resolved index. */
export async function assertNoUnmerged(git) {
  const r = await git(['ls-files', '-u', '-z']);
  if (r.stdout.length) throw new Refusal('CONFLICTED', 'the index has unresolved conflicts: resolve them first');
}
