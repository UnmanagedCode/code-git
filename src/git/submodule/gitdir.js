// Which git dir a submodule may have. Pure.

/**
 * Whether `out` (a submodule's `rev-parse --absolute-git-dir` output: realpathed by git, trailing `\n`) is the git dir
 * git itself gives the submodule — `<parentGitDir>/modules/<name>` for the one name `.gitmodules` declares at its path
 * (`names`; for a cc worktree's submodule `parentGitDir` is the worktree's own git dir, not the common dir) — or its own
 * embedded `<top>/.git`. A gitfile naming any other repository, another submodule's included, fails.
 */
export function gitDirMatches(out, parentGitDir, top, names) {
  if (!out.endsWith('\n')) return false;
  const dir = out.slice(0, -1);
  if (dir === `${top}/.git`) return true;
  return names.length === 1 && dir === `${parentGitDir}/modules/${names[0]}`;
}
