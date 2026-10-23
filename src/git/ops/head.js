import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { optBool, paramsObject } from '../params.js';
import { assertCcHeadAck, ownHead } from '../refs/heads.js';
import { undoRecord } from '../refs/undo.js';
import { guardOverwrite } from '../refs/write.js';
import { REBASE } from '../remote/integrate.js';
import { assertNoOperation } from '../sequence/guard.js';
import { SEQUENCE_LIMITS } from '../sequence/limits.js';
import { operationState, readRebase } from '../sequence/state.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Ops that move this checkout's HEAD (docs/refs.md, docs/merge.md): reset, revert, cherry-pick, and continuing, skipping
// or aborting a merge, rebase, cherry-pick or revert that stopped.

const decoder = new TextDecoder('utf-8', { fatal: false });
const MODES = ['soft', 'mixed', 'hard'];
const MAINLINE_MAX = 16;
/** The pseudo-ref a stopped revert or cherry-pick leaves. */
const PICK_HEAD = { revert: 'REVERT_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD' };
/** What head.abort / head.continue name (operationState's kinds); a merge has no skip. */
const WHICH = ['merge', 'rebase', 'cherry-pick', 'revert'];
const SKIPPABLE = ['rebase', 'cherry-pick', 'revert'];
const FILES_SHOWN = 100;
/** git's wording (LC_ALL=C) when a continue would commit nothing, and when a rebase's continue finds unstaged changes. */
const NOTHING_RE = /nothing to commit|is now empty/;
const UNSTAGED_RE = /unstaged changes|You must edit all merge conflicts/;

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
  await assertWorktree(git);
  await assertNoOperation(git);
  const own = await bornHead(git);
  const args = [which, ...(which === 'revert' ? ['--no-edit'] : []), ...(mainline ? ['-m', String(mainline)] : []), '--end-of-options', oid];
  const r = await guardOverwrite(git, args, { okExit: [0, 1] });
  if (r.exitCode === 0) {
    const now = (await ownHead(git)).oid;
    return { conflicts: false, files: [], oid: now, undo: headUndo(own, now) };
  }
  const stopped = await exists(git, PICK_HEAD[which]);
  const unmerged = stopped
    ? decoder.decode((await git(['diff', '--name-only', '--diff-filter=U', '-z'])).stdout).split('\0').filter(Boolean)
    : [];
  if (unmerged.length) return { conflicts: true, files: unmerged, oid: null, undo: undoRecord() };
  const stderr = decoder.decode(r.stderr);
  if (stopped) await git([which, '--abort']);
  // Exit 1 with nothing unmerged: git found the change already in HEAD (an empty commit it would not make).
  throw new Refusal('PICK_EMPTY', `${which === 'revert' ? 'reverting' : 'cherry-picking'} ${oid.slice(0, 7)} changes nothing`, { stderr });
}

function whichOf(raw, op, allowed) {
  const p = paramsObject(raw, ['which'], op);
  if (typeof p.which !== 'string' || !allowed.includes(p.which)) throw new Refusal('BAD_PARAMS', `which must be one of ${allowed.join(', ')}`);
  return { which: p.which };
}

/** NOTHING_IN_PROGRESS unless `which` is what operationState reports in progress; resolves that state. */
async function inProgress(git, which) {
  const s = await operationState(git);
  if (s.operation?.kind !== which) throw new Refusal('NOTHING_IN_PROGRESS', `no ${which} in progress`);
  return s;
}

const pathsOf = (conflicts) => conflicts.slice(0, FILES_SHOWN).map((c) => c.path);

/**
 * `<which> --continue` or `--skip` (`step`) of the operation in progress, never aborted on a failure: the operation stays
 * for the user to fix, and the refusal carries git's stderr. `GIT_EDITOR=:`: git's no-op editor keeps the message it
 * prepared (the picked commit's, a carrier's, the merge's). Then the state decides: unmerged files → `conflicts`, still
 * in progress (an `edit` stop) → `stopped`, else `done` with the undo of the whole operation.
 */
