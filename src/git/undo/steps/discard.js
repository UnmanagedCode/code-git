import { chunkPaths, FROM_STDIN, nulPaths } from '../../params.js';
import { discardGates, discardPaths, worktreeTree } from '../../stage/discard.js';
import { STAGE_LIMITS } from '../../stage/limits.js';
import { perChunk } from '../../stage/paths.js';
import { assertNotBlocked } from '../../stash/guard.js';
import { assertWorktree } from '../../worktree.js';
import { stale } from './shared.js';

// `discard`: whole files discarded by stage.discardFiles, put back from the snapshot commit taken before (undo), or
// discarded again (redo) (docs/undo.md → Steps). Never `apply --index`: `restore --source --worktree` writes the worktree only.

const decoder = new TextDecoder('utf-8', { fatal: false });

async function preflight(git, step, dir) {
  await assertWorktree(git);
  const all = [...step.tracked, ...step.untracked];
  if (dir === 'undo') {
    // As the discard left them: each tracked file as its index has it, each untracked one gone.
    // `diff` has no --pathspec-from-file: argv chunks, as ls-files.
    for (const chunk of chunkPaths(step.tracked, STAGE_LIMITS.argvChunkBytes)) {
      const r = await git(['diff', '--quiet', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--', ...chunk], { okExit: [0, 1] });
      if (r.exitCode === 1) throw stale('a discarded file was changed since');
    }
    if (step.untracked.length) {
      const there = await perChunk(git, ['ls-files', '-c', '-o', '-z'], step.untracked);
      if (there.length) throw stale(`${there[0]} exists again`);
    }
    await assertNotBlocked(git, all);
    return;
  }
  // Redo: the files hold exactly what the undo put back, and the discard's own gates pass.
  const tree = await worktreeTree(git, all);
  const snap = decoder.decode((await git(['rev-parse', `${step.snapshot}^{tree}`])).stdout).trim();
  if (tree !== snap) throw stale('a file changed since the undo');
  await discardGates(git, step);
}

async function apply(git, step, dir) {
  if (dir === 'undo') {
    await git(['restore', `--source=${step.snapshot}`, '--worktree', ...FROM_STDIN], { stdin: nulPaths([...step.tracked, ...step.untracked]) });
  } else {
    await discardPaths(git, step);
  }
}

export const discard = { kind: 'discard', preflight, apply };
