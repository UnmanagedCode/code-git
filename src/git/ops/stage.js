import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { bad, chunkPaths, nulPaths, paramsObject, pathList } from '../params.js';
import { STAGE_LIMITS } from '../stage/limits.js';

// Stage, unstage and discard whole files. Multi-path commands read their paths from stdin
// (`--pathspec-from-file=- --pathspec-file-nul`); `ls-files` and `clean` have no such option, so their paths go after
// `--` in chunks of STAGE_LIMITS.argvChunkBytes. GIT_LITERAL_PATHSPECS=1 (BASE_ENV) applies to both.

const decoder = new TextDecoder('utf-8', { fatal: false });
const FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'];
const nulFields = (r) => decoder.decode(r.stdout).split('\0').filter(Boolean);

/** `{paths}` or `{all: true}`, exactly one. */
function pathsOrAll(raw, op) {
  const p = paramsObject(raw, ['paths', 'all'], op);
  if ((p.all === undefined) === (p.paths === undefined)) throw bad(`${op} takes exactly one of paths and all`);
  if (p.all !== undefined) {
    if (p.all !== true) throw bad('all must be true');
    return { all: true, paths: null };
  }
  return { all: false, paths: pathList(p.paths, 'paths', { max: STAGE_LIMITS.maxPaths }) };
}

/** Runs `args -- <chunk>` once per chunk of `paths`; resolves every run's NUL-separated output fields. */
async function perChunk(git, args, paths, opts) {
  const out = [];
  for (const chunk of chunkPaths(paths, STAGE_LIMITS.argvChunkBytes)) out.push(...nulFields(await git([...args, '--', ...chunk], opts)));
  return out;
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

export const ops = [
  {
    name: 'stage.files',
    kind: 'write',
    params: (raw) => pathsOrAll(raw, 'stage.files'),
    async run(git, p) {
      if (p.all) await git(['add', '-A']);
      else await git(['add', '-A', ...FROM_STDIN], { stdin: nulPaths(p.paths) });
      return { paths: p.paths };
    },
  },
  {
    name: 'stage.unstageFiles',
    kind: 'write',
    params: (raw) => pathsOrAll(raw, 'stage.unstageFiles'),
    async run(git, p) {
      // An unborn HEAD has nothing to reset to: unstaging removes the entries from the index.
      const born = (await commitOid(git, 'HEAD')) !== null;
      if (born) {
        if (p.all) await git(['reset', '-q']);
        else await git(['reset', '-q', ...FROM_STDIN], { stdin: nulPaths(p.paths) });
      } else if (p.all) {
        await git(['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', '.']);
      } else {
        await git(['rm', '--cached', '-r', '-q', '--ignore-unmatch', ...FROM_STDIN], { stdin: nulPaths(p.paths) });
      }
      return { paths: p.paths };
    },
  },
  {
    name: 'stage.discardFiles',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['tracked', 'untracked'], 'stage.discardFiles');
      const tracked = pathList(p.tracked ?? [], 'tracked', { min: 0, max: STAGE_LIMITS.maxPaths });
      const untracked = pathList(p.untracked ?? [], 'untracked', { min: 0, max: STAGE_LIMITS.maxPaths });
      if (!tracked.length && !untracked.length) throw bad('stage.discardFiles needs at least one path');
      if (tracked.length + untracked.length > STAGE_LIMITS.maxPaths) throw bad(`at most ${STAGE_LIMITS.maxPaths} paths`);
      return { tracked, untracked };
    },
    async run(git, p) {
      // Both gates run before anything is changed, so a refused request discards nothing.
      if (p.tracked.length) await assertNotConflicted(git, p.tracked);
      if (p.untracked.length) await assertUntracked(git, p.untracked);
      if (p.tracked.length) await git(['restore', '--worktree', ...FROM_STDIN], { stdin: nulPaths(p.tracked) });
      // No -d (directories) and no -x (ignored files).
      for (const chunk of chunkPaths(p.untracked, STAGE_LIMITS.argvChunkBytes)) await git(['clean', '-f', '-q', '--', ...chunk]);
      return { tracked: p.tracked, untracked: p.untracked };
    },
  },
];
