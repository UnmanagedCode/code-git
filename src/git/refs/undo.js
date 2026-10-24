// The undo record every ref-changing op returns as `result.undo` (docs/refs.md → Undo record): what it created,
// moved or deleted, so a later undo can put it back. A registered op's `undo` builder turns it into a plan
// (src/git/undo/plans.js, docs/undo.md).

/**
 * `refs`: [{ref, old, new, upstream?, symref?}] (old null = created, new null = deleted; a tag's oid is the tag object;
 * `upstream` the branch's upstream ref when it is deleted or created tracking one; a deleted symbolic ref is
 * {old: null, new: null, symref: its target});
 * `remoteRefs`: [{remote, ref, old, new}]; `head`: {old: {branch, oid}, new: {branch, oid}} | null;
 * `worktreeSnapshot`: a `stash create` commit of discarded tracked changes | null;
 * `stashes`: [{oid, old: {message} | null, new: {message} | null, restore: 'store' | 'pop' | 'drop'}] — the stash entries an
 * op added or removed (docs/stash.md → Undo record); `worktreePatch`: base64 bytes `git apply -R` takes back out | null;
 * `remotes`: [{name, old, new}] — a remote the op created (old null), changed or removed (new null), each side
 * {urls, pushUrls, fetch, upstreams: [{branch, merge}]} (docs/remotes.md → Undo).
 * Optional keys, present only when the op sets them (docs/undo.md → Record keys): `created` {tip, not} — the commits the
 * op made are `tip` minus everything reachable from `not`; `indexTree` — the index's tree before a mixed reset (null when
 * unmerged entries kept `write-tree` from writing it); `discard` {snapshot, tracked, untracked} — a commit of the
 * discarded paths' worktree content; `worktreeState` {paths, before, mid?, after} — a stash op's checkout states, each
 * {head, index, files} (HEAD's oid, the index's tree, the tree of `paths` in the worktree); `removedPatch` — base64 bytes
 * whose `apply -R` took stash.pushLines' lines out of the worktree.
 */
export function undoRecord({
  refs = [], remoteRefs = [], head = null, worktreeSnapshot = null, stashes = [], worktreePatch = null, remotes = [],
  created, indexTree, discard, worktreeState, removedPatch,
} = {}) {
  const optional = { created, indexTree, discard, worktreeState, removedPatch };
  return {
    refs, remoteRefs, head, worktreeSnapshot, stashes, worktreePatch, remotes,
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
  };
}
