# Gotcha: stash

Code: `src/git/ops/stash.js`, `src/git/stash/`. Reference: `docs/stash.md`. Raw git behaviour is pinned by `tests/stash-git-probes.test.js`.

## Addressing

- **Oids, never `stash@{n}`, on the wire.** Every checkout of a project and every other session share one stash stack; an index read by the UI may name another stash by the time the op runs. `resolveStash` re-reads the list and finds the oid.
- **`git stash drop` takes only `stash@{n}`**, so a drop re-resolves `n` and then checks git's `Dropped stash@{n} (<oid>)` line (`dropVerified`). A mismatch means the list moved in between: the wrong entry is stored back at once (it lands at the top) and `STASH_MOVED` refuses.
- **Rename is store-then-drop.** git can only store at the top, so a renamed stash becomes `stash@{0}`; storing the copy before dropping the original means a failure leaves two entries, never zero.
- **A stash's message lives twice**: the reflog subject (`%gs`, what `stash store --message` writes) and W's commit subject (`%s`, what `graph.refs` shows). Rename re-commits W with the new subject (same tree, parents, identities, dates via `--date=raw` env) so both agree.

## Saves on a shared stack

- **A no-op save is read from git's stdout** ("No local changes to save", so no `-q`), never from `refs/stash` before/after (another session's push in between would look like this save) and never from stderr: git forwards a `reference-transaction` hook's stdout to its own stderr.
- **The new tip may not be ours.** `ownNewStash` looks among the entries newer than the pre-push tip for the one with this HEAD as base and the subject git writes for this message and branch; zero or several, or the pre-push tip gone from the list → `unverified`, no undo.
- **git can fail after storing the stash**: `--staged` with a file staged and then changed again (exit 1, "patch does not apply", the stash already stored), `--keep-index` likewise and with the index reset. The refusal names the stash (`oid`, `selector`) rather than dropping it: it may be the only copy of what git took out of the index. No undo on it: after the `--staged` failure the changes are still in the worktree and index, so a pop would apply them twice.

## `stash apply --index`

- **Its overwrite list is indented with two spaces** and ends with "Index was not unstashed." — not the tab list of checkout and merge. `parseConflictFiles` (`src/git/parse/refs.js`, shared with the branch and head ops) reads both.
- **git resets the index to HEAD before the merge**; when the merge refuses, every staged change — even one the stash never touches, and a staged file the stash doesn't touch is itself enough to make it refuse — is left unstaged. `applyStash` saves the index tree first and reads it back in that case.
- **"Index was not unstashed." also ends a conflicted merge** — and there git kept the index: the unmerged entries and the other staging. Restoring there would wipe the conflict and leave markers in a file shown as an ordinary change. So unmerged entries are checked first; the index is read back only when there are none.

## `GIT_LITERAL_PATHSPECS=1` breaks git's own `:/`

- `git stash push -u` without a pathspec cleans untracked files with `git clean … -- :/`, and `--keep-index` restores the index with `git checkout … -- :/`. Under code-git's literal pathspecs `:/` matches nothing: `-u` exits 0 having stashed the untracked files **and left them in place**; `--keep-index` fails ("pathspec ':/' did not match"). `stash.push` passes the pathspec `.` instead whenever it has no paths and either flag is set.

## Symlinks (the `--index` lesson)

- **`stash push -- <paths>` and `--staged` run `apply --index -R` inside git** (`diff-index -p --cached HEAD | apply --index -R`), the command that writes through an untracked symlinked directory (gotchas/staging-patches). git 2.55 happened to refuse every case the probes try, but differently each time — and `--staged` fails *after* creating the stash, so the stash exists while the worktree is untouched.
- **`stash apply` with the path still in the index and its directory replaced by an untracked symlink replaces the link with a real directory** (exit 0): nothing outside, but the link is gone.
- **`GIT_LITERAL_PATHSPECS` and `GIT_ICASE_PATHSPECS` cannot be combined** (git dies: "global 'literal' pathspec setting is incompatible"), and `core.ignorecase` alone does not fold pathspec matching. With `core.ignorecase` the guard lists each leading directory's parent as well as the directories themselves (a parent's listing names a fully untracked `u/` and nothing under it), and compares case-folded.
- **A directory pathspec has no leading directory of its own**: a save of `paths: ['d']` guards what `diff-index HEAD -- d` (and, with `-u`, `ls-files --others -- d`) expands it to.
- **The final component**: `diff --no-index /dev/null <path>` names a symlink by mode 120000 without following it, and a link to a directory as an inaccessible `<path>/null`. `assertFileTarget` refuses only a directory or a link to one: `git apply` handles a symlink to a file itself (replaces it, deletes it, or refuses "wrong type"), and a tracked symlink whose target changed is a legitimate one-hunk line stash.
- **A non-boolean `core.ignorecase` (`auto`) breaks every git command** ("bad boolean config value"), so the guard reads it as false and lets git's own failure surface.
- **The guard (`assertNotBlocked`)**: every proper leading directory of the paths through `ls-files --others --directory -z -- <dirs>` without `--exclude-standard`. An untracked symlink or file at a prefix is listed as the prefix itself, an untracked directory as `prefix/`, a tracked directory not at all (its untracked contents are listed instead). "Listed entry == a prefix" is exactly "something not a directory git can descend stands there". Ignored entries count.
- **The untracked part is restored non-atomically**: after the tracked merge, a checkout that skips an existing file ("already exists, no checkout") and writes the rest. `assertNoUntrackedCollision` (`ls-files -c -o` over U's paths) refuses first.

## Line stashes

- **I = HEAD's tree, W = HEAD + the selection**, both built with `commit-tree` on a temporary index (`GIT_INDEX_FILE` = `rev-parse --git-path code-git-stash-index`); the real index is never touched. The file must have nothing staged, so its index → worktree diff is the HEAD → worktree one.
- **Two patches from one selection.** The forward patch (stageLines') fits HEAD and builds W; taking the lines out of the worktree needs the reverse patch (discardLines'), which fits the worktree with its unselected changes. Reversing the forward patch fails as soon as anything unselected sits near the selection.
- **commit-tree needs an identity; git stash has a fallback.** When `git var GIT_COMMITTER_IDENT` fails, `git stash <git@stash>` is set as author and committer, as git stash does.
- **A line stash pops only onto a clean file**: git's merge refuses a file with any local change ("would be overwritten by merge") even when the result would be clean. `stash.applyFile` (a patch) applies it into the edited file.

## UI

- **The one sonner Toaster stays beside `<App/>` in `main.tsx`** (`shell/Toasts.tsx`). Mounted inside `Shell` it re-rendered with every Shell render and delayed a tab switch's panels by ~200 ms (`golden.mjs`'s instant activity count failed). Never a second one: every toast would show twice.
- **The branch dialog closes before the code-conductor confirmation opens** (the branch ops' `confirmCcHeadMove`): two Radix modals at once fight over focus and outside clicks.
