import { worktreeTree } from '../../stage/discard.js';
import { assertNotBlocked } from '../../stash/guard.js';
import { headOid, writeCheckoutState } from '../../stash/snapshot.js';
import { assertWorktree } from '../../worktree.js';
import { stale } from './shared.js';

// `worktree`: a stash op's effect on the checkout — the index and the worktree content of its paths — written back
// (undo: `after` → `mid ?? before`) or again (redo: `mid ?? before` → `after`) (docs/undo.md → Steps). `mid` is
// stash.branch's state between its switch and its apply: undo restores it before the head step switches back, and on
// redo the switch produces it. HEAD itself is never moved here.

/** The state the checkout must be in when this direction starts, and the two states the apply writes between. */
function sides(step, dir) {
  const between = step.mid ?? step.before;
  return dir === 'undo' ? { expect: step.after, from: step.after, to: between } : { expect: step.before, from: between, to: step.after };
}

const DIFF_QUIET = ['--quiet', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'];

async function preflight(git, step, dir) {
  const { expect } = sides(step, dir);
  await assertWorktree(git);
  if (await headOid(git) !== expect.head) throw stale('HEAD moved since');
  const index = await git(['diff-index', '--cached', ...DIFF_QUIET, '--end-of-options', expect.index, '--'], { okExit: [0, 1] });
  if (index.exitCode !== 0) throw stale('the index changed since');
  await assertNotBlocked(git, step.paths);
  let files;
  try {
    files = await worktreeTree(git, step.paths);
  } catch (e) {
    // A path that is a directory now: update-index refuses it.
    if (e.code === 'GIT_FAILED') throw stale('a stashed path changed since');
    throw e;
  }
  if (files !== expect.files) throw stale('a stashed file changed since');
}

async function apply(git, step, dir) {
  const { from, to } = sides(step, dir);
  await writeCheckoutState(git, from.files, to);
}

export const worktree = { kind: 'worktree', preflight, apply };
