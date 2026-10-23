import { Refusal } from '../../refusals.js';

// Version floors checked on the project's own System, where the git that will run lives.

const decoder = new TextDecoder('utf-8', { fatal: false });

/** Refuses GIT_TOO_OLD ({feature, need, have}) when `git version` is below `[major, minor]` or does not parse (have: null). */
export async function assertGitAtLeast(git, [major, minor], feature) {
  const m = /^git version (\d+)\.(\d+)/.exec(decoder.decode((await git(['version'])).stdout));
  const have = m ? `${m[1]}.${m[2]}` : null;
  const need = `${major}.${minor}`;
  if (m && (Number(m[1]) > major || (Number(m[1]) === major && Number(m[2]) >= minor))) return;
  throw new Refusal('GIT_TOO_OLD', `${feature} needs git ${need} or later${have ? `; this System has ${have}` : ''}`, { feature, need, have });
}
