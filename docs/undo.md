> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md) · [architecture](architecture.md) · [refs](refs.md)

# Undo and redo

Undo and redo of the last registered op on a checkout. The user-facing summary is in [features](features.md); this page is the reference: the registry, the journal, the plans and their steps, the rules that refuse an undo, and the residual risks. Gotchas behind the design: `.wiki/gotchas/undo.md`.

## Registering an op

A write opts in with an `undo` field on its own op definition (`src/git/ops/<feature>.js`):

```
undo(params, result) → UndoPlan | null
```

- Checked by `buildRegistry` at load: a non-function, or an `undo` on a read, throws.
- It reads the op's `params` and `result` (`result.undo`, the record of [refs → Undo record](refs.md#undo-record)); it never runs git.
- `null`, or a plan without steps, records nothing (an outcome that stopped on conflicts, a no-op).
- A later card registers its op the same way; it adds a step kind only when none of the existing ones fits.

## Journal

`createJournal()` in `src/git/undo/journal.js`; `createApp({journal?})` makes one per backend process (injectable for tests) and passes it to the ops route.

| Fact | Value |
|---|---|
| Where | In memory, per backend process. A restart empties it |
| Key | `targetKey(target)`: project, worktree, submodule chain — the frontend's `tabKey` |
| Slots | One undo slot and one redo slot per checkout |
| Entry | `{id, op, plan}`; `id` is a process-wide counter, never reused |

What the ops route does around every op (`journalAround` in `src/git/undo/record.js`):

| Op | Before it runs | After |
|---|---|---|
| A read | nothing | nothing |
| `undo.*` | nothing | the undo op moves its own entry (below) |
| Any other write | **both slots cleared** | success with a plan: the plan goes in the undo slot (redo stays empty). Failure, `null` or an empty plan: the slots stay empty |

- A write not registered for undo clears the slots too: `stash.push` leaves every ref where it was, so a compare-and-swap on refs alone could not tell that an undo would now lose work.
- A plan builder that throws is a code-git bug: logged, the op's result still answered, nothing recorded.
- **Generations**: each clear bumps the checkout's generation. A write records only under the generation its own clear returned, and an undo moves its entry only if no write cleared the slots while it ran — so two writes racing on one checkout never leave an older one's plan in the slot.

## Plans

```
UndoPlan { label    /* "Commit “msg”", "Checkout feature/a": rendered as text */,
           created: {tip: oid, not: oid[]} | null   /* the commits the op made: tip minus what `not` reaches (Pushed) */,
           confirm: {undo: Confirm | null, redo: Confirm | null},
           steps:   Step[] }                          /* redo runs them in order, undo in reverse */
Confirm  {kind: 'deletesRefs', refs: refname[]} | {kind: 'discards', paths: path[]} | {kind: 'resetHard'}
```

- Plain JSON, kept in the journal as built. The builders are `plans` in `src/git/undo/plans.js`; each op's definition names its own (`undo: plans.commit`).
- `refHeadSteps` turns a ref-and-HEAD record into steps: HEAD staying on its branch (or detached) and moving → one `head` step in the op's mode, that branch left out of the `refs` step (the reset moves it); HEAD switching branches → a `refs` step first, then a `head` step in `switch` mode, so redo creates a branch before switching to it and undo switches away before deleting it.
- **Confirm (D4)**, computed from the steps (`confirmsOf`); a direction has at most one, in this precedence:

| Confirm | Direction | When |
|---|---|---|
| `resetHard` | undo and redo | any `head` step in `hard` mode, even on a clean tree |
| `discards` (`paths`) | redo | a `discard` or `patch` step |
| `deletesRefs` (`refs`) | undo | a ref the op created (`old: null`); the branch of a first commit on an unborn branch |
| `deletesRefs` (`refs`) | redo | a ref the op deleted (`new: null`), a deleted symbolic ref |

Every other undo or redo runs at once; its toast offers the counter-action.

## Per-op plans

The registered ops (D2). Mode = the `head` step's mode; ‹old›/‹new› = `undo.head`.

