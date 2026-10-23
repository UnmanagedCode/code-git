import { Refusal } from '../../../refusals.js';
import { assertCcAck } from '../../refs/heads.js';
import { refObjects } from '../../refs/resolve.js';
import { assertRefName } from '../../validate.js';
import { shortRef, stale } from './shared.js';

// `refs`: branches and tags put back to their other value (docs/undo.md → Steps). Every plain ref changes in one
// `update-ref --stdin -z` transaction, each line a compare-and-swap, so one ref that moved since writes nothing.

const HEADS = 'refs/heads/';

/**
 * A full refname (`refs/<valid name>`): what an upstream must be before it reaches git. Any namespace — a remote's fetch
 * refspec may map its branches anywhere (`refs/other/*`); git itself refuses one it will not track (a tag).
 */
function isFullRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('refs/')) return false;
  try { assertRefName(ref.slice('refs/'.length)); return true; } catch { return false; }
}
/** git's words when a transaction's compare-and-swap misses (LC_ALL=C). */
const CAS_RE = /but expected|reference already exists|unable to resolve reference|reference is missing/;

/** One change seen from `dir`: `from` is what the ref must hold now, `to` what it gets; a symbolic ref's side is {symref}. */
function sides(change, dir) {
  if (change.symref) {
    const link = { symref: change.symref };
    return dir === 'undo' ? { from: null, to: link } : { from: link, to: null };
  }
  const oid = (v) => (v === null ? null : { oid: v });
  return dir === 'undo' ? { from: oid(change.new), to: oid(change.old) } : { from: oid(change.old), to: oid(change.new) };
}

/** Whether `now` (a ref's projected value) is `want` (an oid side, a symref side, or null = absent). */
function holds(now, want) {
  if (want === null) return now === null;
  if (want.symref) return now?.symref === want.symref;
  return now !== null && !now.symref && now.oid === want.oid;
}

async function preflight(git, step, dir, ctx) {
  const moved = [];
  for (const change of step.refs) {
    const { from, to } = sides(change, dir);
    const now = await ctx.refNow(change.ref);
    if (!holds(now, from)) {
      if (now?.symref && !from?.symref) throw new Refusal('SYMBOLIC_REF', `${change.ref} is a symbolic ref to ${now.symref}`, { target: now.symref });
      throw stale(`${shortRef(change.ref)} changed since`);
    }
    // A branch this step deletes or moves must be checked out nowhere (this checkout as it will be by then included).
    if (from !== null && change.ref.startsWith(HEADS)) {
      ctx.assertNotCheckedOut(change.ref);
      moved.push(shortRef(change.ref));
    }
    ctx.setRef(change.ref, to === null ? null : to.symref ? { oid: null, symref: to.symref } : { oid: to.oid, symref: null });
  }
  assertCcAck(moved, ctx.ccOwned);
}

/** The transaction's lines for the plain refs (a symbolic ref is created or deleted on its own). */
function transaction(step, dir) {
  const lines = ['start'];
  for (const change of step.refs) {
    if (change.symref) continue;
    const { from, to } = sides(change, dir);
    if (from === null) lines.push(`create ${change.ref}`, to.oid);
    else if (to === null) lines.push(`delete ${change.ref}`, from.oid);
    else lines.push(`update ${change.ref}`, to.oid, from.oid);
  }
  return lines.length > 1 ? `${[...lines, 'prepare', 'commit'].join('\0')}\0` : null;
}

async function apply(git, step, dir, ctx) {
  const stdin = transaction(step, dir);
  if (stdin) {
    try {
      await git(['update-ref', '--no-deref', '-m', `code-git: ${dir}`, '--stdin', '-z'], { stdin });
    } catch (e) {
      if (e.code === 'GIT_FAILED' && CAS_RE.test(e.extra.stderr ?? '')) throw new Refusal('UNDO_STALE', 'cannot undo: a ref changed since', { stderr: e.extra.stderr });
      throw e;
    }
  }
  for (const change of step.refs) {
    const { from, to } = sides(change, dir);
    if (change.symref) {
      if (to) await git(['symbolic-ref', '-m', `code-git: ${dir}`, '--end-of-options', change.ref, to.symref]);
      else await git(['symbolic-ref', '--delete', '--end-of-options', change.ref]);
      continue;
    }
    if (!change.ref.startsWith(HEADS)) continue;
    const name = shortRef(change.ref);
    // `branch -d` removes a branch's config section; so does deleting it here (its upstream left behind would be
    // inherited by a later branch of that name). Exit 128: there was none.
    if (to === null) await git(['config', '--remove-section', `branch.${name}`], { okExit: [0, 128] });
    if (from === null && change.upstream) await restoreUpstream(git, name, change.upstream, ctx);
  }
}

/**
 * Sets a restored branch's upstream again. The value is repo config (`%(upstream)`), so only a full refname reaches
 * git; and the ref is already restored by now, so anything that keeps the upstream from being set — gone, or refused
 * by `--set-upstream-to` (a tag, a remote no longer configured) — is a warning, never a failure of the undo.
 */
async function restoreUpstream(git, name, upstream, ctx) {
  if (!isFullRef(upstream)) {
    ctx.warnings.push(`${name}'s upstream ${upstream} is not a ref name: not set`);
    return;
  }
  if (!(await refObjects(git, [upstream])).has(upstream)) {
    ctx.warnings.push(`${name}'s upstream ${upstream} no longer exists: not set`);
    return;
  }
  try {
    await git(['branch', `--set-upstream-to=${upstream}`, '--end-of-options', name]);
  } catch (e) {
    if (e.code !== 'GIT_FAILED') throw e;
    const why = (e.extra.stderr ?? '').trim().split('\n').at(-1) || e.message;
    ctx.warnings.push(`${name}'s upstream ${upstream} could not be set: ${why}`);
  }
}

export const refs = { kind: 'refs', preflight, apply };
