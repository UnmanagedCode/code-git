import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { bad, filePath, FROM_STDIN, nulPaths, paramsObject, pathList } from '../params.js';
import { undoRecord } from '../refs/undo.js';
import { discardGates, discardSnapshot, discardWrites } from '../stage/discard.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { readSelectionPatch, selectionParams } from '../stage/readSelection.js';
import { plans } from '../undo/plans.js';
import { assertWorktree } from '../worktree.js';

// Stage, unstage and discard whole files. Multi-path commands read their paths from stdin
// (`--pathspec-from-file=- --pathspec-file-nul`); `ls-files` and `clean` have no such option, so their paths go after
// `--` in chunks of STAGE_LIMITS.argvChunkBytes. GIT_LITERAL_PATHSPECS=1 (BASE_ENV) applies to both.


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

/**
 * How each line action reads the file's diff and applies the rebuilt patch. stage: index → worktree, forward, onto the
 * index; unstage: HEAD → index, reverse, onto the index; discard: index → worktree, reverse, onto the worktree.
 */
const LINE_ACTIONS = {
  stage: { cached: false, direction: 'forward', apply: ['--cached'] },
  unstage: { cached: true, direction: 'reverse', apply: ['--cached', '-R'] },
  discard: { cached: false, direction: 'reverse', apply: ['-R'] },
};

async function applySelection(git, p, action) {
  await assertWorktree(git);
  const a = LINE_ACTIONS[action];
  let revs = [];
  if (a.cached) {
    const head = await commitOid(git, 'HEAD');
    if (!head) throw new Refusal('PARTIAL_UNSUPPORTED', 'a file with no commit yet can only be unstaged whole');
    revs = ['--cached', '--end-of-options', head];
  }
  const bytes = await readSelectionPatch(git, p, { revs, direction: a.direction });
  // The flags override apply.whitespace / apply.ignoreWhitespace; git checks the context, so a race fails instead of fuzzing.
  await git(['apply', ...a.apply, '--whitespace=nowarn', '--no-ignore-whitespace', '-'], { stdin: bytes });
  return { path: p.path, ...(action === 'discard' ? { patchB64: bytes.toString('base64') } : {}) };
}

export const ops = [
  {
    name: 'stage.files',
    kind: 'write',
    params: (raw) => pathsOrAll(raw, 'stage.files'),
    async run(git, p) {
      await assertWorktree(git);
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
      await assertWorktree(git);
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
      const tracked = pathList(p.tracked ?? [], 'tracked', { min: 0, max: STAGE_LIMITS.maxPaths }).map(filePath);
      const untracked = pathList(p.untracked ?? [], 'untracked', { min: 0, max: STAGE_LIMITS.maxPaths });
      if (!tracked.length && !untracked.length) throw bad('stage.discardFiles needs at least one path');
      if (tracked.length + untracked.length > STAGE_LIMITS.maxPaths) throw bad(`at most ${STAGE_LIMITS.maxPaths} paths`);
      return { tracked, untracked };
    },
    async run(git, p) {
      await assertWorktree(git);
      await discardGates(git, p);
      // What the paths hold now, before anything is removed: the undo restores from it.
      const snapshot = await discardSnapshot(git, [...p.tracked, ...p.untracked]);
      await discardWrites(git, p);
      return { tracked: p.tracked, untracked: p.untracked, undo: undoRecord({ discard: { snapshot, tracked: p.tracked, untracked: p.untracked } }) };
    },
    undo: plans.discardFiles,
  },
  {
    name: 'stage.stageLines',
    kind: 'write',
    params: (raw) => selectionParams(raw, 'stage.stageLines'),
    run: (git, p) => applySelection(git, p, 'stage'),
  },
  {
    name: 'stage.unstageLines',
    kind: 'write',
    params: (raw) => selectionParams(raw, 'stage.unstageLines'),
    run: (git, p) => applySelection(git, p, 'unstage'),
  },
  {
    name: 'stage.discardLines',
    kind: 'write',
    params: (raw) => selectionParams(raw, 'stage.discardLines'),
    run: (git, p) => applySelection(git, p, 'discard'),
    undo: plans.discardLines,
  },
];
