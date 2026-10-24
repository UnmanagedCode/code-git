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
- A later card registers its op the same way; it adds a step kind only when none of the existing ones fits, and extends the fetch audit ([Fetch neutrality](#fetch-neutrality)): `FETCH_AUDITED` in `tests/undo-fetch-neutral.test.js` must equal the set of ops with an `undo`.

A write that must leave the journal alone declares `journal: 'neutral'` instead:

- Checked by `buildRegistry`: any other value, `journal` on a read, or beside an `undo` throws at load.
- `journalAround` passes it straight through: no clear, no generation bump, nothing recorded — success or failure.
- The only one: `remote.fetch` (manual and auto-fetch). Its write op run (activity, `onSettledWrite`) is unchanged.

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
| `journal: 'neutral'` (`remote.fetch`) | nothing | nothing |
| Any other write | **both slots cleared** | success with a plan: the plan goes in the undo slot (redo stays empty). Failure, `null` or an empty plan: the slots stay empty |

- A write not registered for undo clears the slots too: `stage.files` leaves every ref where it was, so a compare-and-swap on refs alone could not tell that an undo would now lose work.
- A plan builder that throws is a code-git bug: logged, the op's result still answered, nothing recorded.
- **Generations**: each clear bumps the checkout's generation. A write records only under the generation its own clear returned, and an undo moves its entry only if no write cleared the slots while it ran — so two writes racing on one checkout never leave an older one's plan in the slot.

## Fetch neutrality

`remote.fetch` neither records nor clears (R3). That holds only because every registered plan refuses — never misapplies — once a fetch moved refs. A code-git fetch writes `refs/remotes/*` and `refs/tags/*` only (`assertFetchDestinations`, `src/git/remote/tracking.js`), plus `FETCH_HEAD` and objects.

| A plan reads | Ops | A fetch's move is caught by |
|---|---|---|
| `refs/heads/*`, HEAD | commit, reset, cherry-pick, revert, merge, rebase, continue / skip, checkout, branch create / rename / delete / move / fast-forward | nothing to catch: a fetch never writes them |
| `refs/tags/*` (`refs` step) | `tag.create`, `tag.delete` | the preflight's `holds()` and the transaction's compare-and-swap → `UNDO_STALE` |
| Tracking refs, for D3 | every plan with `created` | `assertNotPushed` reads them live: a fetch only makes it more accurate (`UNDO_PUSHED`) |
| An upstream's name only | `branch.delete`, `branch.checkout` restoring `upstream` | a pruned upstream becomes a `warnings[]` entry; the branch is still restored exactly (a degrade, not a misapply) |
| `refs/heads/*`, HEAD | `stash.branch` | nothing to catch |
| The stash list, the index, the worktree | the stash plans | nothing to catch: a fetch never touches them |
| Tracking refs, by value (`refs` step) | `remote.remove` (its deleted tracking refs, the `<r>/HEAD` symref) | the same compare-and-swap; a symref is compared by target → `UNDO_STALE` |
| Tracking refs, by existence | `remote.add`'s undo (removes the config) | the `remote` step refuses once any ref exists under the remote's fetch destinations (projected) → `UNDO_STALE` ("fetched since") |
| Config only, not ref positions | `remote.edit`, `remote.rename` | nothing to catch: they restore config or rename a namespace; tracking refs a fetch moved travel with a rename |

Pinned by `tests/undo-fetch-neutral.test.js`: the slots survive every fetch shape (moving, pruning, tag-creating, every remote, failed), and each row's refusal changes nothing.

## Plans

```
UndoPlan { label    /* "Commit “msg”", "Checkout feature/a": rendered as text */,
           created: {tip: oid, not: oid[]} | null   /* the commits the op made: tip minus what `not` reaches (Pushed) */,
           confirm: {undo: Confirm | null, redo: Confirm | null},
           steps:   Step[] }                          /* redo runs them in order, undo in reverse */
Confirm  {kind: 'deletesRefs', refs: refname[]} | {kind: 'discards', paths: path[]} | {kind: 'resetHard'}
       | {kind: 'dropsStashes', messages: string[]} | {kind: 'deletesRemote', name: string, refs: refname[]}
```

- Plain JSON, kept in the journal as built. The builders are `plans` in `src/git/undo/plans.js`; each op's definition names its own (`undo: plans.commit`).
- `refHeadSteps` turns a ref-and-HEAD record into steps: HEAD staying on its branch (or detached) and moving → one `head` step in the op's mode, that branch left out of the `refs` step (the reset moves it); HEAD switching branches → a `refs` step first, then a `head` step in `switch` mode, so redo creates a branch before switching to it and undo switches away before deleting it.
- **Confirm (D4)**, computed from the steps (`confirmsOf`); only where something is really lost (R2). A direction has at most one, in this precedence:

| Confirm | Direction | When |
|---|---|---|
| `resetHard` | undo and redo | any `head` step in `hard` mode, even on a clean tree |
| `discards` (`paths`) | redo | a `discard` step; a `patch` step without `forward` in a plan with no `stash` step (stash.pushLines' lines are in its stash) |
| `dropsStashes` (`messages`) | redo (`stash.drop`) | a `stash` step that drops entries and stores none in that direction, in a plan with no `worktree` or `patch` step |
| `deletesRemote` (`name`, `refs`) | redo (`remote.remove`) | a `remote` step with `new: null`; `refs` = that plan's `refs`-step deletions (the tracking refs, the HEAD symref). Takes precedence over `deletesRefs` |
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
| `stash.push` | `Stash “m”` / `Stash changes` | `stash` (created W), `worktree` | — |
| `stash.pushLines` | `Stash lines in <path>` | `stash` (created W), `patch` (`removedPatch`, which the op applied `-R`) | — |
| `stash.apply` (clean, something changed) | `Apply “<stash message>”` (`result.message`) | `worktree` | — |
| `stash.pop` (clean) | `Pop “<stash message>”` (`Pop stash` when the drop met `STASH_MOVED`) | `worktree`, `stash` (removed; absent when not dropped) | — |
| `stash.drop` | `Drop stash “<stash message>”` | `stash` (removed) | — |
| `stash.rename` | `Rename stash to “m”` | `stash` (the copy created, the original removed) | — |
| `stash.applyFile` | `Apply <path> from stash` | `patch` with `forward: true` (`worktreePatch`) | — |
| `stash.branch` (clean) | `Create branch <name> from stash` | `refs` (create) + `head` switch (`refHeadSteps`), `worktree` (with `mid`), `stash` (removed, when dropped) | — |

| `remote.add` | `Add remote <n>` | `remote` (old null) | — |
| `remote.edit` | `Edit remote <n>` | `remote` (old → new) | — |
| `remote.rename` | `Rename remote <a> to <b>` | `remoteRename` | — |
| `remote.remove` | `Remove remote <n>` | `refs` (the deleted tracking refs and HEAD symref), `remote` (new null) | — |

What undo and redo do for the stash plans (redo runs the steps in order, undo in reverse):

| Op | Undo | Redo |
|---|---|---|
| `stash.push` | writes the pre-push state back, then drops W (verified): in effect a pop | stores W, then writes the post-push state |
| `stash.pushLines` | applies the removal patch forward (the lines back), then drops W | stores W, then `apply -R` |
| `stash.apply` | writes the pre-apply state; the stash list is untouched | writes the post-apply state (never re-runs `stash apply`); the stash list is untouched |
| `stash.pop` | stores the entry back (at the top, R1), then writes the pre-pop state | writes the post-pop state, then drops the entry |
| `stash.drop` | stores the entry back (at the top) | drops it |
| `stash.rename` | stores the original, drops the copy | stores the copy, drops the original |
| `stash.applyFile` | `apply -R` | `apply` |
| `stash.branch` | stores the stash, writes `mid` (post-switch, pre-apply), switches back, deletes the branch | creates the branch, switches (producing `mid`), writes `after`, drops the stash |
| `remote.add` | removes the config section (refused once the remote was fetched) | writes the recorded config again |
| `remote.edit` | sets each list that differs back to `old` | the same, to `new` |
| `remote.rename` | `renameRemote(b, a)` | `renameRemote(a, b)` |
| `remote.remove` | writes the config, the branch keys git cleared and pushDefault back, then re-creates the refs (compare-and-swap create, the symref after) | deletes the refs (compare-and-swap), then the config and the keys it restored |

An outcome that stops on conflicts, a squash merge, `upToDate`, a checkout of the branch HEAD is already on: no plan (the slots stay cleared). Stash ops with no plan: an apply, pop or branch that stopped on conflicts; an apply that changed nothing (`before` deep-equals `after`: no entry whose undo does nothing); an unverified or failed push; a push whose stash holds a path outside the saved files (a race: no `worktreeState`); `stash.branch` from an unborn HEAD.

## Record keys

What the registered ops add to `result.undo` (`undoRecord`, optional keys present only when set; [protocol → Branch, tag and HEAD ops](protocol.md#branch-tag-and-head-ops-srcgitopsbranchjs-tagjs-headjs)):

| Key | Set by | Value |
|---|---|---|
| `created` | `commit.create`, `head.cherryPick`, `head.revert`, `merge.start` (merged; `null` for a fast-forward), `rebase.start`, `rebase.interactive`, `head.continue` / `head.skip` (done) | `{tip, not}` |
| `indexTree` | `head.reset` mixed | the index's `write-tree` before the reset; `null` when unmerged entries make it fail |
| `discard` | `stage.discardFiles` | `{snapshot, tracked, untracked}`: `snapshot` is a dangling commit of the paths' worktree content, built before anything is removed |
| `refs[].upstream` | `branch.checkout` creating a tracking branch | the remote branch it tracks (redo sets it again) |
| `worktreeState` | `stash.push`, `stash.apply` (clean), `stash.pop` (clean), `stash.branch` (clean) | `{paths, before, mid?, after}`; each state `{head: oid \| null, index: tree, files: tree}` (`checkoutState`, below); `mid` only for `stash.branch` (after the switch, before the apply) |
| `removedPatch` | `stash.pushLines` | base64 of the patch whose `apply -R` took the lines out of the worktree |
| `remotes[].old` / `.new` `.extra` | every remote snapshot (`remoteSnapshot`) | `[[var, value]]`: every other `remote.<n>.<var>` (`prune`, `tagopt`, `proxy`, …), raw, in config order — in the journal's plan only; on the wire each value is `null` (below) |
| `remotes[].old.branchKeys`, `.pushDefault` | `remote.remove` | `branchKeys`: `[[key, value]]`, the repo's own `branch.<b>.remote` / `.merge` / `.pushremote` keys **git cleared** — `localBranchKeys` before minus after `remote remove` (a multiset difference, config order). git picks the branches by their *effective* `branch.<b>.remote` / `.pushRemote` (any scope) and unsets the keys in `.git/config` only, so a branch whose remote lives in the global, an included or the worktree config loses just its local `merge`. `pushDefault`: whether a local `remote.pushDefault` naming it was cleared. `old.upstreams` stays the snapshot's (for the comparison) |

`commit.create` returns `undo` (`refs`, `head`, `created`) for the first time.

**What crosses the wire.** The journal builds its plan from the op's raw result (`journalAround`); the ops route then answers `forTheWire(result)` (`src/git/refs/undo.js`), a copy. The plan is never persisted (a restart empties the journal), so undo, redo and the re-add of a removed remote write the raw values back while the browser only ever holds the wire copy:

| Value | In the plan (memory) | In the op's HTTP answer |
|---|---|---|
| `remotes[].old` / `.new` `.extra` values (a proxy, a pack command: may hold a secret) | raw | `null`; the variable names are kept |
| `remotes[].old` / `.new` `.urls`, `.pushUrls` | raw | each value through `maskUrl` (`https://u:***@host/r`) |
| The other record fields: `remotes[].old` / `.new` `.fetch`, `.upstreams[].branch` / `.merge`, a remove's `.branchKeys` and `.pushDefault` | raw | raw |
| `undo.state`, `undo.undo` / `undo.redo` results | — | `{id, op, label, confirm}` (remote names, ref names, paths, stash messages) and `warnings`, which may name a restored branch's upstream ref (`branch.<b>.merge`); never an `extra` value or a url |
| Refusals of `undo.undo` / `undo.redo` | — | a message naming remotes, refs and paths; `REMOTE_CONFIG_UNSUPPORTED` (a remote rename's gates) carries the fetch refspec (`refspec`); never an `extra` value, and a url's password in any string is masked (`maskDeep`, `Refusal.toBody`) |

**The activity log** (`/api/activity` and its event stream) records git's argv through `redactArgv`: a url's password is masked (`maskUrl` for an argument of a `VALUE_SUBCOMMANDS` command, `src/activity/log.js`; `maskUrls` for any other), and the value an undo or redo writes to an `extra` key is never recorded — `config --add` / `--replace-all remote.<n>.<var> <value>` with `<var>` other than `url`, `pushurl`, `fetch` is recorded with `***` for the value, the key kept (a scheme-less `user:password@host` proxy or a pack command has no shape a mask could find). Each value is its own argument, so this holds for every one of them; stderr is masked with `maskUrls`.

**The checkout state** (`checkoutState` in `src/git/stash/snapshot.js`): `head` = `rev-parse -q --verify HEAD`, `index` = `write-tree` of the real index (the gates already refused unmerged entries), `files` = `worktreeTree(paths)` (the discard snapshot's temporary-index tree, below; no commit). `paths`:

| Op | `paths` | Taken |
|---|---|---|
| `stash.push` | the saved files `savedPaths` expands (`files`: changed ∪ untracked or staged, never a named directory); kept only when `stashPaths(stash)` ⊆ `paths` | `before` ahead of `git stash push`, `after` once it succeeded |
| `stash.apply`, `stash.pop`, `stash.branch` | `stashPaths(stash)` (`assertCanApply` resolves them) | `before` ahead of the apply (branch: of the switch); branch's `mid` after the switch; `after` after a clean apply (pop, branch: and the drop attempt) |

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
| `refs` | each ref holds the expected value (absent; an oid, not symbolic; a symbolic ref to the target), else `UNDO_STALE` (`SYMBOLIC_REF` when a symbolic ref stands where a plain ref is expected). A branch it deletes or moves: checked out nowhere, this checkout as the earlier steps leave it included (`BRANCH_CHECKED_OUT`), and `assertCcAck` | one `update-ref --no-deref -m "code-git: <dir>" --stdin -z` transaction (`start`, `create` / `update` / `delete` lines with their old values, `prepare`, `commit`): a compare-and-swap miss writes nothing → `UNDO_STALE`. A symbolic ref: `symbolic-ref -m … --end-of-options <ref> <target>` / `symbolic-ref --delete --end-of-options <ref>`. A deleted branch: `config --remove-section branch.<name>` (as `branch -d`). A restored branch with `upstream`: `branch --set-upstream-to=<up> --end-of-options <name>` when it is a full refname — `refs/<valid name>`, any namespace (it comes from repo config: `%(upstream)`; a remote's fetch refspec may map its branches to `refs/other/*`) — and that ref still exists; otherwise (not a ref name, gone), or when `--set-upstream-to` refuses it (a tag, a remote no longer configured), a `warnings[]` entry: the ref is already restored, so the undo still succeeds |
| `rename` | the current name holds the oid (`UNDO_STALE`), the other name is absent and not a dangling symbolic ref; branch.rename's guards: checked out in another checkout never, a checked-out `code-conductor/*` branch not even here (`BRANCH_CHECKED_OUT`); `assertCcAck` for both names | `branch -m --end-of-options <cur> <other>`: its config and every HEAD on it follow |
| `discard` | undo: every tracked path's worktree equals its index (`diff --quiet -- <chunk>`), every untracked path is absent (`ls-files -c -o -z -- <chunk>` empty), else `UNDO_STALE`; `assertNotBlocked` over every path. Redo: the paths' worktree tree (built as the snapshot) equals the snapshot's tree (`UNDO_STALE`), then the discard's own gates | undo: `restore --source=<snapshot> --worktree --pathspec-from-file=- --pathspec-file-nul` (a tracked path the snapshot lacks is deleted again); never `apply --index`. Redo: `discardPaths` |
| `patch` | `assertWorktree`, `assertNotBlocked([path])`; `apply --whitespace=nowarn --no-ignore-whitespace [-R] --check -` exits 0, else `UNDO_STALE` | lines the op took out with `apply -R` (no `forward`): undo `apply`, redo `apply -R`; `forward: true` (the op applied it forward: `stash.applyFile`): undo `apply -R`, redo `apply`. The worktree only |
| `worktree` `{paths, before, mid?, after}` | the checkout as this direction starts — undo expects `after`, redo `before`: `assertWorktree`; HEAD's oid = `head` (`UNDO_STALE`); `diff-index --cached --quiet --end-of-options <index> --` (`UNDO_STALE`); `assertNotBlocked(paths)` (`PATH_BLOCKED`); `worktreeTree(paths)` = `files` (`UNDO_STALE`; a `GIT_FAILED` there — a path that is a directory now — too) | `writeCheckoutState` from `after.files` to `mid ?? before` (undo), from `(mid ?? before).files` to `after` (redo). HEAD is never moved: in `stash.branch` the `head` step's switch does, producing `mid` |
| `remote` `{name, old, new}` (record sides; `from` / `to` follow the direction) | `remoteSnapshot` (null when absent) deep-equals `from` on `urls`, `pushUrls`, `fetch`, `extra` and `upstreams` (as a set: an undo appends an emptied branch section at the end of the file, so its order is not the state's), else `UNDO_STALE` ("remote <n> changed since": no values); a remove's redo (`from.branchKeys`): the local keys git would clear now (`clearableKeys`: the effective remote / pushRemote picks the branch, the local file holds the keys, and only a key with exactly one local value counts — git leaves a multi-valued one) equal `from.branchKeys` exactly, and `remote.pushDefault` is clearable — exactly one local value, the remote (`pushDefaultClearable`) — exactly when `from.pushDefault` (one added since would be left dangling). Creating (`from` null): no key of `to.branchKeys` is set locally, and no local `remote.pushDefault` when `to.pushDefault`, else `UNDO_STALE` (it would gain a second value). Removing (`to` null): no ref under `from`'s fetch destinations in `refs/remotes/` (`trackedSnapshot`) but the ones an earlier step deletes (`ctx.refNow(ref) === null`), else `UNDO_STALE` ("fetched since") | `writeRemoteConfig(git, name, from, to)` (below) |
| `remoteRename` `{from, to}` | the current name is a remote and the other is not, and `refs/remotes/<other>` holds no ref, else `UNDO_STALE`; then remote.rename's own `renameGates` (`assertNotLegacy`, `REMOTE_EXISTS`, the default refspec, `trackingRefsOf`) | `renameRemote`: `remote rename --end-of-options <cur> <other>` |
| `stash` `{entries: [{oid, message, side: 'created' \| 'removed'}]}` | this direction stores the removed entries (undo) or the created ones (redo) and drops the rest (`stashSides`): each drop on the list (`listStashes`), each store not on it, and its commit present (`cat-file -e --end-of-options <oid>^{commit}`), else `UNDO_STALE` ("no longer on the stash list" / "already back" / "its commits were pruned") | stores first (`stash store --message=<message> <oid>`: at `stash@{0}`, R1; `stash store` takes no `--end-of-options`), then drops (`dropVerified`: `STASH_MOVED` propagates, nothing lost) |

**Writing a remote's config** (`writeRemoteConfig(git, name, from, to)` in `src/git/remote/config.js`). Each value is its own argument after its key — never `key=value`, never `-c` — so the activity log masks a url and withholds an `extra` value (`redactArgv`), and a leading `-` is stored as given (git stops parsing options at the key; probe-pinned).

| Case | Commands |
|---|---|
| delete (`to` null) | `config --remove-section remote.<n>`, then `config --unset-all` (exit 5 tolerated) of each key of `from.branchKeys`, and `remote.pushDefault` when `from.pushDefault`. An add's undo has no `branchKeys`: it never touches a branch key |
| create (`from` null) | `config --add` per value, in order: `remote.<n>.url`, `.fetch`, `.pushurl` (the order `remote add` then `set-url --push` writes), each `extra` key; then each `[key, value]` of `to.branchKeys`, then `remote.pushDefault` |
| change (both) | for each list or `extra` variable that differs: `config --replace-all <key> <first>` (in place), `--add` the rest; an emptied one `--unset-all` |

**Writing a checkout state** (`writeCheckoutState(git, fromFiles, to)`): on a temporary index at `rev-parse --git-path code-git-undo-index` (`GIT_INDEX_FILE`):

1. `read-tree --end-of-options <fromFiles>`
2. `update-index --refresh` — exit 1: a file no longer matches `fromFiles` → `UNDO_STALE` (never `-q`: it exits 0 regardless)
3. `read-tree -m -u --end-of-options <fromFiles> <to.files>` — a two-way merge: changed paths written with modes and symlinks, removed paths deleted with their emptied directories, an untracked file in the way refused
4. `read-tree --empty` (the temporary index emptied, always)

Then the real index: `read-tree --end-of-options <to.index>` (no `-u`). Never `apply --index`.

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
- **A fetch is never undone**, and it keeps the slots: an undo after it relies on the preflights above.
- **A stash put back lands at `stash@{0}`** (R1): git stores only at the top, so an undone drop of an older entry, a popped or renamed one comes back first in the list with a new reflog date; its oid, message and contents are exact.
- **The checkout states' trees are unreachable objects**: a `gc` that prunes them (after `gc.pruneExpire`) makes a stash undo fail (`GIT_FAILED`); a pruned stash commit refuses `UNDO_STALE`.
- **A stash undo replaces the whole index** with the recorded tree (its preflight checked it equals the expected one): stat data is rebuilt on the next refresh; intent-to-add and skip-worktree bits are not kept.
- **A restored remote keeps each key's values in order, not their place in the file**: a section written back (a remove's undo, an add's redo) is appended at the end of `.git/config`, and its keys are written per variable (url, fetch, pushurl, then the extra keys), so their interleaving with other keys may differ. Every value of a cleared branch key comes back (`branchKeys` holds them all); only the comparison-only `upstreams` field reads the first `branch.<b>.merge`.
- **Two shapes with deliberately shadowed duplicate keys are not restored exactly** (known, not handled):
  - `remote.pushDefault` naming the remote in an included or `config.worktree` file while the local `remote.pushDefault` holds a different single value: git picks the effective value and clears the shadowed local one, but the record (local value ≠ the remote) says not cleared, so the undo does not write that inert local value back.
  - An `include.path` read after a local key and setting that key to the removed remote again: the undo's `config --add` puts the restored key after the include, so the effective upstream flips and the redo then refuses `UNDO_STALE`.
- **git leaves a multi-valued key in place** on `remote remove` ("has multiple values"): a local `branch.<b>.remote`, `.merge`, `.pushRemote` or `remote.pushDefault` with several values keeps naming the removed remote. The record omits it (nothing to restore) and the redo expects it left (`clearableKeys`, `pushDefaultClearable`), per key: a single-valued sibling of the same branch is still cleared and restored.
- **A restored remote's branch keys and pushDefault are exactly those git cleared** from the repo's own config (`branchKeys`), whatever scope picked the branch: a key in the global, an included or the worktree config is never cleared, recorded, written back or compared, so it never blocks an undo or a redo. A `remote.<n>.*` key in another config file is still read into the snapshot.
