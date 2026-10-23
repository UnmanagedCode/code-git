// What the ops route does around every op for the journal (docs/undo.md → Journal): a write that is not undo/redo
// clears its checkout's slots before it runs, and on success records the plan its definition's `undo` builds.

const isUndoOp = (op) => op.name.startsWith('undo.');

/**
 * Runs `run()` (the op) for `target`. Reads and the undo ops pass straight through. A failed write leaves the slots
 * cleared, and so does one whose builder answers null or a plan without steps (an outcome that stopped on conflicts,
 * a no-op). A builder that throws is a code-git bug: logged, the op's own result still answered, nothing recorded.
 */
export async function journalAround(journal, op, target, params, run) {
  if (op.kind !== 'write' || isUndoOp(op)) return run();
  const gen = journal.beforeWrite(target);
  const result = await run();
  if (!op.undo) return result;
  let plan = null;
  try {
    plan = op.undo(params, result);
  } catch (e) {
    console.error(`code-git: ${op.name}: the undo plan builder failed`, e);
  }
  if (plan?.steps?.length) journal.recorded(target, gen, op.name, plan);
  return result;
}
