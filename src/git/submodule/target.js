import { Refusal } from '../../refusals.js';
import { runGit } from '../runner.js';
import { gitDirMatches } from './gitdir.js';
import { readGitmodules } from './list.js';
import { submoduleName } from './validate.js';

// The containment preflight of an op run in a submodule tab, before the op's own commands.

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const valid = (name) => { try { return !!submoduleName(name); } catch { return false; } };

/**
 * Refuses an op whose `ctx.target.sub` is not a cloned submodule inside the checkout, in that submodule's own repository:
 * - SUBMODULE_NOT_POPULATED when the chain's directory has no repository of its own (or does not exist);
 * - SUBMODULE_UNSAFE `{reason: 'escapes'}` when its real path is not the checkout's top level plus the chain (git
 *   realpaths the working tree, so a symlinked component anywhere in the chain differs);
 * - SUBMODULE_UNSAFE `{reason: 'gitdir'}` when, at any level of the chain, the git dir its `.git` names is not one
 *   gitDirMatches accepts (`<parent git dir>/modules/<name>` for the name the parent's `.gitmodules` declares at that
 *   path, or an embedded `.git`) — a crafted gitfile would otherwise send the op's writes into another repository.
 * Whole outputs are compared, never split (a path may hold a newline). Reads under `ctx`'s op run; no lock.
 */
export async function assertInsideCheckout(ctx) {
  const { sub, ...root } = ctx.target;
  const read = { ...ctx, kind: 'read' };
  const at = (n) => ({ ...read, target: n ? { ...root, sub: sub.slice(0, n) } : root });
  const where = sub.join('/');
  const top = text(await runGit(at(0), ['rev-parse', '--show-toplevel'])).replace(/\n$/, '');
  const inner = await runGit(read, ['rev-parse', '--show-toplevel'], { okExit: [0, 128] });
  if (inner.exitCode === 128) throw new Refusal('SUBMODULE_NOT_POPULATED', `${where} is not a cloned submodule: initialize and update it first`, { path: where });
  if (text(inner) !== `${top}/${where}\n`) {
    throw new Refusal('SUBMODULE_UNSAFE', `${where} resolves outside the checkout (a symbolic link): code-git does not open it`, { reason: 'escapes', path: where });
  }
  let parentGitDir = text(await runGit(at(0), ['rev-parse', '--absolute-git-dir'])).replace(/\n$/, '');
  for (let n = 1; n <= sub.length; n++) {
    const r = await runGit(at(n), ['rev-parse', '--absolute-git-dir'], { okExit: [0, 128] });
    const levelPath = sub.slice(0, n).join('/');
    if (r.exitCode === 128) throw new Refusal('SUBMODULE_NOT_POPULATED', `${levelPath} is not a cloned submodule: initialize and update it first`, { path: levelPath });
    const names = (await readGitmodules((args, opts) => runGit(at(n - 1), args, opts)))
      .filter((e) => e.path === sub[n - 1] && valid(e.name)).map((e) => e.name);
    if (!gitDirMatches(text(r), parentGitDir, `${top}/${levelPath}`, names)) {
      throw new Refusal('SUBMODULE_UNSAFE', `${levelPath}'s .git names another repository's git dir: code-git does not open it`, { reason: 'gitdir', path: levelPath });
    }
    parentGitDir = text(r).slice(0, -1);
  }
}
