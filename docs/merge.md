# Merge, rebase and conflicts

Merging and rebasing a checkout's branch, what is in progress in it, and continuing, skipping or aborting it. Wire shapes: [protocol → Merge, rebase and conflict ops](protocol.md#merge-rebase-and-conflict-ops). The ref and HEAD rules these ops share (the cc HEAD gate, undo records): [refs](refs.md).

## Using it

### Where the actions are

HEAD (its branch and commit) is read from the graph's refs answer; the backend checks again. Group `rewrite` beside reset (300), revert (310) and cherry-pick (311).

| Context | Item (order) | Offered when |
|---|---|---|
| A branch dropped on HEAD's branch | **Merge `<S>` into `<T>`** (100) · **Merge `<S>` into `<T>` (no fast-forward)** (101) · **Squash `<S>` into `<T>`** (102) | the target is HEAD's branch and the two commits differ |
| A branch dropped on another | **Rebase `<X>` onto `<Y>`** (110) | one side is HEAD's branch (`X`), the commits differ: HEAD's branch dragged onto `Y`, or `Y` dropped on HEAD's branch |
| Branch (local or remote) | **Merge `<b>` into `<HEAD>`** (330) · **Rebase `<HEAD>` onto `<b>`** (331) | not HEAD's branch, not at HEAD's commit; HEAD born. `<HEAD>` is HEAD's branch, or `HEAD` when detached |
| Commit | **Rebase `<HEAD>` onto this commit** (312) | not HEAD's commit and not an ancestor of HEAD among the loaded rows; HEAD born |
| Several commits | **Rebase N commits onto…** (322) | the selection is one first-parent run (each commit the parent of the one above it, none a merge or a root) whose newest commit is HEAD's: the dialog below |

