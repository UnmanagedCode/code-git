# Git-flow

nvie's branching model (feature, release and hotfix branches between a production branch and a development branch), run as plain git branch, merge and tag commands. code-git never runs the `git flow` extension and needs none on the System. Ops: `src/git/ops/flow.js`; settings: `src/git/flow/config.js`; wire shapes: [protocol → Git-flow ops](protocol.md#git-flow-ops-srcgitopsflowjs).

## Settings

Stored in the repository's local config under nvie's and AVH's key names, so a checkout initialized by the extension reads the same here, and back.

| Setting | Config key | Default offered (`flow.config` → `defaults`) |
|---|---|---|
| Production branch | `gitflow.branch.master` | `main` if it exists, else `master`, else HEAD's branch, else none |
| Development branch | `gitflow.branch.develop` | `develop` |
| Feature prefix | `gitflow.prefix.feature` | `feature/` |
| Release prefix | `gitflow.prefix.release` | `release/` |
| Hotfix prefix | `gitflow.prefix.hotfix` | `hotfix/` |
| Version tag prefix | `gitflow.prefix.versiontag` | empty |

- **Initialized** = both branches and the three type prefixes are set; the version tag prefix may be unset or empty (`readFlowConfig`).
- **Initialize** (`flow.init`) writes all six keys with `git config --local` and creates the development branch at the production branch when it does not exist (an existing one is never moved). Initializing again is how the settings are edited.
- **Checked on every write** (`checkSettings`): both branch names valid and different; each prefix plus a name a valid branch (or tag) name; the three type prefixes non-empty and different from each other; no branch or prefix under `code-conductor/` (`BAD_REF`: cc owns that namespace). `flow.start` and `flow.finish` re-check the stored settings and refuse `FLOW_NOT_INITIALIZED` when they are unset or unusable.

## What each op runs

| Op | Type | Runs |
|---|---|---|
| `flow.start` | feature, release | `switch --no-guess --no-track -c <prefix><name> --end-of-options <develop's oid>` |
| `flow.start` | hotfix | the same from main's oid |
| `flow.finish` | feature | merge into develop; delete the branch |
| `flow.finish` | release, hotfix | merge into main; annotated tag `<versionTag><name>` on main's new HEAD; merge into develop; delete the branch |

- **Each merge**: `switch --no-guess --end-of-options <into>` (skipped when HEAD is already on it), then `-c merge.autoStash=false merge --no-ff --no-edit -m "Merge branch '<branch>'" --no-stat --end-of-options <branch's oid>` (`integrate.merge`, timeout `SEQUENCE_LIMITS.timeoutMs`). A branch already contained in its target is `upToDate` (no commit).
- **The tag**: `tag -a --cleanup=verbatim -F - --end-of-options <tag> <oid>`, the message on stdin, kept byte for byte (as `tag.create`); the repository's `tag.gpgSign` applies.
- **The delete**: `branch -d --end-of-options <branch>`, exit 0 or 1. The branch is merged into develop (HEAD), so `-d` suffices; a refusal answers `deleted: false`, not an error.
- **HEAD ends on develop.**
- **Start's extra gates** (release and hotfix): another branch under that type's prefix → `FLOW_EXISTS {branch}` (one release or hotfix at a time); the version tag already exists → `REF_EXISTS`. Every start: the branch exists → `REF_EXISTS`; the base is missing → `REF_UNKNOWN`; a `code-conductor/*` HEAD needs `ccOwned` (`CC_OWNED_BRANCH {head: true}`).

## Finish: every gate before the first write

In order: a bare repository (`BARE_REPO`); a merge, rebase, cherry-pick or revert in progress (`OPERATION_IN_PROGRESS`) or unresolved conflicts (`CONFLICTED`); staged or unstaged tracked changes (`DIRTY_WORKTREE`); git below 2.38 (`GIT_TOO_OLD {feature: 'git-flow finish', need: '2.38'}`); the settings (`FLOW_NOT_INITIALIZED`); the flow branch missing (`REF_UNKNOWN`), symbolic (`SYMBOLIC_REF`) or no longer at `expect` (`REF_MOVED`); main or develop missing or symbolic; the flow branch, main or develop checked out in **another** checkout (`BRANCH_CHECKED_OUT {worktree}`; this checkout's own HEAD is fine); a `code-conductor/*` HEAD without `ccOwned`; the version tag existing (`REF_EXISTS`).

**The merge preflight**: `merge-tree --write-tree -z --name-only --no-messages --end-of-options <into's oid> <branch's oid>` for every merge (exit 0 clean, 1 conflicted; the conflicted paths follow the tree id, NUL-separated). Any conflict → `FLOW_CONFLICT {into, files}`, and nothing has been written: refs, HEAD, the index and the working tree are as they were. Both merges are known up front because the develop merge takes the flow branch (below).

**After the first write**, any failure — a hook (`pre-merge-commit`, `post-checkout`, `commit-msg`, …) exiting non-zero, a merge that stops on conflicts despite the preflight, a race — answers `FLOW_INCOMPLETE {step: 'switch' | 'merge' | 'tag' | 'delete', into?, done: [{step, into?}], cause: {code, message, stderr, files?}}`. `cause.stderr` is git's output, a hook's included. Nothing is rolled back: what `done` lists stands, and a merge a hook stopped is left in progress (`MERGE_HEAD`), shown by the Changes panel's banner (Continue / Abort).

## Departures from nvie's git-flow

- Merges are always `--no-ff`; nvie fast-forwards a single-commit feature.
- The develop merge of a release or hotfix takes the flow branch, as nvie does (AVH merges the tag).
- No `bugfix` or `support` types, no publish/push, no rebase-before-finish, no squash, no keeping the branch.
- No undo: the git-flow ops are writes without an undo plan, so they clear the checkout's undo and redo slots.

## UI

- **Repository actions** (the graph toolbar's ⋮, context `repo`) → **Git-flow** submenu: **Initialize…** (**Git-flow settings…** once initialized), **Start feature… / release… / hotfix…** (once initialized), **Finish ‹HEAD's branch›…** when HEAD is a flow branch. Shown only once HEAD has a commit.
- A local branch under a configured prefix offers **Finish feature… / release… / hotfix…** in its menu (order 335).
- Palette: **Git-flow: initialize…**, **Git-flow: start feature… / release… / hotfix…**, **Git-flow: finish…** (HEAD's flow branch).
- The finish dialog lists each step as text, a tag message for a release or hotfix (prefilled `Release <name>` / `Hotfix <name>`), and is the confirmation (destructive: it deletes a branch). A `FLOW_CONFLICT` lists the files; a `FLOW_INCOMPLETE` shows its cause's output. A `code-conductor/*` HEAD gives way to the shared cc confirmation first.
- The settings are read per `refsKey` (`features/flow/state.ts`) when a tab's graph refs change, when the menu opens and after every git-flow op.

## Known limitations

- **A finish needs main and develop free of other checkouts.** In cc the main checkout usually holds the production branch, so a release or hotfix is finished from that checkout; a cc worktree can finish a feature while develop is not checked out elsewhere.
- **`flow.finish` needs git ≥ 2.38** (`merge-tree --write-tree`) on the project's System.
- **A finish that stops after its first write is not undone**; `FLOW_INCOMPLETE` says what was done.