| Op | Label | Steps | `created` |
|---|---|---|---|
| `commit.create` (amend, message-only amend included) | `Commit “s”` / `Amend “s”` / `Reword “s”` | `head` soft | `{tip: new, not: [old, MERGE_HEAD while concluding a merge]}`; `not: []` on an unborn branch |
| `head.reset` | `Reset <branch> to <abbrev> (<mode>)` | `head` soft / mixed (`indexTree`) / hard (`snapshot` = `worktreeSnapshot`) | — |
| `head.cherryPick`, `head.revert` (no conflicts) | `Cherry-pick <abbrev>` / `Revert <abbrev>` | `head` keep | `{tip: new, not: [old]}` |
| `merge.start` `fastForward` / `merged` | `Fast-forward to <ref>` / `Merge <ref>` | `head` keep | fast-forward: none; merged: `{tip: new, not: [old, oid]}` (the merge commit only) |
| `rebase.start` (`done`) | `Rebase onto <abbrev>` | `head` keep | `{tip: new, not: [onto]}` |
| `rebase.interactive` (`done`) | `Interactive rebase` / `Cherry-pick N commits` | `head` keep | rebase mode `not: [onto]`; pick mode `not: [old]` |
| `head.continue`, `head.skip` (`done`) | `Continue the <which>` / `Skip in the <which>` | `head` keep, from before the whole operation (a rebase: `orig-head`) | `not`: a rebase's onto (read before continuing); a merge's HEAD and MERGE_HEAD; else HEAD before |
| `branch.checkout` | `Checkout <branch>` | `head` switch; a new tracking branch: `refs` (create, with `upstream`) + switch; switch + fast-forward of the local twin: `refs` (the twin's move) + switch; a fast-forward only (already on it): `head` keep. From an unborn HEAD: not undoable | — |
| `branch.create` | `Create branch <name>[ and check it out]` | `refs` (create) [+ `head` switch] | — |
| `branch.rename` | `Rename <a> to <b>` | `rename` | — |
| `branch.delete` | `Delete branch <names>` | `refs` (each deleted branch with its `upstream`; a symbolic ref with its target) | — |
| `branch.move` | `Move <name> to <abbrev>` | `refs` | — |
| `branch.fastForward` | `Fast-forward <name>` | free branch: `refs`; this checkout's: `head` keep | — |
| `tag.create`, `tag.delete` | `Create tag <name>` / `Delete tag <names>` | `refs` (the tag object: an annotated tag keeps its message) | — |
| `stage.discardFiles` | `Discard <path>` / `Discard N files` | `discard` | — |
| `stage.discardLines` | `Discard lines in <path>` | `patch` | — |

An outcome that stops on conflicts, a squash merge, `upToDate`, a checkout of the branch HEAD is already on: no plan (the slots stay cleared).

## Record keys

What the registered ops add to `result.undo` (`undoRecord`, optional keys present only when set; [protocol → Branch, tag and HEAD ops](protocol.md#branch-tag-and-head-ops-srcgitopsbranchjs-tagjs-headjs)):

| Key | Set by | Value |
|---|---|---|
| `created` | `commit.create`, `head.cherryPick`, `head.revert`, `merge.start` (merged; `null` for a fast-forward), `rebase.start`, `rebase.interactive`, `head.continue` / `head.skip` (done) | `{tip, not}` |
| `indexTree` | `head.reset` mixed | the index's `write-tree` before the reset; `null` when unmerged entries make it fail |
| `discard` | `stage.discardFiles` | `{snapshot, tracked, untracked}`: `snapshot` is a dangling commit of the paths' worktree content, built before anything is removed |
| `refs[].upstream` | `branch.checkout` creating a tracking branch | the remote branch it tracks (redo sets it again) |

`commit.create` returns `undo` (`refs`, `head`, `created`) for the first time.

**The discard snapshot** (`discardSnapshot` in `src/git/stage/discard.js`): a temporary index at `rev-parse --git-path code-git-discard-index` (`GIT_INDEX_FILE`, not a protected name) → `read-tree --empty` → `update-index --add --remove -z --stdin` over the tracked and untracked paths (their **worktree** content, modes and symlinks; a deleted file is left out) → `write-tree` → `commit-tree --no-gpg-sign` (identity fallback: `identEnv`, `src/git/stash/ident.js`) → the temporary index emptied (`read-tree --empty`: git cannot delete the file). The real index is never touched. The discard itself is `discardGates` + `discardWrites` (`discardPaths` = both: the redo).

## Steps

`src/git/undo/steps/<kind>.js`, listed in `STEPS` (`steps/index.js`). Each is `{kind, preflight(git, step, dir, ctx), apply(git, step, dir, ctx)}`; `dir` is `'undo'` (expect the step's `new`, write its `old`) or `'redo'` (the other way). Every argv puts `--end-of-options` or `--` before the values it names (oids from the record, refs, paths).

| Kind | Preflight | Apply |
|---|---|---|
| `head` (all modes) | the projected HEAD equals the expected `{branch, oid}`, else `UNDO_STALE`; `assertCcHeadAck` (a `code-conductor/*` HEAD needs `ccOwned`); every mode but soft: `assertWorktree` | — |
| `head` soft | — | `reset --soft --end-of-options <oid>`; an unborn side: `update-ref --no-deref -d --end-of-options refs/heads/<b> <new>` (undo) / `update-ref --no-deref --end-of-options <ref> <new> ''` (redo: must not exist). The index is kept |
| `head` keep | — | `reset --keep --end-of-options <oid>`: git refuses rather than lose a local change (`Entry '<p>' not uptodate`) or overwrite an untracked file (`Untracked working tree file '<p>' would be overwritten`); both → `CHECKOUT_CONFLICT` with `files` |
| `head` mixed | undo: the index equals the new commit's tree; redo: it equals `indexTree` (else the old tree): `diff-index --cached --quiet --end-of-options <tree> --`, else `UNDO_STALE` | undo: `reset --soft <old>` + `read-tree --end-of-options <indexTree>`; no `indexTree`: `reset --mixed <old>`. Redo: `reset --mixed <new>` |
| `head` hard | undo, or redo with no snapshot: a clean tracked tree (`assertClean` → `DIRTY_WORKTREE`). Redo with a snapshot: a fresh `stash create`'s tree and `^2^{tree}` equal the snapshot's, else `UNDO_STALE`. Both: no untracked file (`ls-files --others`) where the target tree, or the snapshot, adds a path (`CHECKOUT_CONFLICT`), no untracked symlink for a leading directory (`assertNotBlocked` → `PATH_BLOCKED`) | `reset --hard --end-of-options <oid>`; undo then `stash apply -q --index --end-of-options <snapshot>` |
| `head` switch | the target branch exists at the expected oid (projected; else `UNDO_STALE`), is not a symbolic ref (`SYMBOLIC_REF`), is checked out in no other checkout (`BRANCH_CHECKED_OUT`) | `switch --no-guess --end-of-options <short>`, or `switch --detach --end-of-options <oid>`; "would be overwritten" → `CHECKOUT_CONFLICT` (`guardOverwrite`) |
| `refs` | each ref holds the expected value (absent; an oid, not symbolic; a symbolic ref to the target), else `UNDO_STALE` (`SYMBOLIC_REF` when a symbolic ref stands where a plain ref is expected). A branch it deletes or moves: checked out nowhere, this checkout as the earlier steps leave it included (`BRANCH_CHECKED_OUT`), and `assertCcAck` | one `update-ref --no-deref -m "code-git: <dir>" --stdin -z` transaction (`start`, `create` / `update` / `delete` lines with their old values, `prepare`, `commit`): a compare-and-swap miss writes nothing → `UNDO_STALE`. A symbolic ref: `symbolic-ref -m … --end-of-options <ref> <target>` / `symbolic-ref --delete --end-of-options <ref>`. A deleted branch: `config --remove-section branch.<name>` (as `branch -d`). A restored branch with `upstream`: `branch --set-upstream-to=<up> --end-of-options <name>` when it is a branch upstream — a valid name under `refs/heads/` or `refs/remotes/` (it comes from repo config: `%(upstream)`) — and that ref still exists; otherwise, or when git refuses to set it, a `warnings[]` entry (the ref is already restored, so the undo still succeeds) |
| `rename` | the current name holds the oid (`UNDO_STALE`), the other name is absent and not a dangling symbolic ref; branch.rename's guards: checked out in another checkout never, a checked-out `code-conductor/*` branch not even here (`BRANCH_CHECKED_OUT`); `assertCcAck` for both names | `branch -m --end-of-options <cur> <other>`: its config and every HEAD on it follow |
| `discard` | undo: every tracked path's worktree equals its index (`diff --quiet -- <chunk>`), every untracked path is absent (`ls-files -c -o -z -- <chunk>` empty), else `UNDO_STALE`; `assertNotBlocked` over every path. Redo: the paths' worktree tree (built as the snapshot) equals the snapshot's tree (`UNDO_STALE`), then the discard's own gates | undo: `restore --source=<snapshot> --worktree --pathspec-from-file=- --pathspec-file-nul` (a tracked path the snapshot lacks is deleted again); never `apply --index`. Redo: `discardPaths` |
| `patch` | `assertWorktree`, `assertNotBlocked([path])`; `apply --whitespace=nowarn --no-ignore-whitespace [-R] --check -` exits 0, else `UNDO_STALE` | undo: `apply` forward of the stored patch; redo: `apply -R`. The worktree only |

## Running a plan

`runPlan(git, plan, dir, {ccOwned})` in `src/git/undo/engine.js`, in order:

1. `assertNoOperation`, every plan: `OPERATION_IN_PROGRESS` (`operation`) / `CONFLICTED`.
2. Undo with `created`: the pushed rule (below).
3. Every step's preflight (reverse order for undo). Preflights read a **projection**: `ctx.head` and `ctx.refNow(ref)` start from git (`ownHead`, `refEntries`, `symbolicTarget` for a dangling symbolic ref) and each preflight records what its step will leave (`ctx.head = …`, `ctx.setRef`). So a switch step's preflight sees the branch an earlier `refs` step creates, and a delete sees that an earlier switch left the branch. "Checked out" = another checkout's `%(worktreepath)` (`readHeads`), or this checkout's projected HEAD.
4. Every step's apply. A failure after an earlier step wrote carries `appliedSteps` (the count that ran; in the refusal's body too).

## Pushed (D3)

`assertNotPushed(git, created)` in `src/git/undo/pushed.js`, undo only, only when the plan has `created` (an op that created no commits is never "pushed": its compare-and-swap guards it):

1. `rev-list --stdin` with stdin `<tip>` and `^<not>` per line → the created commits.
2. `rev-list --stdin --not --remotes`, same stdin → those no remote-tracking ref reaches.
3. Any in 1 and not in 2 → `UNDO_PUSHED` with `oid` (the newest pushed one) and `refs` (`for-each-ref --format=%(refname) --contains=<oid> refs/remotes/`).

- Any remote-tracking ref counts, whatever the upstream config: a branch pushed to a second remote, or with no upstream, is pushed.
- The tracking refs as they are: no fetch first. A push made elsewhere is not seen until a fetch.
- `not` keeps commits the op did not make out: merging `origin/main` (its commits are on the remote, the merge commit is not) is undoable; an amend after a push is undoable (the amended commit is new; the undo restores the pushed one).

## Ops

Wire shapes: [protocol → Undo ops](protocol.md#undo-ops-srcgitopsundojs).

| Op | kind | Does |
|---|---|---|
| `undo.state` | read (cancellable) | the two slots, each `{id, op, label, confirm}` (`confirm` for that slot's own direction) or `null`. Runs no git |
| `undo.undo`, `undo.redo` | write, **not** cancellable (a plan runs several commands; an abort between them would leave it half-applied) | takes the slot's entry by `id`, `runPlan`, then moves it to the other slot |

**Slot transitions:**

| Outcome | Slots |
|---|---|
| Success | the entry moves undo → redo (redo → undo) |
| `NOTHING_TO_UNDO` / `NOTHING_TO_REDO` (the slot is empty) | unchanged |
| `UNDO_STALE` because `id` is not the slot's entry (the UI's state is old) | unchanged: refetch `undo.state` |
| `UNDO_STALE` from a preflight or a transaction (the checkout changed), `UNDO_PUSHED` | **both cleared**: the entry can never run |
| Any other refusal (`OPERATION_IN_PROGRESS`, `CONFLICTED`, `DIRTY_WORKTREE`, `CHECKOUT_CONFLICT`, `BRANCH_CHECKED_OUT`, `CC_OWNED_BRANCH`, `SYMBOLIC_REF`, `PATH_BLOCKED`, `BARE_REPO`) before anything wrote | unchanged: resolve it and retry |
| A failure after a step wrote (`appliedSteps`) | both cleared |

**`code-conductor/*`**: undo and redo never create or delete worktrees. Every ref they delete or move passes `assertNotCheckedOut` + `assertCcAck`, and every move of a cc-owned HEAD `assertCcHeadAck`: the forward ops' guards. A refusal carries `head: true` for this checkout's own HEAD, as everywhere ([refs](refs.md)).

## Residuals

- **Preflight → apply race**: another write between a step's preflight and its apply (from another worktree of the project, or outside code-git) is caught by git itself where it can be (a transaction's compare-and-swap, `reset --keep`, `switch`), as in every other op; elsewhere the apply runs over the newer state.
- **Mid-plan failure**: a step failing after an earlier one wrote leaves the plan half-applied; the refusal says how many steps ran (`appliedSteps`) and the slots are cleared.
- **In memory**: a backend restart empties the journal.
- **Tracking refs are not fetched** before the pushed check.
- **Only the last op**, one slot each way; a write from another checkout of the same project does not clear this checkout's slots (its compare-and-swaps catch what it moved).
- **A restored branch gets back its upstream only**; other `branch.<name>.*` config (a description, `pushRemote`) is not kept.
- **Undo of a commit that concluded a merge** leaves its changes staged without `MERGE_HEAD`: the merge is no longer in progress.
- **Snapshots are dangling commits**: a `gc` that prunes them makes the undo of a hard reset or a discard fail (`GIT_FAILED`).
- **Stash and remote-config ops are not registered**: their `undo` records (`stashes`, `worktreePatch`, `remotes`) are not undoable from the UI yet, and the ops clear the slots.
