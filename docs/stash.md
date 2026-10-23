# Stash

Save, view, apply, pop, drop, rename and branch from stashes. The user-facing summary is in [features](features.md#stash); this page is the reference: the op contracts, the gates, the undo record and the UI wiring. Gotchas behind the design: `.wiki/gotchas/stash.md`.

## Model

- A stash is git's three commits: **W** (the worktree; parents: the base commit, then I, then U when present), **I** (the index; parent: the base) and **U** (untracked files; a root commit, only with `--include-untracked`).
- Every op names a stash by **W's full oid** (`assertOid`), never by `stash@{n}`: all checkouts of a project and every other session share one stash stack, so an index read earlier may name another stash by now. `resolveStash` (`src/git/stash/resolve.js`) finds the oid in `git stash list --no-show-signature --no-ext-diff --no-textconv --format=%H%x00%P%x00%gs`; absent → 404 `STASH_UNKNOWN`. `n` is the entry's position in that list.
- A stash's message is its reflog subject (`%gs`, what `stash store --message` takes back) and W's commit subject (`%s`, what `graph.refs` shows). Rename re-commits W so both agree.

## Ops (`src/git/ops/stash.js`)

Every stash op is `kind: 'write'` and **not cancellable**: an aborted stash or apply can leave `index.lock`, a half-applied merge or a half-restored untracked set. Each command takes the project's write lock.

### Gates

| Gate | Where | Refusal |
|---|---|---|
| Not a bare repository (`assertWorktree`) | every op that writes the worktree or the index: push, pushLines, apply, pop, applyFile, branch | 409 `BARE_REPO` |
| HEAD born (`rev-parse --verify --quiet HEAD^{commit}`) | push, pushLines | 409 `NO_HEAD` |
| No unmerged index entries (`ls-files -u -z` prints nothing) | push, apply, pop, branch | 409 `CONFLICTED` |
| **`assertNotBlocked(paths)`** (`src/git/stash/guard.js`): every proper leading directory of the paths (`a/b/c` → `a`, `a/b`) is run through `ls-files --others --directory -z -- <dirs>` in `STAGE_LIMITS.argvChunkBytes` chunks, without `--exclude-standard`. An entry equal to a leading directory is an untracked (or ignored) symlink or file standing where a directory must be. With `core.ignorecase` true the comparison folds ASCII case and each leading directory's *parent* is listed as well (the root when any is top-level; capped at `STASH_LIMITS.pathsMaxOutputBytes`), because git refuses `GIT_ICASE_PATHSPECS` with `GIT_LITERAL_PATHSPECS`; the directories stay queried too, since a parent's listing names a fully untracked directory `u/` and nothing under it. An unparsable `core.ignorecase` reads as false (git then fails every command anyway, with its own message) | push (the paths it saves — below), pushLines (the file), apply / pop / branch (the stash's whole path set), applyFile (the file) | 409 `PATH_BLOCKED`, `paths` = the first 100 found |
| **`assertFileTarget(path)`**: the path itself, by the raw `diff --no-index /dev/null <path>` probe (`worktreeEntry`, `src/git/diff/noIndex.js`): a directory or a link to one — what a patch naming the file cannot change in place. A symlink to a file passes: `git apply` replaces or deletes the link itself (or refuses "wrong type"), never writing through it | applyFile, pushLines | 409 `PATH_BLOCKED`, `paths: [path]` |
| **`assertNoUntrackedCollision(untracked)`**: `ls-files -c -o -z -- <U's paths>` prints nothing (no tracked, untracked or ignored file where the stash's untracked file goes) | apply, pop, branch | 409 `CHECKOUT_CONFLICT`, `files` |
| Version floor: `git version` on the project's System ≥ 2.35 | push with `staged` | 409 `GIT_TOO_OLD`, `{feature, need, have}` (`have: null` when `git version` does not parse `^git version (\d+)\.(\d+)`) |

The paths a stash writes (`stashPaths`): `diff-tree -r -z --name-only --no-renames --no-ext-diff --no-textconv <base> <W>` ∪ the same for `<base> <I>`, plus `ls-tree -r -z --name-only --full-tree <U>`; each listing is capped at `STASH_LIMITS.pathsMaxOutputBytes` (`src/git/stash/limits.js`; over it → `OUTPUT_TOO_LARGE`).

### `stash.push`

- `params`: `{message?, paths?, includeUntracked?, keepIndex?, staged?}`.
  - `message`: trimmed; one line, no control characters, ≤ `STASH_LIMITS.messageMax` characters (`checkMessage`, `src/git/stash/message.js`); blank = none.
  - `paths`: 1…`STAGE_LIMITS.maxPaths`, `assertPath` each.
  - `staged` with `includeUntracked` or `keepIndex` → 400 `BAD_PARAMS`.
- Guarded paths: with `paths`, the paths themselves plus what they expand to — `diff-index -z --name-only --no-renames HEAD -- <paths>` (chunked) and, with `includeUntracked`, `ls-files --others --exclude-standard -z -- <paths>` (a directory pathspec names no leading directory of its own); else, for `staged`, `diff --cached --name-only -z --no-renames --no-relative --no-ext-diff --no-textconv`; else `diff-index -z --name-only --no-renames HEAD`, plus every untracked file (`ls-files --others --exclude-standard -z`) with `includeUntracked`.
- Runs `git stash push [--staged] [--keep-index] [--include-untracked] [--message=<m>]`, with `--pathspec-from-file=- --pathspec-file-nul` and the paths on stdin when there are paths. **Without paths, `includeUntracked` or `keepIndex` sends the pathspec `.`**: git's own cleanup (`clean … :/`) and keep-index checkout (`checkout … -- :/`) name `:/`, which `GIT_LITERAL_PATHSPECS=1` turns into a literal path matching nothing — `-u` would leave the untracked files in place (exit 0), `--keep-index` fails.
- **No `-q`**: git's "No local changes to save" on **stdout** (`LC_ALL=C`) → 409 `NOTHING_TO_STASH`. Never stderr: git sends a `reference-transaction` hook's output there, so a hook could print the line during a save that stored a stash. Comparing `refs/stash` before and after would take another session's push for this one.
- **Which entry is ours** (`ownNewStash`): among the entries newer than the `refs/stash` read before the push, the one whose first parent is this HEAD and whose subject is what git writes for this message on this branch (`On <branch>: <message>`, or `WIP on <branch>: …` without one). When that pre-push tip is no longer in the list (another session dropped it), which entries are new cannot be told: unverified. Exactly one match → `{oid, selector: 'stash@{k}', undo}` (`k` > 0 when another session pushed after it). None or several (another session saved a stash at the same base with the same subject at the same moment) → `{oid: null, selector: null, unverified: true, undo}` with no `stashes` entry: no undo claims a stash that may not be this save's.
- **A failed save may have stored a stash**: `--staged` with a file staged and then changed again exits 1 after storing it; `--keep-index` can fail after storing it and resetting the index. The same check runs after a `GIT_FAILED`; when it finds this save's stash, the refusal carries `{oid, selector}` and says the changes are in that stash — no `undo`: the worktree and index may still hold the same changes (the `--staged` case), and popping the stash would apply them twice. The stash is kept, not dropped: it may be the only copy of what git already took out of the index. The UI's save dialog shows the error and a toast "A stash was created despite the error".
- `result`: `{oid, selector, undo}`, or the unverified shape above.

### `stash.pushLines`

Selected hunks or lines of one file. Same request as the line staging ops (`selectionParams`, `src/git/stage/readSelection.js`; [protocol → Stage selection](protocol.md#stage-selection-stagestagelines-stageunstagelines-stagediscardlines-write)) plus `message?`.

1. `diff --cached --quiet --no-ext-diff --no-textconv --end-of-options <HEAD> -- <path>` exits 1 (the file has staged changes) → 409 `PARTIAL_UNSUPPORTED`. With the index at HEAD for the path, the index → worktree diff is the HEAD → worktree one.
2. `assertNotBlocked([path])` and `assertFileTarget(path)` (no directory or link to one at the file). A tracked symlink whose target changed is stashed like any one-hunk file; `apply -R` puts the link back. A file turned into a symlink is a type change: `PARTIAL_UNSUPPORTED`.
3. Two patches from the one selection, both built (`readSelectionPatch`) before anything is written: **forward** (what `stage.stageLines` applies; fits HEAD) and **reverse** (what `stage.discardLines` applies; fits the worktree, which still holds the unselected changes). The selection refusals (`STALE_DIFF`, `SELECTION_UNSUPPORTED`) come from here.
4. On a temporary index `GIT_INDEX_FILE=$(git rev-parse --git-path code-git-stash-index)`: `read-tree <HEAD>`, `apply --cached --whitespace=nowarn --no-ignore-whitespace -` (the forward patch), `write-tree`.
5. `commit-tree --no-gpg-sign -p <HEAD> -F - <HEAD>^{tree}` → I (`index on <branch>: <abbrev> <subject>`); `commit-tree --no-gpg-sign -p <HEAD> -p <I> -F - <tree>` → W (`On <branch>: <message>`, or `WIP on <branch>: <abbrev> <subject>`). `<branch>` is the short branch, `(no branch)` when detached. Identity: the configured one; when `git var GIT_COMMITTER_IDENT` fails (exit 128), git stash's fallback `git stash <git@stash>` as `GIT_AUTHOR_*` / `GIT_COMMITTER_*`.
6. `stash store --message=<W subject> <W>`.
7. `apply -R --whitespace=nowarn --no-ignore-whitespace -` (the reverse patch, worktree only). A failure here → `GIT_FAILED` with `step: 'removeFromWorktree'`, `oid` (the stored stash) and `undo`: the stash holds the lines and the worktree still has them.

- Never `apply --index`. The temporary index file stays in the git dir, overwritten on each use.
- `result`: `{oid, selector: 'stash@{0}', undo}`.

### `stash.apply` / `stash.pop`

- `params`: `{oid, index?}` for both. `index: true` → `--index` (restore what was staged as staged). The UI's Pop sends `{oid}`.
- Gates, then `git stash apply -q [--index] <oid>`, accepting exit 0 and 1. Exit 1: unmerged entries afterwards (`ls-files -u -z`) → ok with `conflicts` = their paths; git's "… would be overwritten" (`parseConflictFiles`: the tab-indented list of checkout and merge, and the two-space one `--index` prints before "Index was not unstashed.") → 409 `CHECKOUT_CONFLICT` with `files` and `stderr`; anything else → 422 `GIT_FAILED`.
- **`--index` and the user's staging.** git resets the index to HEAD before its merge; when the merge then refuses to start ("Index was not unstashed." with no unmerged entry), staged changes — even ones the stash never touches — are left unstaged. When something is staged (`diff-index --cached --quiet HEAD` exits 1), the index is saved first (`write-tree`) and read back (`read-tree <tree>`) in that case only. git prints the same line after a **conflicted** merge, whose index (the unmerged entries and the other staging) it kept: unmerged entries are checked first and returned as `{conflicts}`, and that index is never touched. Index-only state a tree does not hold (stat data, intent-to-add, skip-worktree bits) is not restored.
- **No confirmation**: git refuses to overwrite a local change (`CHECKOUT_CONFLICT`, nothing written), and a conflict only adds markers to files that were clean. A file with any local change refuses even when the merge would be clean, so a line stash pops only onto a clean file; `stash.applyFile` applies it into an edited one.
- `pop`: after a clean apply, `dropVerified` (below). With conflicts the stash is kept (`dropped: false`), as git does. A drop refused `STASH_MOVED` is reported, not thrown: `dropped: false, dropError: 'STASH_MOVED'`.
- `result`: apply `{conflicts, undo}`; pop `{conflicts, dropped, dropError?, undo}`.

### `stash.applyFile`

- `params`: `{oid, path}`; `path` names one file (`filePath`).
- The part: `diff-tree -r -z --name-only --no-renames <base> <W> -- <path>` listing exactly `path` → `tracked` (from `base` to `W`); else `cat-file -t <U>:<path>` = `blob` → `untracked` (from the empty tree to `U`); else 404 `PATH_NOT_IN_COMMIT` (an unchanged file, a directory, an absent path). A gitlink (`ls-tree` mode `160000`) → 409 `PARTIAL_UNSUPPORTED`.
- Gates: `assertNotBlocked([path])`, then `assertFileTarget(path)`. A symlink to an outside file where the stash has a regular file: `git apply` refuses "wrong type" (`PATCH_DOES_NOT_APPLY`); a stash that turns the link into a file replaces it.
- `DIFF_CONFIG diff DIFF_FLAGS --binary --end-of-options <from> <to> -- <path>` (capped `DIFF_LIMITS.patchMaxOutputBytes`), then `git apply --whitespace=nowarn --no-ignore-whitespace -` — **worktree only**, never `--index`, `--cached` or `--3way`. Atomic; a file that differs from the stash's base is refused, never overwritten: exit 1 or 128 → 409 `PATCH_DOES_NOT_APPLY` with `exitCode`, `stderr`.
- `result`: `{oid, path, part: 'tracked' | 'untracked', undo}`; `undo.worktreePatch` is the applied patch (base64).

### `stash.drop`

- `params`: `{oid}`. `dropVerified(git, oid)`: re-resolve `n`, `git stash drop stash@{n}`, parse `^Dropped (stash@\{\d+\}) \(<oid>\)$` (LC_ALL=C). When git names another oid, a concurrent push or drop moved the indices: that entry is put back at once (`stash store --message=<its subject> <oid>`, at the top) and 409 `STASH_MOVED` refuses (`{oid, restored}`).
- `result`: `{oid, undo}`.

### `stash.rename`

- `params`: `{oid, message}`; `message` non-empty after trim, and the new subject must differ from the current one (else 400 `BAD_PARAMS`).
- New subject: the old one's `On <branch>: ` / `WIP on <branch>: ` prefix keeps its branch, `On <branch>: <message>`; a subject git did not write is replaced whole.
- `log -1 --no-show-signature --date=raw --format=%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd` → the `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env, then `commit-tree --no-gpg-sign -p <each parent> -F - <oid>^{tree}`: same tree, parents, identities and dates.
- **Store first** (`stash store --message=<subject> <new>`), then `dropVerified` the original. A failed drop refuses with the drop's code plus `step: 'dropOriginal'` and `newOid`: both entries exist, nothing is lost.
- The renamed stash is `stash@{0}` (git can only store at the top); the UI says so.
- `result`: `{oid: <new>, previous: <oid>, undo}`.

### `stash.branch`

- `params`: `{oid, name, ccOwned?}`; `name` is a short branch name (`shortBranch`: `assertRefName`, not `HEAD`, not `refs/…` → 400 `BAD_REF`).
- `refs/heads/<name>` resolves (a branch, or a symbolic ref to one) → 409 `REF_EXISTS`; a dangling symbolic ref of that exact name (`assertNoSymref`, as `branch.create`) → 409 `SYMBOLIC_REF` `{target}`: `switch -c` would create its target under this name. This checkout's HEAD is a `code-conductor/*` branch and `ccOwned` is not true → 409 `CC_OWNED_BRANCH` `{branches, head: true}` (the UI confirms and resends).
- Gates, then `git switch --no-guess --no-track -c <name> --end-of-options <base>` ("… would be overwritten" → 409 `CHECKOUT_CONFLICT`, no branch), then `git stash apply -q --index <oid>` classified as in apply, then `dropVerified` when clean.
- A refusal from the apply step (the branch exists and is checked out, the stash untouched) carries `step: 'apply'`, `ref` and `undo`.
- `result`: `{ref, base, conflicts, dropped, dropError?, undo}`.

## Undo record

Every op returns `result.undo`: the ref ops' record (`undoRecord`, `src/git/refs/undo.js`; [refs → Undo record](refs.md#undo-record)) — `refs`, `remoteRefs`, `head`, `worktreeSnapshot` — whose two stash keys the stash ops fill (empty for every ref op).

| Key | Shape | Undo |
|---|---|---|
| `stashes` | `[{oid, old: {message} \| null, new: {message} \| null, restore}]` | `restore: 'store'` → `stash store --message=<old.message> <oid>` (a dropped entry back, at the top); `'pop'` → apply that oid, then drop it (a save undone); `'drop'` → drop that oid (a rename's copy) |
| `worktreePatch` | base64 \| null | `git apply -R` of those bytes |

| Op | `undo` |
|---|---|
| push, pushLines | `stashes: [{oid: <new>, old: null, new, restore: 'pop'}]`; an unverified push, and a failed push that stored a stash (the refusal names it): none |
| drop; pop when dropped | `stashes: [{oid, old, new: null, restore: 'store'}]` |
| rename | `[{oid: <new>, restore: 'drop'}, {oid: <original>, restore: 'store'}]` |
| applyFile | `worktreePatch` |
| branch | `refs: [{ref, old: null, new: <base>}]`, `head: {old: {branch, oid}, new: {branch: ref, oid: base}}`, plus the dropped entry when dropped |
| apply; the worktree effect of pop and branch | empty: a merge into the worktree is not undoable |

## UI (`frontend/src/features/stash/`)

| File | Role |
|---|---|
| `api.ts` | Wire types (`StashUndo`, results) and `runOp` wrappers; always the oid |
| `run.ts` | `runStashOp(tab, labels, fn)`: the toast, then `refreshAfterWrite` + `refreshGraph(tab, 'write')` whatever the outcome; `CHECKOUT_CONFLICT` → "Local changes would be overwritten" naming the files; `appliedToast` (a conflict is a warning naming the files, "The stash was kept." for pop and branch) |
| `views.ts` | `stashViewOf(stashes, oid)` (W → all, I → staged, U → untracked), `stashViewSource`, `viewsOf`, `messageOf` |
| `StashViewSwitch.tsx` | The radiogroup "Stash view" in the diff header, in place of the parent select |
| `actions.ts` | `STASH_ACTIONS` (group `stash`, orders 400–405), `openStashSave`, `applyStash`, `popStash`, `dropStash`, `applyStashFile` |
| `dialogs/` | Save, Rename, Create branch; each shows a refusal inline and toasts only success |
| `StashDialogHost.tsx` | Renders the open dialog from `state/stashDialog.ts`; mounted by `Shell` |

| Diff view | Source |
|---|---|
| All changes | `{kind: 'commit', rev: W, parent: 1}` (base → W: staged and unstaged together, `git stash show -p`) |
| Staged | `{kind: 'commit', rev: I}` (I's only parent is the base) |
| Untracked | `{kind: 'commit', rev: U}` (a root: against the empty tree); only when U exists |
