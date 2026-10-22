// The undo record every ref-changing op returns as `result.undo` (docs/refs.md → Undo record): what it created,
// moved or deleted, so a later undo can put it back.

/**
 * `refs`: [{ref, old, new, upstream?}] (old null = created, new null = deleted; a tag's oid is the tag object);
 * `remoteRefs`: [{remote, ref, old, new}]; `head`: {old: {branch, oid}, new: {branch, oid}} | null;
 * `worktreeSnapshot`: a `stash create` commit of discarded tracked changes | null.
 */
export function undoRecord({ refs = [], remoteRefs = [], head = null, worktreeSnapshot = null } = {}) {
  return { refs, remoteRefs, head, worktreeSnapshot };
}
