> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md#branch-tag-and-head-ops-srcgitopsbranchjs-tagjs-headjs) · [graph](graph.md) · [architecture](architecture.md)

# Branches, tags and HEAD

Writing refs from the graph: branches (create, checkout, rename, delete, upstream, fast-forward, force-move, delete on a remote), tags (create, push, delete locally or on a remote) and HEAD (reset, revert, cherry-pick, and continuing, skipping or aborting what stopped: [merge](merge.md)). Ops and their wire shapes: [protocol](protocol.md#branch-tag-and-head-ops-srcgitopsbranchjs-tagjs-headjs).

## Using it

### Where the actions are

| Context (right-click) | Actions, in menu order |
|---|---|
| Local branch (chip or refs row) | **Checkout** (not the checked-out branch, not one checked out in another checkout) · Create branch here… · Create tag here… · Rename… (not checked out in another checkout; never a checked-out `code-conductor/*` branch) · Set upstream… · **Fast-forward to `<upstream>`** (only when strictly behind a present upstream) · Push · Push to `<remote>`… ([remotes](remotes.md)) · Reset `<HEAD's branch>` to here › Soft / Mixed / Hard (not the HEAD branch; HEAD born) · Merge / Rebase items ([merge](merge.md#where-the-actions-are)) · Delete `<name>`… (not checked out anywhere) |
| Remote branch | **Checkout** · Create branch here… · Create tag here… · Reset `<HEAD>` to here › … · Merge / Rebase items · Delete `<branch>` from `<remote>`… |
| Several selected branches (refs panel) | Delete N branches… — checked-out branches are left out of the selection and the count, and N is at most `NAMES_MAX` (`features/branches/api.ts`, equal to `REF_LIMITS.namesMax`); hidden when none remain |
| Tag | Create branch here… · Push to `<remote>` (a **Push to** submenu with more than one remote) · Reset `<HEAD>` to here › … · Delete locally… · Delete from `<remote>`… (submenu likewise) · Jump to commit |
| Commit | Create branch here… · Create tag here… · Reset `<HEAD>` to this commit › Soft / Mixed / Hard (not HEAD's commit) · **Revert commit** (a merge: **Revert merge (keep first parent)**, `mainline: 1`) · **Cherry-pick commit** (not HEAD's commit; a merge against its first parent) · Rebase items ([merge](merge.md#where-the-actions-are)) |
| A branch dropped on another | Merge, Squash and Rebase first ([merge](merge.md#where-the-actions-are)) · **Fast-forward `<target>` to `<source>`** (target local, not checked out in another checkout) · **Push `<source>` to `<target>`** (a local source on a remote target: [remotes](remotes.md)) · **Reset `<target>` to `<source>`**: a Soft / Mixed / Hard submenu when the target is HEAD's branch, a force-move confirmation when the target is a local branch checked out nowhere, absent otherwise (a remote target) |

- Remotes for the per-remote items: `git remote`'s list (`branch.tracking`), else the remotes the graph's remote refs name.
- What is offered reads the graph's last refs answer (`features/branches/refInfo.ts`); the backend checks again. With `worktrees: null` (git < 2.36) "checked out elsewhere" is unknown: the item is offered and the backend refuses.
- **Double-click** a ref (graph chip or refs-panel row) runs its context's primary action: **Checkout** for a branch (local or remote), **Jump to commit** for a tag.
- **Toolbar Branch** button, or **Ctrl/⌘+B** while focus is in the frame and not in a text field (and no branch dialog is open): Create branch from HEAD. Disabled on an unborn HEAD.
- **Refs panel selection**: Ctrl/⌘-click toggles a branch row (local or remote), Shift-click selects the displayed branch rows (local, then each remote group, after the filter) from the last toggled row; a plain click clears the selection and jumps, as before. Tags are not selectable. Right-click a row of a selection of two or more opens the multi-selection menu; any other row opens its own.
- **Tracking badge** on each local row: `↑ahead ↓behind` against its upstream (nothing when in sync or without one), **gone** when the upstream ref is missing. Refetched (`branch.tracking`, one request in flight per project) whenever a tab's graph refs change.

### Dialogs

One dialog at a time (`state/refDialog.ts`, rendered by `features/branches/RefDialogHost.tsx`). A dialog sends nothing until its confirm button; Cancel and Esc send nothing. While its op runs the confirm button reads "Deleting…" (etc.), it cannot be closed, and a refusal shows inline (`role="alert"`, with git's stderr); success closes it with a toast.

| Dialog | From | Content |
|---|---|---|
| Create branch | Create branch here…, Branch, Ctrl/⌘+B | Name; **Check out after creating** (on by default) |
| Rename | Rename… | New name |
| Delete branches | Delete…, Delete N branches…, Delete … from `<remote>`… | Local names, then remote names grouped "On `<remote>`" (each list cut at `NAMES_SHOWN` with "…and N more"); a selection over `NAMES_MAX` deletes the first `NAMES_MAX` and says how many stay selected; **Delete branch** / **Delete N branches** (destructive). Runs `branch.delete` for the locals, then `branch.deleteRemote` per remote, each a step. Each step shows its outcome: what it deleted, and what it did not with why (a remote's rejected refs with their reasons, or the refusal). While anything is left the dialog stays open and the button reads **Retry**, which re-runs only what is left. Locals git refused as not fully merged then turn the dialog into "Delete unmerged branches?" → **Delete anyway** (`force: true` for those only) |
| Create tag | Create tag here… | Name; optional message — non-blank makes it annotated (**Create annotated tag**) |
| Delete tags | Delete locally…, Delete from `<remote>`… | Destructive **Delete**. Refs the remote rejected are listed with their reasons, and the dialog stays open |
| Set upstream | Set upstream… | A select of the remote branches (preselected: the current upstream, else the remote branch of the same name); **Unset** when one is set |
| Reset (hard) | Reset … › Hard | "Discards N staged changes and M unstaged changes (untracked files stay)" from the checkout's summary; destructive **Reset hard**. Soft and mixed run straight from the menu |
| Force-move | Reset `<target>` to `<source>`… (drop) | "`<name>` moves from `<old7>` to `<new7>`; commits only on `<name>` are no longer reachable from it"; destructive **Move branch** |
| cc HEAD move | below | the shared confirmation (`confirm()` in `lib/confirm.ts`, rendered by the Changes panel's `ConfirmHost`): the cc warning; **Switch anyway** / **Reset anyway**. It closes on confirm; the op then reports through its toast |

### Toasts

Every op from these menus and dialogs shows a toast (bottom right): a running one-click op "Checking out feature/a…", replaced in place by its outcome — success, a warning (a cherry-pick or revert stopped on conflicts, a checkout that could not fast-forward, a partly rejected push) or the refusal with git's stderr. Dialog ops toast only their success. After any outcome the tab's graph and every checkout's summary refresh (the header follows).

| Outcome | Toast |
|---|---|
| `PUSH_REJECTED` | "The remote rejected the push" + each `ref: reason` (the refusal's message names them too). A partly rejected tag push is a warning listing the same |
| `CHECKOUT_CONFLICT` | "Local changes would be overwritten" + the first `CONFLICT_FILES_SHOWN` files ("and N more") + "Commit, stash or discard these changes first." |
| Revert / cherry-pick conflicts | Warning "… stopped on conflicts", the conflicted files, **Abort** (`head.abort`). The Changes banner shows the operation with **Continue** / **Skip** / **Abort…** ([merge → The operation banner](merge.md#the-operation-banner)); a commit from the commit box concludes it too |
| `CC_OWNED_BRANCH` with `head: true` (the UI's refs were stale) | **Review…** opens the cc HEAD confirmation, whose confirm retries with the acknowledgement |

## Rules

### Checked-out branches

| Op | Refused (`BRANCH_CHECKED_OUT`, with the other checkout's path) when the branch is checked out… |
|---|---|
| `branch.checkout` | in another checkout |
| `branch.rename` | in another checkout; a `code-conductor/*` branch checked out anywhere, this checkout included (cc's worktree record names it) |
| `branch.delete`, `branch.move` | anywhere, this checkout included (this checkout's branch moves with `head.reset`) |
| `branch.fastForward` | in another checkout (this checkout's branch fast-forwards with `merge --ff-only`, updating the files) |

This checkout is recognised by its HEAD (`symbolic-ref HEAD`), other checkouts by `for-each-ref`'s `%(worktreepath)`.

### Bare repositories

Under `--work-tree=.` (`BASE_ARGS`) a bare repository's own files would look like a working tree, so every op here that writes the working tree or the index refuses one first (`BARE_REPO`, `assertWorktree` in `src/git/worktree.js`): checkout (and create with checkout), mixed and hard reset, revert, cherry-pick, continue, skip, abort, and the fast-forward of this checkout's own branch. Ops that change refs only — create without checkout, rename, delete, force-move, a free branch's fast-forward, soft reset, upstream, tags, pushes — run. In a bare repository they write only git's own ref metadata besides the ref: `--work-tree=.` makes git treat it as non-bare, so reflogs (`logs/`) are kept and a reset records `ORIG_HEAD`.

### Symbolic refs

A symbolic ref under `refs/heads` (`git symbolic-ref refs/heads/alias refs/heads/x`) reports its target's oid and no worktree, so writing through it would move or check out the target past both guards above. Checkout, rename, fast-forward, force-move and set-upstream refuse one with `SYMBOLIC_REF` (`target` = what it points at), as does checking out a remote alias such as `refs/remotes/origin/HEAD` (the graph does not list remote aliases). Delete removes the alias alone; its undo entry is `{ref, old: null, new: null, symref: <target>}`. A dangling symbolic ref (its target missing) is invisible to `for-each-ref`, so the exact name is also asked of `symbolic-ref -q`: creating a branch or tag of that name (git would create the target, possibly in another namespace), renaming from or to it, and deleting it refuse `SYMBOLIC_REF`. `update-ref` always runs with `--no-deref`. A push updates (a delete push deletes) the local ref the remote's fetch refspecs map each pushed destination to — a branch's or a tag's alike (verified with git 2.55) — and follows a symbolic one, so a symbolic mapped ref refuses the push itself (`SYMBOLIC_REF`, in `push()` for every push and remote delete). A mapped ref outside `refs/remotes/` refuses it too (`REMOTE_CONFIG_UNSUPPORTED`, `assertPushTracking`): `+refs/heads/main:refs/heads/code-conductor/wt` would move a cc branch, or one checked out elsewhere, with no acknowledgement. A ref mapped onto the pushed source itself (a tag under `+refs/tags/*:refs/tags/*`) is left out: git writes it the value it was just pushed from. The tracking refs are found through the remote's configured fetch refspecs (`src/git/remote/tracking.js`), never assumed to be `refs/remotes/<remote>/<b>`; negative refspecs are not applied (git 2.55 honours one against an exact mapping but ignores it against a wildcard one), so the check may refuse a push git would leave alone, never pass one git writes through. Every mapped tracking ref is checked although git writes only the first: a deliberate over-check, which refuses a rare config (a second refspec mapping to a symbolic ref) rather than depend on that first-only behaviour. A fetch reads every ref it may write first and refuses a live symbolic one ([remotes → Fetch](remotes.md#fetch)); a **dangling** one stays invisible until its target exists, so a fetch that creates the target (a tag it follows) is reported afterwards (`symrefsResolved`, a UI warning naming the ref and its target): the accepted residual of that check.

### code-conductor/* branches

cc owns `code-conductor/*` branches: its worktree records name them. A write that removes, renames or moves one needs `ccOwned: true`, which the UI sends only after showing a warning; without it the op refuses `CC_OWNED_BRANCH` before running anything.

| Needs the acknowledgement | No warning |
|---|---|
| `branch.delete`, `branch.deleteRemote`, `branch.move` of a cc branch; `branch.rename` from or to a cc name | `branch.create` of a cc name without checkout |
| **Moving a cc-owned HEAD** (this checkout's HEAD is `code-conductor/*`): `head.reset` in every mode; `branch.checkout` of another branch (local or remote); `branch.create` with checkout | Checking out the branch already checked out; a remote checkout whose local twin is HEAD (only a fast-forward); `branch.fastForward` of the cc HEAD branch (additive); `head.revert`, `head.cherryPick`, `merge.start`, `head.continue` (they add commits, as a commit does); checking out a cc branch from a non-cc HEAD |
| **Rebasing a cc-owned HEAD**: `rebase.start`, `rebase.interactive` in rebase mode (the editor's rebase and squash), a rebase pull ([merge](merge.md)) | `rebase.interactive` in pick mode (cherry-pick N: it only adds) |

In the UI, moving a cc-owned HEAD with an action that has no dialog (double-click or menu checkout, remote checkout, soft or mixed reset from a menu or the drop menu) opens the **cc HEAD move** confirmation (`confirmCcHeadMove` in `features/branches/actions.ts`, through `confirm()`) first ("This checkout is code-conductor's worktree on `<branch>`. Switching away / Resetting it leaves cc's worktree record, and its sync and merge, on a branch or commit the agent did not make."). The hard-reset dialog and the create-branch dialog (with checkout on) show the same warning inline instead of a second dialog. The delete, rename and force-move dialogs warn about a cc-owned name.

### Checkout

- **Local changes**: git's own rule. Changes that don't conflict are carried over; when git would overwrite one, `CHECKOUT_CONFLICT` with `files` and nothing switches (with `switch -c`, no branch is created). No automatic stash.
- **A remote branch** `<remote>/<b>`:

| Local `<b>` | Result |
|---|---|
| none | a new local `<b>` tracking it (`created: true`) |
| tracks this remote branch | switched to, then fast-forwarded to it when it is strictly behind (`fastForwarded`); local changes in the way of the fast-forward leave the switch done and the branch where it was (`ffBlocked`: the files) |
| tracks something else or nothing | switched to only (`localExisted: true`) |

### Undo record

Every ref-changing op returns `undo` (`undoRecord` in `src/git/refs/undo.js`; shape in [protocol](protocol.md#branch-tag-and-head-ops-srcgitopsbranchjs-tagjs-headjs)); the stash ops return the same record, filling its `stashes` and `worktreePatch` ([stash](stash.md#undo-record)). A tag's `old`/`new` is the tag object (unpeeled), so an annotated tag restores with its message; a deleted branch carries its `upstream`. Nothing in the UI reads it yet.

| Op | Destroys | Recoverable |
|---|---|---|
| `branch.delete` | the branch ref (and its upstream config) | `update-ref` with `undo.refs[].old`, `branch --set-upstream-to` with `upstream`; a symbolic ref: `symbolic-ref <ref> <symref>` |
| `branch.deleteRemote` | the branch on the remote | push `undo.remoteRefs[].old` (the tracking ref's last value: best known) |
| `branch.rename` | the old name | rename back |
| `branch.move` | the branch's position (commits only on it become unreachable from it) | `update-ref` back to `old`; the reflog |
| `branch.fastForward`, `branch.checkout` (fast-forward) | nothing (additive) | a branch checked out nowhere: `update-ref` back to `undo.refs[].old`; this checkout's own branch (`undo.head` set): `reset --hard <undo.head.old.oid>`, which also puts the files back |
| `branch.create`, `tag.create`, `tag.push` | nothing | delete what was created |
| `tag.delete` | the tag ref | `update-ref` with the tag object |
| `tag.deleteRemote` | the tag on the remote | push the local tag (`old` = the local tag object, else null) |
| `head.reset` soft / mixed | HEAD's position (mixed: the index too) | reset back to `undo.head.old` |
| `head.reset` hard | HEAD's position, the index and tracked worktree changes | reset back to `undo.head.old`, then `git stash apply --index <undo.worktreeSnapshot>` (a `stash create` commit, until gc; `--index` restores the staged/unstaged split, without it everything comes back unstaged). Untracked files are never touched |
| `head.revert`, `head.cherryPick` | nothing (a new commit) | reset to `undo.head.old` |
| `head.abort` | the stopped merge / rebase / revert / cherry-pick's partial result and its conflict resolutions | — |
| `merge.start` | nothing (a fast-forward or a merge commit; a squash only stages) | fast-forward / merged: reset back to `undo.head.old` |
| `rebase.start`, `rebase.interactive` | nothing until done (the old commits stay reachable from the reflog); dropped rows' changes leave the branch | done: reset the branch back to `undo.refs[].old` |
| `head.continue` | nothing (it commits what is staged and goes on) | done: reset back to `undo.head.old` (a rebase: the branch's tip before the rebase, `undo.refs`) |
| `head.skip` | the skipped commit's changes and any resolution made for it | done: as `head.continue` |

### Network ops

`branch.deleteRemote`, `tag.push` and `tag.deleteRemote` run `push()` in `src/git/remote/push.js`, through `netRun` (`NET_CONFIG` pins the `ext::` and `fd::` transports off) under `NETWORK_LIMITS`; fetch, pull and branch push follow the same rules ([remotes](remotes.md)). The push is `git push --porcelain --no-follow-tags`: `--no-follow-tags` keeps a configured `push.followTags` from publishing anything extra. Their results and undo lists hold only the requested refs; anything else git reported is listed in `unrequested`. They are **cancellable** (Cancel in the activity panel): each remote ref update is atomic on the remote, so an abort leaves at most unreferenced objects there and a stale remote-tracking ref here (the next fetch corrects it), never a half-changed index or worktree. Prompts are off: credentials must come from the System's credential helper or agent, else `REMOTE_AUTH_FAILED`. Pre-push hooks run; a refusing hook is `GIT_FAILED` with its output.

### Drag-menu orders

The `branch-drop` menu's 100–199 are the merge/rebase card's (Merge 100, Merge no-ff 101, Squash 102, Rebase 110, Interactive rebase 120: [merge](merge.md#where-the-actions-are)); Fast-forward is 200, the remotes' Push 250 (group `remote`), Reset 300.

### Git versions

These ops need git ≥ 2.24 on the project's System (`--end-of-options`; `switch` and `%(worktreepath)` come from 2.23).

## Known limitations

- **A remote whose fetch refspecs code-git cannot map** (a short source, a pattern with several `*`, or a remote without a url whose refspecs git reads from a legacy `.git/remotes` / `.git/branches` file) refuses every push and remote delete (branches and tags: git maps both through the refspecs) with `REMOTE_CONFIG_UNSUPPORTED`; push-only remotes (`pushurl`, no url, no legacy file) still push. So does a fetch refspec mapping a pushed ref onto a local ref outside `refs/remotes/`.
- **A remote ref's undo value is best known**: the local tracking ref or tag, which may lag the remote.
- **A branch mid-rebase in another checkout is not seen as checked out** by fast-forward and force-move (that checkout is detached while rebasing); delete and rename still get git's own check.
- **Fast-forward from the drop menu is offered without checking ancestry**: a drop of an older branch is refused (`NOT_FAST_FORWARD`) by the backend.
- **Checkout never stashes, merges or rebases on its own**: local changes that block a checkout must be committed, stashed or discarded first; merging and rebasing are actions of their own ([merge](merge.md)).
