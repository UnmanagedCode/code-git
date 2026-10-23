// The undo record every ref-changing op returns as `result.undo` (docs/refs.md → Undo record): what it created,
// moved or deleted, so a later undo can put it back.

/**
 * `refs`: [{ref, old, new, upstream?}] (old null = created, new null = deleted; a tag's oid is the tag object);
 * `remoteRefs`: [{remote, ref, old, new}]; `head`: {old: {branch, oid}, new: {branch, oid}} | null;
 * `worktreeSnapshot`: a `stash create` commit of discarded tracked changes | null;
 * `stashes`: [{oid, old: {message} | null, new: {message} | null, restore: 'store' | 'pop' | 'drop'}] — the stash entries an
 * op added or removed (docs/stash.md → Undo record); `worktreePatch`: base64 bytes `git apply -R` takes back out | null;
 * `remotes`: [{name, old, new}] — a remote the op created (old null), changed or removed (new null), each side
 * {urls, pushUrls, fetch, upstreams: [{branch, merge}]} (docs/remotes.md → Undo).
 */
export function undoRecord({ refs = [], remoteRefs = [], head = null, worktreeSnapshot = null, stashes = [], worktreePatch = null, remotes = [] } = {}) {
  return { refs, remoteRefs, head, worktreeSnapshot, stashes, worktreePatch, remotes };
}