async function resume(git, which, step) {
  await assertWorktree(git);
  const s = await inProgress(git, which);
  if (step === '--continue' && s.conflicts.length) {
    throw new Refusal('CONFLICTED', `${s.conflicts.length} conflicted ${s.conflicts.length === 1 ? 'file' : 'files'}: resolve and stage them first`, { files: pathsOf(s.conflicts) });
  }
  const before = await ownHead(git);
  const started = which === 'rebase' ? await readRebase(git) : null;
  const args = which === 'rebase' ? [...REBASE, step] : [which, step];
  const r = await git(args, { env: { GIT_EDITOR: ':' }, okExit: [0, 1], timeoutMs: SEQUENCE_LIMITS.timeoutMs });
  const after = await operationState(git);
  const now = await ownHead(git);
  if (after.conflicts.length) return { outcome: 'conflicts', files: after.conflicts.map((c) => c.path), oid: now.oid, undo: undoRecord() };
  if (r.exitCode !== 0) {
    const stderr = decoder.decode(r.stderr);
    const said = `${decoder.decode(r.stdout)}\n${stderr}`;
    if (NOTHING_RE.test(said)) throw new Refusal('NOTHING_TO_COMMIT', `the ${which} would commit nothing here: skip this commit or abort`, { stderr });
    if (UNSTAGED_RE.test(said)) throw new Refusal('DIRTY_WORKTREE', 'stage or discard the unstaged changes first', { stderr });
    throw new Refusal('GIT_FAILED', `git ${which} ${step} exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr });
  }
  if (after.operation?.kind === which) return { outcome: 'stopped', files: [], oid: now.oid, undo: undoRecord() };
  if (!started) return { outcome: 'done', files: [], oid: now.oid, undo: headUndo(before, now.oid) };
  // The whole rebase, from the branch's tip before it began.
  const { branch, orig } = started;
  return {
    outcome: 'done', files: [], oid: now.oid,
    undo: undoRecord({
      refs: branch && orig ? [{ ref: branch, old: orig, new: now.oid }] : [],
      head: { old: { branch, oid: orig }, new: { branch: now.branch, oid: now.oid } },
    }),
  };
}

export const ops = [
  {
    name: 'head.reset',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['to', 'mode', 'expect', 'ccOwned'], 'head.reset');
      if (!MODES.includes(p.mode)) throw new Refusal('BAD_PARAMS', `mode must be one of ${MODES.join(', ')}`);
      return { to: assertOid(p.to), mode: p.mode, expect: assertOid(p.expect), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { to, mode, expect, ccOwned }) {
      // Mixed rewrites the index, hard the index and the working tree; soft moves only the branch ref.
      if (mode !== 'soft') await assertWorktree(git);
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
      const p = paramsObject(raw, ['oid', 'mainline'], 'head.revert');
      return { oid: assertOid(p.oid), mainline: mainlineOf(p.mainline) };
    },
    run: (git, params) => apply(git, 'revert', params),
  },
  {
    name: 'head.cherryPick',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['oid', 'mainline'], 'head.cherryPick');
      return { oid: assertOid(p.oid), mainline: mainlineOf(p.mainline) };
    },
    run: (git, params) => apply(git, 'cherry-pick', params),
  },
  {
    name: 'head.abort',
    kind: 'write',
    params: (raw) => whichOf(raw, 'head.abort', WHICH),
    async run(git, { which }) {
      await assertWorktree(git);
      await inProgress(git, which);
      const before = await ownHead(git);
      await git([which, '--abort'], { timeoutMs: SEQUENCE_LIMITS.timeoutMs });
      const after = await ownHead(git);
      return { undo: undoRecord({ head: { old: before, new: after } }) };
    },
  },
  {
    name: 'head.continue',
    kind: 'write',
    params: (raw) => whichOf(raw, 'head.continue', WHICH),
    run: (git, { which }) => resume(git, which, '--continue'),
  },
  {
    name: 'head.skip',
    kind: 'write',
    params: (raw) => whichOf(raw, 'head.skip', SKIPPABLE),
    run: (git, { which }) => resume(git, which, '--skip'),
  },
];
