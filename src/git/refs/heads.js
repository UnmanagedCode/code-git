import { Refusal } from '../../refusals.js';
import { parseRecords } from '../parse/graph.js';

// Local branches as the write ops see them: where each is checked out, and the cc-owned rules (docs/refs.md).

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout).trim();
const CC_PREFIX = 'code-conductor/';

/** Every local branch: Map(refname → {oid, worktree: path of the checkout that has it | null, upstream: refname | null}). */
export async function readHeads(git) {
  const r = await git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(worktreepath)%00%(upstream)', 'refs/heads']);
  return new Map(parseRecords(decoder.decode(r.stdout), 4).map(([ref, oid, worktree, upstream]) => [
    ref, { oid, worktree: worktree || null, upstream: upstream || null },
  ]));
}

/** This checkout's HEAD: {branch: refname | null (detached), oid: oid | null (unborn)}. */
export async function ownHead(git) {
  const [sym, oid] = await Promise.all([
    git(['symbolic-ref', '-q', 'HEAD'], { okExit: [0, 1] }),
    git(['rev-parse', '--verify', '-q', 'HEAD'], { okExit: [0, 1] }),
  ]);
  return { branch: sym.exitCode === 0 ? text(sym) || null : null, oid: oid.exitCode === 0 ? text(oid) || null : null };
}

/**
 * Throws BRANCH_CHECKED_OUT (with the checkout's `worktree` path) when `ref` is checked out somewhere — except in
 * this checkout when `allowOwn`. This checkout is recognised by its HEAD (`own.branch`), not by comparing paths.
 */
export function assertNotCheckedOut(heads, ref, { allowOwn = false, own = null } = {}) {
  const worktree = heads.get(ref)?.worktree;
  if (!worktree || (allowOwn && own?.branch === ref)) return;
  throw new Refusal('BRANCH_CHECKED_OUT', `${ref.replace(/^refs\/heads\//, '')} is checked out at ${worktree}`, { worktree });
}

/** A branch cc owns (its worktree records name it): `code-conductor/…`, short name. */
export const isCcOwned = (short) => short.startsWith(CC_PREFIX);

/** Throws CC_OWNED_BRANCH naming the cc-owned ones among `names` (short) unless the UI acknowledged them (`ack`). */
export function assertCcAck(names, ack) {
  const branches = names.filter(isCcOwned);
  if (branches.length && ack !== true) {
    throw new Refusal('CC_OWNED_BRANCH', `${branches.join(', ')} ${branches.length > 1 ? 'are' : 'is'} owned by code-conductor`, { branches });
  }
}

/** Throws CC_OWNED_BRANCH (`head: true`) when this checkout's HEAD is a cc-owned branch and the UI did not acknowledge moving it. */
export function assertCcHeadAck(own, ack) {
  const short = own.branch?.startsWith('refs/heads/') ? own.branch.slice('refs/heads/'.length) : null;
  if (short && isCcOwned(short) && ack !== true) {
    throw new Refusal('CC_OWNED_BRANCH', `this checkout is code-conductor's worktree on ${short}`, { branches: [short], head: true });
  }
}
