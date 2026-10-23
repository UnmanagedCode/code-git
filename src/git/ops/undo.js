import { Refusal } from '../../refusals.js';
import { optBool, paramsObject } from '../params.js';
import { runPlan } from '../undo/engine.js';

// undo.state, undo.undo, undo.redo (docs/undo.md → Ops): the checkout's journal slots, and running one of them. The
// two writes are not cancellable: a plan runs several commands, and an abort between them would leave it half-applied.

const NOTHING = { undo: 'NOTHING_TO_UNDO', redo: 'NOTHING_TO_REDO' };
/** Refusals after which the entry can never run: both slots are cleared. Any other refusal keeps them (fix and retry). */
const DEAD = new Set(['UNDO_STALE', 'UNDO_PUSHED']);

/** A slot as the UI sees it: no steps, the confirmation for its own direction. */
const shown = (entry, dir) => (entry ? { id: entry.id, op: entry.op, label: entry.plan.label, confirm: entry.plan.confirm[dir] } : null);

function noParams(raw) {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw new Refusal('BAD_PARAMS', 'undo.state takes no params');
  return {};
}

function runParams(op) {
  return (raw) => {
    const p = paramsObject(raw, ['id', 'ccOwned'], op);
    if (!Number.isSafeInteger(p.id) || p.id < 1) throw new Refusal('BAD_PARAMS', 'id must be a positive integer');
    return { id: p.id, ccOwned: optBool(p.ccOwned, 'ccOwned') };
  };
}

function runner(dir) {
  return async (git, { id, ccOwned }, { target, journal }) => {
    const taken = journal.take(target, dir, id);
    if (!taken) {
      if (!journal.state(target)[dir]) throw new Refusal(NOTHING[dir], `nothing to ${dir}`);
      // The request names an entry the slot no longer holds: the UI's state is stale, not the slot.
      throw new Refusal('UNDO_STALE', `that ${dir} is no longer the latest: refresh`);
    }
    try {
      const { warnings } = await runPlan(git, taken.entry.plan, dir, { ccOwned });
      journal.move(target, dir, taken.entry, taken.gen);
      return { entry: shown(taken.entry, dir), warnings };
    } catch (e) {
      if (DEAD.has(e.code) || e.appliedSteps) journal.clear(target);
      throw e;
    }
  };
}

export const ops = [
  {
    name: 'undo.state',
    kind: 'read',
    params: noParams,
    async run(_git, _p, { target, journal }) {
      const s = journal.state(target);
      return { undo: shown(s.undo, 'undo'), redo: shown(s.redo, 'redo') };
    },
  },
  { name: 'undo.undo', kind: 'write', params: runParams('undo.undo'), run: runner('undo') },
  { name: 'undo.redo', kind: 'write', params: runParams('undo.redo'), run: runner('redo') },
];
