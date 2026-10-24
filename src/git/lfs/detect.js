import { Refusal } from '../../refusals.js';
import { LFS_FLOOR, parseLfsVersion } from './parse.js';

// Whether the project's System has a usable git-lfs. `git lfs version` is the one git-lfs command that writes nothing.

const decoder = new TextDecoder('utf-8', { fatal: false });
const NEED = LFS_FLOOR.join('.');

/**
 * {available, version: string | null, supported}. git's "'lfs' is not a git command" (exit 1, LC_ALL=C) is
 * `available: false`; any other failure is GIT_FAILED, and a version line that does not parse too.
 */
export async function lfsVersion(git) {
  const r = await git(['lfs', 'version'], { okExit: [0, 1] });
  if (r.exitCode === 1) {
    const stderr = decoder.decode(r.stderr);
    if (stderr.includes("'lfs' is not a git command")) return { available: false, version: null, supported: false };
    throw new Refusal('GIT_FAILED', 'git lfs version exited with 1', { exitCode: 1, stderr });
  }
  return { available: true, ...parseLfsVersion(decoder.decode(r.stdout)) };
}

/** The gate before every LFS write: LFS_UNAVAILABLE when git-lfs is absent, GIT_TOO_OLD ({feature, need, have}) below the floor. */
export async function assertLfs(git) {
  const v = await lfsVersion(git);
  if (!v.available) throw new Refusal('LFS_UNAVAILABLE', "git-lfs is not installed on this project's System");
  if (!v.supported) {
    throw new Refusal('GIT_TOO_OLD', `git-lfs features need git-lfs ${NEED} or later; this System has ${v.version}`, { feature: 'git-lfs', need: NEED, have: v.version });
  }
}
