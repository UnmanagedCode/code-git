import { isDeepStrictEqual } from 'node:util';
import { stashSides } from './steps/stash.js';

// The registered ops' undo builders (docs/undo.md → Per-op plans): each turns an op's params and result (its
// `result.undo` record) into an UndoPlan, or null when the outcome is not undoable. Pure: they never run git.
//
// UndoPlan {label, created: {tip, not} | null, confirm: {undo: Confirm | null, redo: Confirm | null}, steps}
// Confirm  {kind: 'deletesRefs', refs} | {kind: 'discards', paths} | {kind: 'resetHard'} | {kind: 'dropsStashes', messages}
//        | {kind: 'deletesRemote', name, refs}
// Redo runs the steps in order, undo in reverse (src/git/undo/engine.js).

const short = (ref) => ref.replace(/^refs\/(?:heads|tags)\//, '');
const abbrev = (oid) => oid.slice(0, 7);
const quoted = (s) => `“${s}”`;
const names = (list) => list.join(', ');

/**
 * The confirmation each direction needs (D4, R2: only a real loss asks): a hard reset, then a discard's redo, then a
 * direction that only drops stashes, then a remote's removal on redo (with the tracking refs it deletes), then any ref
 * it deletes. Lines taken out with `apply -R` are a discard only when
 * no stash holds them (stash.pushLines' are in its stash); a forward patch's redo (stash.applyFile) loses nothing.
 */
function confirmsOf(steps) {
  const confirm = { undo: null, redo: null };
  const deletes = { undo: [], redo: [] };
  const dropped = { undo: [], redo: [] };
  const inStash = steps.some((s) => s.kind === 'stash');
  const writesFiles = steps.some((s) => s.kind === 'worktree' || s.kind === 'patch');
  const removed = steps.find((s) => s.kind === 'remote' && s.new === null);
  for (const s of steps) {
    if (s.kind === 'head' && s.mode === 'hard') {
      confirm.undo = { kind: 'resetHard' };
      confirm.redo = { kind: 'resetHard' };
    }
    if (s.kind === 'discard') confirm.redo ??= { kind: 'discards', paths: [...s.tracked, ...s.untracked] };
    if (s.kind === 'patch' && !s.forward && !inStash) confirm.redo ??= { kind: 'discards', paths: [s.path] };
    if (s.kind === 'stash' && !writesFiles) {
      for (const dir of ['undo', 'redo']) {
        const { stores, drops } = stashSides(s, dir);
        if (drops.length && !stores.length) dropped[dir].push(...drops.map((e) => e.message));
      }
    }
    if (s.kind === 'refs') {
      for (const r of s.refs) {
        if (r.symref) deletes.redo.push(r.ref);
        else if (r.old === null && r.new !== null) deletes.undo.push(r.ref);
        else if (r.old !== null && r.new === null) deletes.redo.push(r.ref);
      }
    }
    // The first commit on an unborn branch: its undo deletes the branch ref.
    if (s.kind === 'head' && s.mode === 'soft' && s.old.oid === null && s.old.branch) deletes.undo.push(s.old.branch);
  }
  for (const dir of ['undo', 'redo']) {
    if (!confirm[dir] && dropped[dir].length) confirm[dir] = { kind: 'dropsStashes', messages: dropped[dir] };
    if (!confirm[dir] && dir === 'redo' && removed) confirm[dir] = { kind: 'deletesRemote', name: removed.name, refs: deletes.redo };
    if (!confirm[dir] && deletes[dir].length) confirm[dir] = { kind: 'deletesRefs', refs: deletes[dir] };
  }
  return confirm;
}

/** A plan from its steps; null when there is nothing to undo. */
function plan(label, steps, { created = null } = {}) {
  const kept = steps.filter(Boolean);
  if (!kept.length) return null;
  return { label, created, confirm: confirmsOf(kept), steps: kept };
}

/**
 * The steps of a ref-and-HEAD record. HEAD staying on its branch (or detached) and moving: one `head` step in `mode`, and
 * that branch left out of the refs (the reset moves it). HEAD switching branches: a `switch` step after the refs, so a
 * created branch exists before redo switches to it, and undo switches away before deleting it. An unborn HEAD before
 * a switch cannot be switched back to: not undoable.
 */
function refHeadSteps(rec, mode, extra = {}) {
  const h = rec.head;
  let head = null;
  let refs = rec.refs;
  if (h && (h.old.branch !== h.new.branch || h.old.oid !== h.new.oid)) {
    if (h.old.branch !== h.new.branch) {
      if (h.old.oid === null) return null;
      head = { kind: 'head', mode: 'switch', old: h.old, new: h.new };
    } else {
      head = { kind: 'head', mode, old: h.old, new: h.new, ...extra };
      refs = refs.filter((r) => r.ref !== h.old.branch);
    }
  }
  return [refs.length ? { kind: 'refs', refs } : null, head];
}

const headName = (h) => (h.old.branch ? short(h.old.branch) : 'HEAD');

function commitPlan(params, result) {
  const rec = result.undo;
  const label = `${params.messageOnly ? 'Reword' : params.amend ? 'Amend' : 'Commit'} ${quoted(params.summary)}`;
  return plan(label, refHeadSteps(rec, 'soft') ?? [], { created: rec.created ?? null });
}

function resetPlan(params, result) {
  const rec = result.undo;
  const extra = params.mode === 'mixed' ? { indexTree: rec.indexTree ?? null } : params.mode === 'hard' ? { snapshot: rec.worktreeSnapshot } : {};
  return plan(`Reset ${headName(rec.head)} to ${abbrev(params.to)} (${params.mode})`, refHeadSteps(rec, params.mode, extra) ?? []);
}

/** A commit-making HEAD move (cherry-pick, revert, merge, rebase, continue): `reset --keep` both ways. */
const keepPlan = (label, rec) => plan(label, refHeadSteps(rec, 'keep') ?? [], { created: rec.created ?? null });

function pickPlan(which) {
  return (params, result) => (result.conflicts ? null : keepPlan(`${which} ${abbrev(params.oid)}`, result.undo));
}

function mergePlan(params, result) {
  if (result.outcome !== 'fastForward' && result.outcome !== 'merged') return null;
  const from = params.ref ? short(params.ref.replace(/^refs\/remotes\//, '')) : abbrev(params.oid);
  return keepPlan(result.outcome === 'fastForward' ? `Fast-forward to ${from}` : `Merge ${from}`, result.undo);
}

function rebasePlan(params, result) {
  return result.outcome === 'done' ? keepPlan(`Rebase onto ${abbrev(params.onto)}`, result.undo) : null;
}

function interactivePlan(params, result) {
  if (result.outcome !== 'done') return null;
  const n = params.rows.length;
  return keepPlan(params.mode === 'pick' ? `Cherry-pick ${n} ${n === 1 ? 'commit' : 'commits'}` : 'Interactive rebase', result.undo);
}

function resumePlan(step) {
  return (params, result) => (result.outcome === 'done' ? keepPlan(`${step} the ${params.which}`, result.undo) : null);
}

function checkoutPlan(params, result) {
  return plan(`Checkout ${short(result.branch)}`, refHeadSteps(result.undo, 'keep') ?? []);
}

function createPlan(params, result) {
  return plan(`Create branch ${params.name}${result.checkedOut ? ' and check it out' : ''}`, refHeadSteps(result.undo, 'keep') ?? []);
}

function renamePlan(params, result) {
  const rec = result.undo;
  const from = rec.refs.find((r) => r.new === null);
  const to = rec.refs.find((r) => r.old === null);
  return plan(`Rename ${params.name} to ${params.newName}`, [{ kind: 'rename', from: from.ref, to: to.ref, oid: to.new }]);
}

const refsPlan = (label) => (params, result) => plan(label(params, result), refHeadSteps(result.undo, 'keep') ?? []);

function discardFilesPlan(params, result) {
  const { snapshot, tracked, untracked } = result.undo.discard;
  const paths = [...tracked, ...untracked];
  return plan(paths.length === 1 ? `Discard ${paths[0]}` : `Discard ${paths.length} files`, [{ kind: 'discard', snapshot, tracked, untracked }]);
}

function discardLinesPlan(params, result) {
  return plan(`Discard lines in ${result.path}`, [{ kind: 'patch', path: result.path, patchB64: result.patchB64 }]);
}

/** A record's `stashes` as one `stash` step (each entry the op created or removed, with the message it is stored under). */
function stashStep(rec) {
  const entries = rec.stashes.map((e) => (e.old === null
    ? { oid: e.oid, message: e.new.message, side: 'created' }
    : { oid: e.oid, message: e.old.message, side: 'removed' }));
  return entries.length ? { kind: 'stash', entries } : null;
}

const worktreeStep = (state) => ({ kind: 'worktree', ...state });

/** A save: its stash and the checkout's state before and after. Unverified (no stash claimed) or unrecorded state: none. */
function stashPushPlan(params, result) {
  const rec = result.undo;
  if (!rec.worktreeState || !rec.stashes.length) return null;
  return plan(params.message ? `Stash ${quoted(params.message)}` : 'Stash changes', [stashStep(rec), worktreeStep(rec.worktreeState)]);
}

function stashPushLinesPlan(params, result) {
  const rec = result.undo;
  return plan(`Stash lines in ${params.path}`, [stashStep(rec), { kind: 'patch', path: params.path, patchB64: rec.removedPatch }]);
}

/** A clean pop: the checkout's states, then the drop (absent when the drop met STASH_MOVED). Conflicts: none. */
function stashPopPlan(params, result) {
  const rec = result.undo;
  if (result.conflicts.length || !rec.worktreeState) return null;
  const message = rec.stashes[0]?.old.message;
  return plan(message === undefined ? 'Pop stash' : `Pop ${quoted(message)}`, [worktreeStep(rec.worktreeState), stashStep(rec)]);
}

/** A clean apply: the checkout's states only (the stash entry is not the plan's). Conflicts, or nothing changed: none. */
function stashApplyPlan(params, result) {
  const st = result.undo.worktreeState;
  if (result.conflicts.length || !st || isDeepStrictEqual(st.before, st.after)) return null;
  return plan(`Apply ${quoted(result.message)}`, [worktreeStep(st)]);
}

function stashDropPlan(params, result) {
  const rec = result.undo;
  return plan(`Drop stash ${quoted(rec.stashes[0].old.message)}`, [stashStep(rec)]);
}

function stashRenamePlan(params, result) {
  return plan(`Rename stash to ${quoted(params.message)}`, [stashStep(result.undo)]);
}

function stashApplyFilePlan(params, result) {
  return plan(`Apply ${result.path} from stash`, [{ kind: 'patch', path: result.path, patchB64: result.undo.worktreePatch, forward: true }]);
}

/** A clean stash.branch: create, switch, the apply's states (`mid` between switch and apply), the drop. Unborn HEAD: none. */
function stashBranchPlan(params, result) {
  const rec = result.undo;
  if (result.conflicts.length || !rec.worktreeState) return null;
  const refHead = refHeadSteps(rec, 'keep');
  if (!refHead) return null;
  return plan(`Create branch ${params.name} from stash`, [...refHead, worktreeStep(rec.worktreeState), stashStep(rec)]);
}

/** The remote record's one entry (add, edit, remove each record one remote). */
const remoteStep = (r) => ({ kind: 'remote', name: r.name, old: r.old, new: r.new });

function remoteAddPlan(params, result) {
  return plan(`Add remote ${params.name}`, [remoteStep(result.undo.remotes[0])]);
}

/** Null when the edit wrote nothing (every field echoed unchanged): no entry whose undo does nothing. */
function remoteEditPlan(params, result) {
  const r = result.undo.remotes[0];
  return isDeepStrictEqual(r.old, r.new) ? null : plan(`Edit remote ${params.name}`, [remoteStep(r)]);
}

function remoteRenamePlan(params) {
  return plan(`Rename remote ${params.name} to ${params.newName}`, [{ kind: 'remoteRename', from: params.name, to: params.newName }]);
}

/** Redo deletes the tracking refs first, then the config; undo writes the config back, then re-creates the refs. */
function remoteRemovePlan(params, result) {
  const rec = result.undo;
  return plan(`Remove remote ${params.name}`, [rec.refs.length ? { kind: 'refs', refs: rec.refs } : null, remoteStep(rec.remotes[0])]);
}

/** The builders, by the op whose definition carries them. */
export const plans = {
  commit: commitPlan,
  reset: resetPlan,
  cherryPick: pickPlan('Cherry-pick'),
  revert: pickPlan('Revert'),
  merge: mergePlan,
  rebase: rebasePlan,
  interactive: interactivePlan,
  continue: resumePlan('Continue'),
  skip: resumePlan('Skip in'),
  checkout: checkoutPlan,
  create: createPlan,
  rename: renamePlan,
  deleteBranches: refsPlan((p, r) => `Delete branch ${names(r.deleted)}`),
  move: refsPlan((p) => `Move ${p.name} to ${abbrev(p.to)}`),
  fastForward: refsPlan((p) => `Fast-forward ${p.name}`),
  createTag: refsPlan((p) => `Create tag ${p.name}`),
  deleteTags: refsPlan((p, r) => `Delete tag ${names(r.deleted)}`),
  discardFiles: discardFilesPlan,
  discardLines: discardLinesPlan,
  stashPush: stashPushPlan,
  stashPushLines: stashPushLinesPlan,
  stashApply: stashApplyPlan,
  stashPop: stashPopPlan,
  stashDrop: stashDropPlan,
  stashRename: stashRenamePlan,
  stashApplyFile: stashApplyFilePlan,
  stashBranch: stashBranchPlan,
  remoteAdd: remoteAddPlan,
  remoteEdit: remoteEditPlan,
  remoteRename: remoteRenamePlan,
  remoteRemove: remoteRemovePlan,
};
