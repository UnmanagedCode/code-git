import { Refusal } from '../../refusals.js';
import { readNoIndex } from '../diff/noIndex.js';
import { commitOid } from '../diff/source.js';
import { paramsObject } from '../params.js';
import { fullRef } from '../refs/check.js';
import { ownHead } from '../refs/heads.js';
import { undoRecord } from '../refs/undo.js';
import { merge } from '../remote/integrate.js';
import { assertNoOperation } from '../sequence/guard.js';
import { SEQUENCE_LIMITS } from '../sequence/limits.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// merge.start (docs/merge.md → Merge): a branch, tag or commit merged into this checkout — fast-forward when possible,
// always a merge commit, or squashed into the index. A merge only adds commits: no code-conductor/* acknowledgement.

const decoder = new TextDecoder('utf-8', { fatal: false });
const MODES = ['ff', 'noFf', 'squash'];
const PREFIXES = ['refs/heads/', 'refs/remotes/', 'refs/tags/'];
/** SQUASH_MSG lists every squashed commit: a generous cap for the text the commit box is pre-filled with. */
const SQUASH_MSG_MAX = 1024 * 1024;

const isAncestor = async (git, a, b) => (await git(['merge-base', '--is-ancestor', a, b], { okExit: [0, 1] })).exitCode === 0;

/** The merge commit's message, in the style of git's own (and the pull's), from the validated ref the UI named. */
function messageFor(ref, oid) {
  if (ref?.startsWith('refs/heads/')) return `Merge branch '${ref.slice('refs/heads/'.length)}'`;
  if (ref?.startsWith('refs/remotes/')) return `Merge remote-tracking branch '${ref.slice('refs/remotes/'.length)}'`;
  if (ref?.startsWith('refs/tags/')) return `Merge tag '${ref.slice('refs/tags/'.length)}'`;
  return `Merge commit '${oid.slice(0, 7)}'`;
}

/** A squash's prepared message: `$GIT_DIR/SQUASH_MSG` with comment lines and surplus blank lines removed. */
async function squashMessage(git) {
  const file = decoder.decode((await git(['rev-parse', '--git-path', 'SQUASH_MSG'])).stdout).replace(/\n$/, '');
  const r = await readNoIndex(git, file, { maxBytes: SQUASH_MSG_MAX });
  if (r.kind !== 'file') return '';
  return decoder.decode((await git(['stripspace', '-s'], { stdin: r.bytes })).stdout);
}

export const ops = [
  {
    name: 'merge.start',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['ref', 'oid', 'mode', 'expect'], 'merge.start');
      if (!MODES.includes(p.mode)) throw new Refusal('BAD_PARAMS', `mode must be one of ${MODES.join(', ')}`);
      if (p.ref !== null && p.ref !== undefined) fullRef(p.ref, PREFIXES);
      return { ref: p.ref ?? null, oid: assertOid(p.oid), mode: p.mode, expect: assertOid(p.expect) };
    },
    async run(git, { ref, oid, mode, expect }) {
      await assertWorktree(git);
      await assertNoOperation(git);
      const own = await ownHead(git);
      if (!own.oid) throw new Refusal('NO_HEAD', 'HEAD has no commit');
      if (own.oid !== expect) throw new Refusal('REF_MOVED', `HEAD is no longer at ${expect}`);
      if (await commitOid(git, oid) !== oid) throw new Refusal('REV_UNKNOWN', `${oid} is not a commit`);
      // The ref only names the commit in the message: it must still point there.
      if (ref && await commitOid(git, ref) !== oid) throw new Refusal('REF_MOVED', `${ref} is no longer at ${oid}`);
      const result = (outcome, extra = {}) => ({ outcome, files: [], oid: own.oid, message: null, undo: undoRecord(), ...extra });
      if (oid === own.oid || await isAncestor(git, oid, own.oid)) return result('upToDate');
      const fastForwardable = await isAncestor(git, own.oid, oid);
      const merged = await merge(git, oid, { mode, message: messageFor(ref, oid), timeoutMs: SEQUENCE_LIMITS.timeoutMs });
      if (merged.conflicts) return result('conflicts', { files: merged.files });
      if (mode === 'squash') return result('squashed', { message: await squashMessage(git) });
      const now = (await ownHead(git)).oid;
      return result(mode === 'ff' && fastForwardable ? 'fastForward' : 'merged', {
        oid: now,
        undo: undoRecord({
          refs: own.branch ? [{ ref: own.branch, old: own.oid, new: now }] : [],
          head: { old: { branch: own.branch, oid: own.oid }, new: { branch: own.branch, oid: now } },
        }),
      });
    },
  },
];
