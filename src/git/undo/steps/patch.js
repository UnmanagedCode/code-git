import { assertNotBlocked } from '../../stash/guard.js';
import { assertWorktree } from '../../worktree.js';
import { stale } from './shared.js';

// `patch`: lines an op took out of one file with `apply -R` (stage.discardLines, stash.pushLines), applied back (undo:
// forward) or taken out again (redo: `-R`); or, with `forward: true`, a patch the op applied forward (stash.applyFile),
// reversed (undo) or applied again (redo). The worktree only, with the ops' own whitespace overrides (docs/undo.md → Steps).

const APPLY = ['apply', '--whitespace=nowarn', '--no-ignore-whitespace'];
const args = (step, dir) => [...APPLY, ...((dir === 'undo') === Boolean(step.forward) ? ['-R'] : [])];

async function preflight(git, step, dir) {
  await assertWorktree(git);
  await assertNotBlocked(git, [step.path]);
  const r = await git([...args(step, dir), '--check', '-'], { stdin: Buffer.from(step.patchB64, 'base64'), okExit: [0, 1] });
  if (r.exitCode !== 0) throw stale(`${step.path} changed since`);
}

async function apply(git, step, dir) {
  await git([...args(step, dir), '-'], { stdin: Buffer.from(step.patchB64, 'base64') });
}

export const patch = { kind: 'patch', preflight, apply };
