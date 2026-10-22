import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { optBool, paramsOf } from '../refs/check.js';
import { assertCcHeadAck, ownHead } from '../refs/heads.js';
import { undoRecord } from '../refs/undo.js';
import { guardOverwrite } from '../refs/write.js';
import { assertOid } from '../validate.js';

// Ops that move this checkout's HEAD (docs/refs.md): reset, revert, cherry-pick, and aborting a revert or
// cherry-pick that stopped on conflicts.

const decoder = new TextDecoder('utf-8', { fatal: false });
const MODES = ['soft', 'mixed', 'hard'];
const MAINLINE_MAX = 16;
/** The pseudo-ref a stopped revert or cherry-pick leaves, per command. */
const IN_PROGRESS = { revert: 'REVERT_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD' };

const exists = async (git, ref) => (await git(['rev-parse', '--verify', '-q', ref], { okExit: [0, 1] })).exitCode === 0;

function mainlineOf(v) {
  if (v === undefined) return null;
  if (!Number.isInteger(v) || v < 1 || v > MAINLINE_MAX) throw new Refusal('BAD_PARAMS', `mainline must be an integer in 1…${MAINLINE_MAX}`);
  return v;
}

async function bornHead(git) {
  const own = await ownHead(git);
  if (!own.oid) throw new Refusal('NO_HEAD', 'HEAD has no commit');
  return own;
}

/** The undo record of HEAD moving from `own` to `oid` (its branch moving with it). */
const headUndo = (own, oid, extra = {}) => undoRecord({
  refs: own.branch ? [{ ref: own.branch, old: own.oid, new: oid }] : [],
  head: { old: { branch: own.branch, oid: own.oid }, new: { branch: own.branch, oid } },
  ...extra,
});

/**
 * `revert` or `cherry-pick` of one commit. Stopped on conflicts → {conflicts: true, files} with the operation in
 * progress (head.abort undoes it). A result that would commit nothing → the operation is aborted and PICK_EMPTY.
 */
async function apply(git, which, { oid, mainline }) {
  const own = await bornHead(git);
  const args = [which, ...(which === 'revert' ? ['--no-edit'] : []), ...(mainline ? ['-m', String(mainline)] : []), '--end-of-options', oid];
  const r = await guardOverwrite(git, args, { okExit: [0, 1] });
  if (r.exitCode === 0) {
    const now = (await ownHead(git)).oid;
    return { conflicts: false, files: [], oid: now, undo: headUndo(own, now) };
  }
  const stopped = await exists(git, IN_PROGRESS[which]);
  const unmerged = stopped
    ? decoder.decode((await git(['diff', '--name-only', '--diff-filter=U', '-z'])).stdout).split('\0').filter(Boolean)
    : [];
  if (unmerged.length) return { conflicts: true, files: unmerged, oid: null, undo: undoRecord() };
  const stderr = decoder.decode(r.stderr);
  if (stopped) await git([which, '--abort']);
  // Exit 1 with nothing unmerged: git found the change already in HEAD (an empty commit it would not make).
  throw new Refusal('PICK_EMPTY', `${which === 'revert' ? 'reverting' : 'cherry-picking'} ${oid.slice(0, 7)} changes nothing`, { stderr });
}

export const ops = [
  {
    name: 'head.reset',
    kind: 'write',
    params(raw) {
      const p = paramsOf(raw, ['to', 'mode', 'expect', 'ccOwned'], 'head.reset');
      if (!MODES.includes(p.mode)) throw new Refusal('BAD_PARAMS', `mode must be one of ${MODES.join(', ')}`);
      return { to: assertOid(p.to), mode: p.mode, expect: assertOid(p.expect), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { to, mode, expect, ccOwned }) {
      const own = await bornHead(git);
      if (own.oid !== expect) throw new Refusal('REF_MOVED', `HEAD is no longer at ${expect}`);
      assertCcHeadAck(own, ccOwned);
      if (await commitOid(git, to) !== to) throw new Refusal('REV_UNKNOWN', `${to} is not a commit`);
      // A dangling commit of the tracked changes a hard reset discards: undoable until gc. Untracked files survive the reset.
      const snapshot = mode === 'hard' ? decoder.decode((await git(['stash', 'create'])).stdout).trim() || null : null;
      await git(['reset', `--${mode}`, '--end-of-options', to]);
      return { undo: headUndo(own, to, { worktreeSnapshot: snapshot }) };
    },
  },
  {
    name: 'head.revert',
    kind: 'write',
    params(raw) {
      const p = paramsOf(raw, ['oid', 'mainline'], 'head.revert');
      return { oid: assertOid(p.oid), mainline: mainlineOf(p.mainline) };
    },
    run: (git, params) => apply(git, 'revert', params),
  },
  {
    name: 'head.cherryPick',
    kind: 'write',
    params(raw) {
      const p = paramsOf(raw, ['oid', 'mainline'], 'head.cherryPick');
      return { oid: assertOid(p.oid), mainline: mainlineOf(p.mainline) };
    },
    run: (git, params) => apply(git, 'cherry-pick', params),
  },
  {
    name: 'head.abort',
    kind: 'write',
    params(raw) {
      const p = paramsOf(raw, ['which'], 'head.abort');
      if (typeof p.which !== 'string' || !Object.hasOwn(IN_PROGRESS, p.which)) throw new Refusal('BAD_PARAMS', "which must be 'revert' or 'cherry-pick'");
      return { which: p.which };
    },
    async run(git, { which }) {
      if (!(await exists(git, IN_PROGRESS[which]))) throw new Refusal('NOTHING_IN_PROGRESS', `no ${which} in progress`);
      const before = await ownHead(git);
      await git([which, '--abort']);
      const after = await ownHead(git);
      return { undo: undoRecord({ head: { old: before, new: after } }) };
    },
  },
];
