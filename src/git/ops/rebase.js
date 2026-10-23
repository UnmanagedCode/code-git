import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { optBool, paramsObject } from '../params.js';
import { assertCcHeadAck, ownHead } from '../refs/heads.js';
import { undoRecord } from '../refs/undo.js';
import { rebase } from '../remote/integrate.js';
import { assertClean, assertNoOperation } from '../sequence/guard.js';
import { SEQUENCE_LIMITS } from '../sequence/limits.js';
import { assertGitAtLeast } from '../stash/version.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Rebasing this checkout's branch (docs/merge.md → Rebase): rebase.start replays `upstream..HEAD` onto a commit. A
// rebase rewrites the branch: a code-conductor/* HEAD needs the acknowledgement.

const decoder = new TextDecoder('utf-8', { fatal: false });
/** `--empty` (what the interactive rebase pins) arrived in git 2.26. */
const REBASE_FLOOR = [2, 26];

/**
 * The gates every rebase start runs, in order, before git: a worktree, the git floor, nothing in progress, a born HEAD
 * still at `expect`, the cc acknowledgement, a clean tree, no merge commit in `upstream..HEAD`. Resolves HEAD.
 */
export async function rebaseGates(git, { expect, upstream, ccOwned }) {
  await assertWorktree(git);
  await assertGitAtLeast(git, REBASE_FLOOR, 'rebase');
  await assertNoOperation(git);
  const own = await ownHead(git);
  if (!own.oid) throw new Refusal('NO_HEAD', 'HEAD has no commit');
  if (own.oid !== expect) throw new Refusal('REF_MOVED', `HEAD is no longer at ${expect}`);
  assertCcHeadAck(own, ccOwned);
  await assertClean(git);
  if (await commitOid(git, upstream) !== upstream) throw new Refusal('REV_UNKNOWN', `${upstream} is not a commit`);
  const merges = Number(decoder.decode((await git(['rev-list', '--merges', '--count', `${upstream}..${own.oid}`])).stdout).trim());
  if (merges > 0) throw new Refusal('HAS_MERGES', `${merges} merge ${merges === 1 ? 'commit' : 'commits'} in the range: a rebase would flatten them; rebase it with git`);
  return own;
}

/** A finished rebase's answer: upToDate when HEAD did not move, else done with the branch's move as its undo. */
export async function rebaseResult(git, own, r) {
  if (r.outcome !== 'done') return { outcome: r.outcome, files: r.files, oid: (await ownHead(git)).oid, undo: undoRecord() };
  const now = await ownHead(git);
  if (now.oid === own.oid) return { outcome: 'upToDate', files: [], oid: now.oid, undo: undoRecord() };
  return {
    outcome: 'done', files: [], oid: now.oid,
    undo: undoRecord({
      refs: own.branch ? [{ ref: own.branch, old: own.oid, new: now.oid }] : [],
      head: { old: { branch: own.branch, oid: own.oid }, new: { branch: now.branch, oid: now.oid } },
    }),
  };
}

export const ops = [
  {
    name: 'rebase.start',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['onto', 'upstream', 'expect', 'ccOwned'], 'rebase.start');
      return { onto: assertOid(p.onto), upstream: assertOid(p.upstream), expect: assertOid(p.expect), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { onto, upstream, expect, ccOwned }) {
      const own = await rebaseGates(git, { expect, upstream, ccOwned });
      if (await commitOid(git, onto) !== onto) throw new Refusal('REV_UNKNOWN', `${onto} is not a commit`);
      const r = await rebase(git, [`--onto=${onto}`, '--end-of-options', upstream], { timeoutMs: SEQUENCE_LIMITS.timeoutMs });
      return rebaseResult(git, own, r);
    },
  },
];
