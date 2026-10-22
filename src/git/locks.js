/**
 * A keyed promise queue: `run(key, fn)` starts `fn` only after every earlier `fn` for the same key settled.
 * Write ops key it by project, because a project's worktrees share its refs and objects.
 */
export function createLocks() {
  const tails = new Map();
  return {
    async run(key, fn) {
      const prev = tails.get(key) ?? Promise.resolve();
      let release;
      const mine = new Promise((r) => { release = r; });
      const tail = prev.then(() => mine);
      tails.set(key, tail);
      await prev;
      try {
        return await fn();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}
