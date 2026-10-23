// The undo record every stash op returns as `result.undo` (docs/protocol.md → Stash ops). The first four keys are the ref
// ops' record (C5's `undoRecord` in src/git/refs/undo.js, with the same defaults); `stashes` and `worktreePatch` are the
// stash's own. Whichever of C5 and C8 lands second makes this a call to `undoRecord`.

/**
 * `stashes`: [{oid, old: {message} | null, new: {message} | null, restore: 'store' | 'pop' | 'drop'}] — `store` puts a
 * dropped entry back (`stash store --message=<old.message> <oid>`), `pop` undoes a save (apply that oid, then drop it),
 * `drop` removes an entry this op added; `worktreePatch`: base64 bytes that `git apply -R` takes back out of the worktree.
 */
export function stashUndo({ refs = [], remoteRefs = [], head = null, worktreeSnapshot = null, stashes = [], worktreePatch = null } = {}) {
  return { refs, remoteRefs, head, worktreeSnapshot, stashes, worktreePatch };
}
