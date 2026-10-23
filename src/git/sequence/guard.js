import { Refusal } from '../../refusals.js';
import { parseStatus } from '../parse/status.js';
import { operationState } from './state.js';

// Gates the ops that start a merge, rebase, revert, cherry-pick or pull run before git does.

const decoder = new TextDecoder('utf-8', { fatal: false });
const FILES_SHOWN = 100;

/**
 * OPERATION_IN_PROGRESS ({operation: kind}) while a merge, rebase, cherry-pick or revert is in progress; CONFLICTED
 * ({files}) while the index has unmerged entries with none (a squash merge, a stash apply). Resolves the state read.
 */
export async function assertNoOperation(git) {
  const s = await operationState(git);
  if (s.operation) {
    throw new Refusal('OPERATION_IN_PROGRESS', `a ${s.operation.kind} is in progress: continue or abort it first`, { operation: s.operation.kind });
  }
  if (s.conflicts.length) {
    throw new Refusal('CONFLICTED', 'the index has unresolved conflicts: resolve them first', { files: s.conflicts.slice(0, FILES_SHOWN).map((c) => c.path) });
  }
  return s;
}

/** DIRTY_WORKTREE when the index or a tracked file differs from HEAD (untracked files do not count). */
export async function assertClean(git, message = 'commit or stash the local changes first: a rebase needs a clean working tree') {
  const r = await git(['status', '--porcelain=v2', '-z', '--untracked-files=no']);
  const { counts } = parseStatus(decoder.decode(r.stdout));
  if (counts.staged + counts.unstaged + counts.conflicted) throw new Refusal('DIRTY_WORKTREE', message);
}
