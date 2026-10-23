import { Refusal } from '../../refusals.js';
import { ownHead, readHeads } from '../refs/heads.js';
import { refEntries, symbolicTarget } from '../refs/resolve.js';
import { assertNoOperation } from '../sequence/guard.js';
import { assertNotPushed } from './pushed.js';
import { STEPS } from './steps/index.js';

// Runs an UndoPlan one way (docs/undo.md → Running a plan). Every step's preflight runs before any step applies, so a
// refused undo changes nothing. Preflights see the checkout as the earlier steps will have left it (the projection
// below): a plan's second step may expect a branch its first step creates, or a HEAD its first step moves.

/**
 * The checkout as the steps see it while preflighting: `head` (this checkout's HEAD, projected), `refNow(ref)` (a
 * ref's projected {oid, symref} or null; a dangling symbolic ref reads {oid: null, symref}), `setRef`, the checked-out
 * asserts, `ccOwned`, and `warnings` the applies may add to.
 */
async function projection(git, ccOwned) {
  const [own, heads] = await Promise.all([ownHead(git), readHeads(git)]);
  const projected = new Map();
  const ctx = {
    ccOwned,
    head: own,
    warnings: [],
    async refNow(ref) {
      if (projected.has(ref)) return projected.get(ref);
      const entry = (await refEntries(git, [ref])).get(ref);
      if (entry) return entry;
      const target = await symbolicTarget(git, ref);
      return target ? { oid: null, symref: target } : null;
    },
    setRef(ref, value) { projected.set(ref, value); },
    /** BRANCH_CHECKED_OUT when another checkout has `ref` (this one is judged by its projected HEAD). */
    assertNotCheckedOutElsewhere(ref) {
      const worktree = heads.get(ref)?.worktree;
      if (worktree && own.branch !== ref) throw new Refusal('BRANCH_CHECKED_OUT', `${ref.replace(/^refs\/heads\//, '')} is checked out at ${worktree}`, { worktree });
    },
    /** BRANCH_CHECKED_OUT when `ref` is checked out anywhere — here too, unless `allowOwn` — once the earlier steps ran. */
    assertNotCheckedOut(ref, { allowOwn = false } = {}) {
      ctx.assertNotCheckedOutElsewhere(ref);
      if (ctx.head.branch === ref && !allowOwn) {
        throw new Refusal('BRANCH_CHECKED_OUT', `${ref.replace(/^refs\/heads\//, '')} is checked out in this checkout`, { worktree: null });
      }
    },
  };
  return ctx;
}

/**
 * Undoes (`dir` 'undo': the steps in reverse) or redoes (`'redo'`: in order) `plan`. Refuses OPERATION_IN_PROGRESS /
 * CONFLICTED first, then UNDO_PUSHED (undo only), then whatever a step's preflight refuses. A step failing after an
 * earlier one wrote carries `appliedSteps` (the count that ran; in a refusal's body too). Resolves `{warnings}`.
 */
export async function runPlan(git, plan, dir, { ccOwned = false } = {}) {
  await assertNoOperation(git);
  if (dir === 'undo' && plan.created) await assertNotPushed(git, plan.created);
  const steps = dir === 'undo' ? [...plan.steps].reverse() : plan.steps;
  const kinds = steps.map((s) => {
    const kind = STEPS.get(s.kind);
    if (!kind) throw new Error(`undo plan: unknown step kind ${s.kind}`);
    return kind;
  });
  const ctx = await projection(git, ccOwned);
  for (let i = 0; i < steps.length; i++) await kinds[i].preflight(git, steps[i], dir, ctx);
  for (let i = 0; i < steps.length; i++) {
    try {
      await kinds[i].apply(git, steps[i], dir, ctx);
    } catch (e) {
      if (i > 0) {
        e.appliedSteps = i;
        if (e instanceof Refusal) e.extra = { ...e.extra, appliedSteps: i };
      }
      throw e;
    }
  }
  return { warnings: ctx.warnings };
}
