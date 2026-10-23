import { assertNotBlocked } from '../../stash/guard.js';
import { assertWorktree } from '../../worktree.js';
import { stale } from './shared.js';

// `patch`: the lines stage.discardLines took out of one file, applied back (undo: forward) or taken out again (redo:
// `-R`), onto the worktree only, with the op's own whitespace overrides (docs/undo.md → Steps).

const APPLY = ['apply', '--whitespace=nowarn', '--no-ignore-whitespace'];
const args = (dir) => [...APPLY, ...(dir === 'undo' ? [] : ['-R'])];

async function preflight(git, step, dir) {
  await assertWorktree(git);
  await assertNotBlocked(git, [step.path]);
  const r = await git([...args(dir), '--check', '-'], { stdin: Buffer.from(step.patchB64, 'base64'), okExit: [0, 1] });
  if (r.exitCode !== 0) throw stale(`${step.path} changed since`);
}

async function apply(git, step, dir) {
  await git([...args(dir), '-'], { stdin: Buffer.from(step.patchB64, 'base64') });
}

export const patch = { kind: 'patch', preflight, apply };
