import { assertCcAck, isCcOwned } from '../../refs/heads.js';
import { assertNoSymref } from '../../refs/resolve.js';
import { shortRef, stale } from './shared.js';

// `rename`: a branch renamed back (undo) or again (redo) with `branch -m`, so its config and every HEAD on it follow,
// under branch.rename's own guards (docs/undo.md → Steps).

const ends = (step, dir) => (dir === 'undo' ? { cur: step.to, next: step.from } : { cur: step.from, next: step.to });

async function preflight(git, step, dir, ctx) {
  const { cur, next } = ends(step, dir);
  const now = await ctx.refNow(cur);
  if (now === null || now.symref || now.oid !== step.oid) throw stale(`${shortRef(cur)} is no longer at ${step.oid.slice(0, 7)}`);
  if (await ctx.refNow(next) !== null) throw stale(`${shortRef(next)} exists again`);
  await assertNoSymref(git, next);
  // As branch.rename: another checkout's branch never; a checked-out cc branch not even in this checkout.
  ctx.assertNotCheckedOut(cur, { allowOwn: !isCcOwned(shortRef(cur)) });
  assertCcAck([shortRef(cur), shortRef(next)], ctx.ccOwned);
  ctx.setRef(cur, null);
  ctx.setRef(next, { oid: step.oid, symref: null });
  if (ctx.head.branch === cur) ctx.head = { ...ctx.head, branch: next };
}

async function apply(git, step, dir) {
  const { cur, next } = ends(step, dir);
  await git(['branch', '-m', '--end-of-options', shortRef(cur), shortRef(next)]);
}

export const rename = { kind: 'rename', preflight, apply };
