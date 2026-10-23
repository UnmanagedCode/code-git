// The undo journal (docs/undo.md → Journal): in memory, per checkout, one undo slot and one redo slot. A backend
// restart empties it. Every write that is not undo/redo clears the checkout's slots first (src/git/undo/record.js).

/** A checkout's key, the frontend's `tabKey` (frontend/src/state/tabs.ts): project, worktree and submodule chain. */
export const targetKey = (t) => `${t.project}\0${t.worktree ?? ''}${(t.sub ?? []).map((s) => `\0${s}`).join('')}`;

const OTHER = { undo: 'redo', redo: 'undo' };

/**
 * `Entry = {id, op, plan}`; `id` is a process-wide counter, so an id never names a later entry. Each checkout also has a
 * generation, bumped by every clear: a write that started before another write cleared the slots cannot record over
 * that write's plan, and an undo whose slots were cleared while it ran cannot move its entry back.
 */
export function createJournal() {
  const slots = new Map();
  let nextId = 1;
  const of = (target) => {
    const key = targetKey(target);
    if (!slots.has(key)) slots.set(key, { undo: null, redo: null, gen: 0 });
    return slots.get(key);
  };
  return {
    /** `{undo, redo}`: the entries in the two slots (null when empty). */
    state(target) {
      const s = of(target);
      return { undo: s.undo, redo: s.redo };
    },
    /** Clears both slots before a write runs; resolves the generation that write may record under. */
    beforeWrite(target) {
      const s = of(target);
      s.undo = null;
      s.redo = null;
      return ++s.gen;
    },
    /** Puts a write's plan in the undo slot, unless another write cleared the slots since `gen`. Resolves the entry or null. */
    recorded(target, gen, op, plan) {
      const s = of(target);
      if (s.gen !== gen) return null;
      s.undo = { id: nextId++, op, plan };
      return s.undo;
    },
    /** The entry in slot `dir` if its id is `id`, with the generation it was taken at; null otherwise. */
    take(target, dir, id) {
      const s = of(target);
      const entry = s[dir];
      return entry && entry.id === id ? { entry, gen: s.gen } : null;
    },
    /** After a successful undo (redo): the entry moves to the other slot, unless the slots were cleared since `gen`. */
    move(target, dir, entry, gen) {
      const s = of(target);
      if (s.gen !== gen || s[dir]?.id !== entry.id) return;
      s[dir] = null;
      s[OTHER[dir]] = entry;
    },
    /** Empties both slots. */
    clear(target) {
      const s = of(target);
      s.undo = null;
      s.redo = null;
      s.gen++;
    },
  };
}
