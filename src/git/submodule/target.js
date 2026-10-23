import { Refusal } from '../../refusals.js';
import { runGit } from '../runner.js';

// The containment preflight of an op run in a submodule tab, before the op's own commands.

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Refuses an op whose `ctx.target.sub` is not a cloned submodule directly inside the checkout: SUBMODULE_NOT_POPULATED
 * when the chain's directory has no repository of its own (or does not exist), SUBMODULE_UNSAFE `{reason: 'escapes'}`
 * when its real path is not the checkout's top level plus the chain (git realpaths the working tree, so a symlinked
 * component anywhere in the chain differs). The whole outputs are compared, never split (a path may hold a newline).
 * Two reads under `ctx`'s op run; no lock.
 */
export async function assertInsideCheckout(ctx) {
  const { sub, ...root } = ctx.target;
  const read = { ...ctx, kind: 'read' };
  const top = await runGit({ ...read, target: root }, ['rev-parse', '--show-toplevel']);
  const inner = await runGit(read, ['rev-parse', '--show-toplevel'], { okExit: [0, 128] });
  const where = sub.join('/');
  if (inner.exitCode === 128) throw new Refusal('SUBMODULE_NOT_POPULATED', `${where} is not a cloned submodule: initialize and update it first`, { path: where });
  const expected = `${decoder.decode(top.stdout).replace(/\n$/, '')}/${where}\n`;
  if (decoder.decode(inner.stdout) !== expected) {
    throw new Refusal('SUBMODULE_UNSAFE', `${where} resolves outside the checkout (a symbolic link): code-git does not open it`, { reason: 'escapes', path: where });
  }
}
