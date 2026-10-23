// The identity code-git's own stash commits are made with (line stashes, renames). `git stash` falls back to
// "git stash <git@stash>" when no identity is configured; commit-tree would refuse instead, so the same fallback is set here.

const FALLBACK = { name: 'git stash', email: 'git@stash' };

/** {} when git has a committer identity; otherwise git stash's fallback as GIT_AUTHOR_* / GIT_COMMITTER_* env. */
export async function identEnv(git) {
  const r = await git(['var', 'GIT_COMMITTER_IDENT'], { okExit: [0, 128] });
  if (r.exitCode === 0) return {};
  return {
    GIT_AUTHOR_NAME: FALLBACK.name, GIT_AUTHOR_EMAIL: FALLBACK.email,
    GIT_COMMITTER_NAME: FALLBACK.name, GIT_COMMITTER_EMAIL: FALLBACK.email,
  };
}
