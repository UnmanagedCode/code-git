import { Refusal } from '../refusals.js';

// Bare repositories. BASE_ARGS pins `--work-tree=.`, under which git treats a bare repository's own files (HEAD,
// config, objects/) as a working tree; its `core.bare` still says what it is.

const decoder = new TextDecoder('utf-8', { fatal: false });

/** Whether the repository is bare (`core.bare=true`); a bad value fails as GIT_FAILED. */
export async function isBare(git) {
  const r = await git(['config', '--bool', '--get', 'core.bare'], { okExit: [0, 1] });
  return r.exitCode === 0 && decoder.decode(r.stdout).trim() === 'true';
}

export const bareRefusal = () => new Refusal('BARE_REPO', 'a bare repository has no working tree: code-git does not open it');

/** Refuses BARE_REPO before an op writes the working tree or the index. */
export async function assertWorktree(git) {
  if (await isBare(git)) throw bareRefusal();
}