- **Rebase N commits onto…** opens a dialog (`state/sequenceDialog.ts`, rendered by `SequenceDialogHost`, mounted by the shell) listing every other local and remote branch; **Rebase** replays the N commits onto the picked branch (`upstream` = the oldest's parent, so older commits leave the branch). On a `code-conductor/*` HEAD the dialog shows the cc warning inline and sends `ccOwned`. A refusal stays inline.
- **Merge** (any mode) runs at once: it only adds commits. A **rebase** of a `code-conductor/*` HEAD asks first (the cc HEAD gate, `withCcHeadAck`, "Rebasing it"), and a stale-refs `CC_OWNED_BRANCH` reopens that confirmation from the toast.

### The operation banner

The Changes panel (and the **Changes (n)** dialog below `lg`) shows a banner, under the detached-HEAD one, whenever `commit.state` reports something in progress. It is read from git's own state, so it shows after a reload or when the operation was started outside code-git.

| State | Banner |
|---|---|
| A merge, rebase, cherry-pick or revert in progress | Its title (below), then what to do next, then **Continue** · **Skip** (not for a merge) · **Abort…** |
| Unmerged files with nothing in progress (a squash merge, a stash apply) | "N conflicted files: resolve them, then stage them", no buttons |
| Nothing | No banner |

- **Titles** (`operationTitle` in `frontend/src/features/sequence/labels.ts`): "Rebasing `<branch>` onto `<onto>` (step i of n)", "Merging `<incoming>` into `<HEAD's branch>`", "Cherry-picking `<oid7> <subject>`", "Reverting `<oid7> <subject>`". A commit is named by its first local branch, else a remote branch, else its short oid; a part the state does not give is left out.
- **What to do next**: "N conflicted files — resolve them, then Continue" while any path is unmerged; a rebase with nothing staged: "Stopped at `<oid7>`: amend if you like, then Continue" (an `edit` stop); otherwise "Conflicts resolved: Continue".
- **Continue** is disabled while any path is unmerged. During a rebase the detached-HEAD banner is hidden (a rebase detaches HEAD for its whole run).
- Every ref op from the UI (`runRefOp`) reloads the panel's state once the panel has loaded, so a cherry-pick or revert that stops shows the banner at once; a pull does too.

### Toasts and confirmations

| Action | Confirmation | Outcome toast |
|---|---|---|
| A merge | none | "`<T>` is already up to date with `<S>`" / "Fast-forwarded `<T>` to `<S>`" / "Merged `<S>` into `<T>`"; conflicts: "The merge stopped on conflicts" with **Resolve…** and **Abort…** |
| A squash | none | "Squashed `<S>` into the index" — the commit box is filled with git's prepared message (`SQUASH_MSG`, comments stripped: summary + description) and Changes opens, where the staged result is committed; conflicts: "The squash stopped on conflicts" with **Resolve…** only (a squash leaves no operation to abort) |
| A rebase | the cc HEAD gate only | "Rebased `<X>` onto `<Y>`" / "`<X>` is already up to date with `<Y>`"; conflicts as for a merge |
| **Continue** | none (it only adds commits) | done: "Merge committed" / "Rebase finished" / "Cherry-pick committed" / "Revert committed"; new conflicts: a warning "The `<kind>` stopped on conflicts" with the files, **Resolve…** (opens Changes) and **Abort…**; an `edit` stop: "Stopped to edit `<oid7>`" |
| **Skip** | "Skip this commit?" (**Skip commit**) — the commit's changes and any resolutions made for it are left out | as Continue |
| **Abort…** | "Abort the `<kind>`?" (**Abort `<kind>`**, irreversible) — discards the operation and its resolutions; HEAD (a rebase: the branch) goes back | "`<Kind>` aborted" |
| A pull that stops on conflicts (merge or rebase) | — | "The pull stopped on conflicts" with the files and **Abort merge…** / **Abort rebase…** (the Abort confirmation above) |

Start refusals with a toast of their own: `OPERATION_IN_PROGRESS` "Something is already in progress: continue or abort it first", `CONFLICTED`, `DIRTY_WORKTREE` "Commit or stash first", `HAS_MERGES` "The commits to rebase include a merge: rebase them with git", `REF_MOVED` "The branch moved: refresh and try again". Continue refusals: `CONFLICTED` "Resolve the conflicts first" (the files still unmerged), `NOTHING_TO_COMMIT` "Nothing to commit here: skip this commit, or abort", `DIRTY_WORKTREE` "Stage or discard the unstaged changes first".

## Rules

### Merge

`merge.start {ref, oid, mode, expect}` (`src/git/ops/merge.js`):

1. Gates, in order: `assertWorktree` (`BARE_REPO`), `assertNoOperation`, HEAD born (`NO_HEAD`) and at `expect` (`REF_MOVED`), `oid` a commit (`REV_UNKNOWN`), `ref` (when given) still at `oid` (`REF_MOVED`). No cc acknowledgement: a merge only adds.
2. `oid` is HEAD or an ancestor of it (`merge-base --is-ancestor`) → `upToDate`, nothing runs.
3. `merge()` (`src/git/remote/integrate.js`): `-c merge.autoStash=false merge <mode flags> --no-stat --end-of-options <oid>`, exit 0 or 1, `SEQUENCE_LIMITS.timeoutMs`. Mode flags: `ff` → `--ff --no-edit -m <message>`, `noFf` → `--no-ff --no-edit -m <message>`, `squash` → `--squash`. Exit 2 (local changes in the way) → `CHECKOUT_CONFLICT` with the files.
4. **Message** (git's own style, from the validated `ref`): `Merge branch '<b>'` (`refs/heads/`), `Merge remote-tracking branch '<r>/<b>'` (`refs/remotes/`), `Merge tag '<t>'` (`refs/tags/`), `Merge commit '<oid7>'` (no `ref`).
5. **Outcome**: `fastForward` (mode `ff` and HEAD was an ancestor), `merged`, `squashed` (`message` = `$GIT_DIR/SQUASH_MSG` read with `readNoIndex`, through `git stripspace -s`), or `conflicts` with the files — a merge left in progress; a squash's conflicts have no `MERGE_HEAD`, so they show as conflicts with no operation.
6. **Undo** (fast-forward, merged): the branch from HEAD before to HEAD after; `undo.head`. A squash only stages: no undo.

### Rebase

`rebase.start {onto, upstream, expect, ccOwned?}` (`src/git/ops/rebase.js`) replays `upstream..HEAD` onto `onto` — `git rebase --onto=<onto> <upstream>`. The menus pass `upstream = onto` (rebase onto a branch or commit) or the oldest selected commit's parent (N commits).

1. Gates (`rebaseGates`), in order: `assertWorktree`; git ≥ 2.26 (`assertGitAtLeast`, `GIT_TOO_OLD`: `--empty` arrived then); `assertNoOperation`; HEAD born and at `expect`; `assertCcHeadAck` (`CC_OWNED_BRANCH`, `head: true`); `assertClean` (`DIRTY_WORKTREE`); `upstream` a commit; `rev-list --merges --count <upstream>..HEAD` > 0 → `HAS_MERGES` (a rebase would flatten merges; `rebase.rebaseMerges` is pinned off); then `onto` a commit.
2. Runs `rebase(git, ['--onto=<onto>', '--end-of-options', <upstream>])` with `SEQUENCE_LIMITS.timeoutMs` (600 000 ms, cc's maximum). Every rebase passes `REBASE`'s pins: `rebase.autoStash`, `rebase.updateRefs`, `rebase.autoSquash` false; `rebase.backend=merge`; `rebase.rebaseMerges=false`.
3. **Outcome**: `upToDate` (exit 0, HEAD unchanged, nothing in progress), `done` (undo: the branch from its old tip to the new one, `undo.head`), `conflicts` (left in progress: the stop rule below), `stopped`.

### State detection

`operationState` (`src/git/sequence/state.js`) is the one reader; `commit.state` returns it.

1. `cat-file --batch-check` with `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `REBASE_HEAD` on stdin: each answers `<oid> commit <size>` or `<name> missing`.
2. `symbolic-ref -q HEAD` (exit 0 or 1) and `ls-files -u -z` (the unmerged entries) run beside it. Three commands when nothing is in progress.
3. Only when HEAD is detached or `REBASE_HEAD` exists: `rev-parse --git-path rebase-merge`; `rebase-apply` is its sibling in the same git dir (one path, never a split output). `worktreeEntry` (`src/git/diff/noIndex.js`): `rebase-merge` a directory → the merge backend; else `rebase-apply/rebasing` a file → the apply backend. `rebase-apply/` without `rebasing` is `git am`: not reported.
4. A rebase's files, read with `readNoIndex` (each ≤ 4 KiB, first line): `head-name`, `onto`, `orig-head`, and `msgnum`/`end` (merge) or `next`/`last` (apply). `head-name` must be `refs/heads/<valid name>`, `onto` and `orig-head` full oids, the counts integers; anything else is `null`. The files are the repository's, never trusted.
5. The incoming commit's subject: `log --no-walk=unsorted -z --format=%H%x00%s --stdin`.

**Precedence**: rebase > merge > cherry-pick > revert. `REBASE_HEAD` without its directory is a leftover, not a rebase. `conflicts` is independent of `operation`.

**Conflict kinds** (`parseUnmerged`, `src/git/parse/unmerged.js`), by the stages present (1 base, 2 ours, 3 theirs):

| Stages | `kind` |
|---|---|
| 1, 2, 3 | `bothModified` |
| 2, 3 | `bothAdded` |
| 1, 2 | `deletedByThem` |
| 1, 3 | `deletedByUs` |
| 2 | `addedByUs` |
| 3 | `addedByThem` |
| 1 | `bothDeleted` |

### Labels: Current and Incoming

"Current" is stage 2 (ours) and "Incoming" stage 3 (theirs) for every operation (`sideLabels` in `frontend/src/features/sequence/labels.ts`):

| Kind | Current | Incoming |
|---|---|---|
| merge | HEAD's branch | the incoming commit's first local branch, else a remote branch, else its short oid |
| rebase | "`<onto>` (rebased so far)" — during a rebase stage 2 is the onto side with the commits replayed so far | "`<oid7> <subject>`", the commit being replayed |
| cherry-pick | HEAD's branch | "`<oid7> <subject>`" |
| revert | HEAD's branch | "revert of `<oid7>`" |
| nothing | "Current" | "Incoming" |

### Starts refuse while something is in progress

`assertNoOperation` (`src/git/sequence/guard.js`) runs before `merge.start`, `rebase.start`, `head.revert`, `head.cherryPick` and `remote.pull` start anything: `OPERATION_IN_PROGRESS` (`operation`: the kind) while an operation is in progress, else `CONFLICTED` (`files`) while any path is unmerged. `assertClean` (`DIRTY_WORKTREE`: a staged or unstaged tracked change; untracked files do not count) lives beside it.

### Continue, skip and abort

- `head.continue {which}` and `head.skip {which}` refuse `NOTHING_IN_PROGRESS` unless `which` is the kind `operationState` reports; continue refuses `CONFLICTED` (`files`) while any path is unmerged, before running anything.
- They run `<which> --continue` / `--skip` (a rebase with the `REBASE` pins of `src/git/remote/integrate.js`) with env `GIT_EDITOR=:`: git's no-op editor keeps the message git prepared (the picked commit's, a merge's). `--continue` launches the editor; with `BASE_ENV`'s `false` it would fail.
- **Never aborted on a failure**: the operation stays in progress and the refusal carries git's `stderr`. git's wording (pinned by `tests/sequence-git-probes.test.js`): "nothing to commit" / "is now empty" → `NOTHING_TO_COMMIT`; "unstaged changes" / "You must edit all merge conflicts" → `DIRTY_WORKTREE`; anything else `GIT_FAILED`.
- **Outcome**, from the state read again: unmerged paths → `conflicts`; still in progress (an `edit` stop) → `stopped`; else `done` with an undo. A rebase's undo is the whole rebase: the branch (`head-name`) from `orig-head` to the new tip; the others' is HEAD's branch from the HEAD before the continue.
- `head.abort {which}` detects the operation the same way and runs `<which> --abort`.
- `head.skip` takes `rebase`, `cherry-pick` or `revert` (`BAD_PARAMS` for `merge`: git has no `merge --skip`).

### The stop rule

A merge or rebase that stops on conflicts stays in progress, whoever started it. `onRebaseStopped` (`src/git/remote/integrate.js`) is the single policy point: it answers `{outcome: 'conflicts', files}`. `rebase(git, args, {env, stdin, timeoutMs})` there answers `done`, `stopped` (exit 0, still in progress) or onRebaseStopped's answer; any other failure is aborted (`rebase --abort`, exit 128 when nothing is left) and refused (`CHECKOUT_CONFLICT` for untracked files in the way, else `GIT_FAILED`).

## Known limitations

- **`git am` in progress is not shown** (its `rebase-apply/` has no `rebasing`).
- **A multi-commit cherry-pick or revert run by git's sequencer and left stopped after a manual `git commit`** (no `CHERRY_PICK_HEAD` / `REVERT_HEAD` left, only `.git/sequencer/`) is not detected.
- **A branch or tag named `MERGE_HEAD`, `CHERRY_PICK_HEAD` or `REVERT_HEAD` reads as that operation in progress**: `cat-file` resolves the name to the ref when the pseudo-ref is absent (git warns about such names). A rebase needs its state directory, so it is not affected.
- **Commit-message `#` lines can be stripped by `--continue`**: git's cleanup for a message it prepared is `strip` unless `commit.cleanup` says otherwise.
- **Gates are check-then-act**: each command takes the project lock on its own, so another op can run between the state read and git's own run.
