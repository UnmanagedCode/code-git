import { Refusal } from '../../../refusals.js';
import { assertCcHeadAck } from '../../refs/heads.js';
import { guardOverwrite } from '../../refs/write.js';
import { assertClean } from '../../sequence/guard.js';
import { perChunk } from '../../stage/paths.js';
import { assertNotBlocked } from '../../stash/guard.js';
import { assertWorktree } from '../../worktree.js';
import { sameHead, shortRef as short, stale } from './shared.js';

// `head`: HEAD from one {branch, oid} to the other (docs/undo.md → Steps). Modes: soft (a commit, a soft reset: only
// the ref moves), keep (a commit-making op: `reset --keep`, which refuses rather than lose a local change), mixed, hard
// (a confirmed `reset --hard` over a clean tree, then the snapshot back), switch (a checkout).

const decoder = new TextDecoder('utf-8', { fatal: false });
const DIFF_QUIET = ['--quiet', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'];

/** git's one-line refusals from `reset --keep` (LC_ALL=C): a local change, an untracked file in the way. */
const KEEP_REFUSED_RE = /^error: (?:Entry '(.+)' not uptodate\. Cannot merge|Untracked working tree file '(.+)' would be overwritten by merge)\.$/gm;

/** `reset --keep <oid>`: git's refusal over a local change of a file the move would rewrite, or an untracked file in its way → CHECKOUT_CONFLICT. */
async function keepReset(git, oid) {
  try {
    await guardOverwrite(git, ['reset', '--keep', '--end-of-options', oid]);
  } catch (e) {
    const files = e.code === 'GIT_FAILED' ? [...(e.extra.stderr ?? '').matchAll(KEEP_REFUSED_RE)].map((m) => m[1] ?? m[2]) : [];
    if (files.length) throw new Refusal('CHECKOUT_CONFLICT', 'local changes would be overwritten', { files, stderr: e.extra.stderr });
    throw e;
  }
}

/** Whether the index's tree equals `treeish` (`diff-index --cached --quiet`). */
async function indexIs(git, treeish) {
  return (await git(['diff-index', '--cached', ...DIFF_QUIET, '--end-of-options', treeish, '--'], { okExit: [0, 1] })).exitCode === 0;
}

const names = (r) => decoder.decode(r.stdout).split('\0').filter(Boolean);

/** The paths `to` (a tree-ish) has that `from` does not. */
async function added(git, from, to) {
  return names(await git(['diff-tree', '-r', '-z', '--name-only', '--no-renames', '--diff-filter=A', '--end-of-options', from, to]));
}

/**
 * `reset --hard` writes over an untracked file that stands where the target tree has one, and through an untracked
 * symlink standing for a leading directory: both refused first (CHECKOUT_CONFLICT, PATH_BLOCKED).
 */
async function assertHardTargetFree(git, paths) {
  if (!paths.length) return;
  await assertNotBlocked(git, paths);
  const found = await perChunk(git, ['ls-files', '--others', '-z'], paths);
  if (found.length) throw new Refusal('CHECKOUT_CONFLICT', `${found[0]} is not tracked and would be overwritten: move it first`, { files: [...new Set(found)].slice(0, 100) });
}

/** A fresh `stash create` of the tracked changes now: its tree and its index commit's tree, or null when clean. */
async function changesNow(git) {
  const oid = decoder.decode((await git(['stash', 'create'])).stdout).trim();
  if (!oid) return null;
  const r = await git(['rev-parse', `${oid}^{tree}`, `${oid}^2^{tree}`]);
  return decoder.decode(r.stdout).trim().split('\n');
}

async function preflight(git, step, dir, ctx) {
  const from = dir === 'undo' ? step.new : step.old;
  const to = dir === 'undo' ? step.old : step.new;
  if (step.mode !== 'soft') await assertWorktree(git);
  if (!sameHead(ctx.head, from)) throw stale(`HEAD is no longer at ${from.oid?.slice(0, 7) ?? 'its unborn branch'}`);
  assertCcHeadAck(ctx.head, ctx.ccOwned);
  if (step.mode === 'mixed') {
    const expected = dir === 'undo' ? step.new.oid : step.indexTree ?? step.old.oid;
    if (!await indexIs(git, expected)) throw stale('the index changed since');
  }
  if (step.mode === 'hard') {
    const snap = step.snapshot;
    if (dir === 'undo' || !snap) await assertClean(git, 'the working tree has changes a hard reset would discard: commit or stash them first');
    else {
      const now = await changesNow(git);
      const then = decoder.decode((await git(['rev-parse', `${snap}^{tree}`, `${snap}^2^{tree}`])).stdout).trim().split('\n');
      if (!now || now[0] !== then[0] || now[1] !== then[1]) throw stale('the working tree changed since the undo');
    }
    const paths = [...await added(git, from.oid, to.oid), ...(dir === 'undo' && snap ? [...await added(git, to.oid, snap), ...await added(git, to.oid, `${snap}^2`)] : [])];
    await assertHardTargetFree(git, [...new Set(paths)]);
  }
  if (step.mode === 'switch') {
    if (to.branch) {
      const target = await ctx.refNow(to.branch);
      if (target?.symref) throw new Refusal('SYMBOLIC_REF', `${to.branch} is a symbolic ref to ${target.symref}`, { target: target.symref });
      if (target?.oid !== to.oid) throw stale(`${short(to.branch)} is no longer at ${to.oid.slice(0, 7)}`);
      ctx.assertNotCheckedOutElsewhere(to.branch);
    }
  }
  ctx.head = { branch: to.branch, oid: to.oid };
  if (step.mode !== 'switch' && to.branch) ctx.setRef(to.branch, to.oid ? { oid: to.oid, symref: null } : null);
}

async function apply(git, step, dir) {
  const from = dir === 'undo' ? step.new : step.old;
  const to = dir === 'undo' ? step.old : step.new;
  switch (step.mode) {
    case 'soft':
      // An unborn side: the branch ref itself is deleted (undo) or created (redo), compare-and-swap; HEAD stays on it.
      if (to.oid === null) await git(['update-ref', '--no-deref', '-m', `code-git: ${dir}`, '-d', '--end-of-options', to.branch, from.oid]);
      else if (from.oid === null) await git(['update-ref', '--no-deref', '-m', `code-git: ${dir}`, '--end-of-options', to.branch, to.oid, '']);
      else await git(['reset', '--soft', '--end-of-options', to.oid]);
      return;
    case 'keep':
      return keepReset(git, to.oid);
    case 'mixed':
      if (dir === 'undo' && step.indexTree) {
        await git(['reset', '--soft', '--end-of-options', to.oid]);
        await git(['read-tree', '--end-of-options', step.indexTree]);
      } else {
        await git(['reset', '--mixed', '--end-of-options', to.oid]);
      }
      return;
    case 'hard':
      await git(['reset', '--hard', '--end-of-options', to.oid]);
      if (dir === 'undo' && step.snapshot) await git(['stash', 'apply', '-q', '--index', '--end-of-options', step.snapshot]);
      return;
    case 'switch':
      await guardOverwrite(git, to.branch
        ? ['switch', '--no-guess', '--end-of-options', short(to.branch)]
        : ['switch', '--detach', '--end-of-options', to.oid]);
      return;
    default:
      throw new Error(`head step: unknown mode ${step.mode}`);
  }
}

export const head = { kind: 'head', preflight, apply };
