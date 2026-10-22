import { Refusal } from '../refusals.js';

// Bare repositories. BASE_ARGS pins `--work-tree=.`, under which git treats a bare repository's own files (HEAD,
// config, hooks/, objects/) as a working tree. Bareness is decided from where the git dir is, never from config:
// `core.bare` is the repository's to set (directly or through an [include]), so it cannot be trusted to refuse.

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Whether the checkout is a bare repository: its git dir is the working tree itself. True for core.bare true, false or
 * unset; false for a normal repo (git dir `.git` below it), a linked worktree and a `--separate-git-dir` clone.
 * Outside a repository git exits 128 ("not a git repository"): GIT_FAILED, which repo.summary maps to NOT_A_REPO.
 */
export async function isBare(git) {
  const r = await git(['rev-parse', '--absolute-git-dir', '--show-toplevel']);
  const [gitDir, top] = decoder.decode(r.stdout).split('\n');
  return gitDir === top;
}

export const bareRefusal = () => new Refusal('BARE_REPO', 'a bare repository has no working tree: code-git does not open it');

/** Refuses BARE_REPO before an op writes the working tree or the index. */
export async function assertWorktree(git) {
  if (await isBare(git)) throw bareRefusal();
}
