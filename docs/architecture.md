> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md) · [graph](graph.md)

# Architecture

## Module map

**Backend** (`src/`, plain ESM; `server.js` is the entry):

| Module | Responsibility |
|---|---|
| `server.js` | `start({port, distDir, …})`: builds the app, listens on `127.0.0.1`, answers parser-rejected requests (`clientError`) with the CSP. Exports `start`, `createApp`, `CSP`, `DEFAULT_PORT`; autostarts only when run directly |
| `src/app.js` | `createApp({distDir, ops?, activity?})`: wiring only — headers → `/health` → `/api` (JSON check, body parser, feature routes, API 404) → UI → 404 → error handler. `ops`/`activity` are injectable for tests |
| `src/http/security.js` | `CSP`, the headers middleware, `requireJson` |
| `src/http/static.js` | `serveDist(distDir)`: the `ASSET_RE` allowlist, `inside()` realpath check, 503 while unbuilt |
| `src/http/route.js` | `route(fn)`: a throw becomes a refusal response; `sendError` |
| `src/refusals.js` | `Refusal` and `HTTP_STATUS` (the code table) |
| `src/conductor/fetch.js` | `ccFetch`: `CONDUCTOR_URL`, per-attempt deadline, caller abort → `CANCELLED`, connection-only retry |
| `src/conductor/cc.js` | `projects()`, `worktrees(project)` |
| `src/conductor/exec.js` | `exec(target, argv, opts)`: cc exec form A + the refusal map; `CC_EXEC_CAPS` |
| `src/git/validate.js` | Pure input checks: `assertTarget`, `assertRefName`, `assertRev`, `OID_RE` / `assertOid` (the one full-oid check, the diff sources use it too), `assertPath`, `assertSubpath` |
| `src/git/limits.js` | `LIMITS`: per-kind timeout / output cap, stderr cap, activity ring size, cc read deadline |
| `src/git/runner.js` | `runGit(ctx, args, opts)`: **the** choke point for git |
| `src/git/locks.js` | `createLocks()`: keyed promise queue |
| `src/git/ops/index.js` | The op registry: `buildRegistry`, `OPS`, `getOp` |
| `src/git/ops/repo.js` | `repo.summary` |
| `src/git/ops/diff.js` | `diff.files`, `diff.file`, `diff.patch`; `patchFilename` |
| `src/git/diff/source.js` | The diff source descriptor: `parseSource`, `resolveSource`, `pairArgs`, `assertCommitish`, `emptyTree`, `commitOid`; the shared argv `DIFF_CONFIG`, `DIFF_FLAGS`, `FORMAT_PATCH_FLAGS`, `WHITESPACE_FLAGS`; `parseContext` / `contextArg` / `FULL_CONTEXT` |
| `src/git/diff/noIndex.js` | `assertNoIndexReadsItself`, `readNoIndex`: reading one file's bytes through `diff --no-index /dev/null <path>` |
| `src/git/worktree.js` | `isBare`, `assertWorktree`: the bare-repository check that `--work-tree=.` makes necessary (git dir = working tree) |
| `src/git/params.js` | Shared op-param checks: `paramsObject`, `optBool`, `pathList`; `nulPaths` (stdin for `--pathspec-from-file`), `chunkPaths` (argv chunks) |
| `src/git/stage/limits.js` | `STAGE_LIMITS`: staging, commit-template, `.gitignore` and patch caps |
| `src/git/ops/stage.js` | `stage.files`, `stage.unstageFiles`, `stage.discardFiles`; `stage.stageLines`, `stage.unstageLines`, `stage.discardLines` |
| `src/git/ops/commit.js` | `commit.create`, `commit.state`, `commit.headMessage`, `commit.template` |
| `src/git/commit/message.js` | `joinMessage`, `splitMessage`, `templateDraft` (pure): the only place a message is split or joined |
| `src/git/ops/ignore.js` | `ignore.add`: the root `.gitignore` by whole-file-context `git apply`, optional stop-tracking |
| `src/git/ignore/pattern.js` | `ignorePattern`, `escapeGlob` (pure): the only builder of ignore patterns |
| `src/git/ops/files.js` | `files.restore` |
| `src/git/ops/patch.js` | `patch.check`, `patch.apply` |
| `src/git/stage/selection.js` | `buildSelectionPatch` (pure): a hunk/line selection + the file's latin1 diff → the patch to apply; `asShown` |
| `src/git/diff/limits.js` | `DIFF_LIMITS`: the diff caps (list / file / patch bytes, oversize lines, max commits and paths) |
| `src/git/parse/diff.js` | `parseRawNumstat`, `parseFilePatch`, `detectLfs`, `sideLines` — pure |
| `src/git/parse/status.js` | `parseStatus`: porcelain v2 `-z` → summary |
| `src/git/ops/graph.js` | `graph.refs`, `graph.page`, `graph.stats`, `graph.search`, `graph.commit` ([graph](graph.md)) |
| `src/git/parse/graph.js` | The graph ops' parsers: NUL-field records, refs, stashes, worktrees, shortstats, commit metadata, name-status |
| `src/git/ops/branch.js`, `tag.js`, `head.js` | The ref-writing ops `branch.*`, `tag.*`, `head.*` ([refs](refs.md)) |
| `src/git/refs/` | What those ops share: `check.js` (ref-name checks: `shortBranch`, `fullRef`, `nameList`; the generic `paramsObject` / `optBool` are `src/git/params.js`), `heads.js` (`readHeads` with `%(worktreepath)`, `ownHead`, the checked-out and `code-conductor/*` asserts), `resolve.js` (`refEntries` with `%(symref)`, `refObjects`, `tagObjects`: unpeeled ids), `write.js` (`guardOverwrite` → `CHECKOUT_CONFLICT`, `casUpdate` → `REF_MOVED`), `undo.js` (`undoRecord`), `limits.js` (`REF_LIMITS`) |
| `src/git/remote/` | Commands that talk to a remote: `push.js` (`remoteName`, `knownRemote`, `push`, `assertSomethingPushed`), `limits.js` (`NETWORK_LIMITS`) |
| `src/git/parse/refs.js`, `parse/push.js` | `parseTracking`, `parseConflictFiles`; `parsePushPorcelain`, `classifyRemoteFailure` — pure |
| `src/activity/log.js` | `createActivityLog()`: the ring, its events, cancel |
| `src/routes/*.js` | One file per feature, each `mount(router, deps)`; `index.js` mounts them |

**Frontend** (`frontend/src/`):

| Path | Responsibility |
|---|---|
| `main.tsx`, `App.tsx` | Mount; restore tabs (storage, then the URL's tab), mirror the active tab into the URL, follow `popstate` |
| `lib/api.ts` | `api()`: relative URLs only, JSON body + content type on non-GET, `ApiError` |
| `lib/endpoints.ts` | Typed calls and the API's TypeScript shapes |
| `lib/route.ts` | Query-string route read/write |
| `lib/sse.ts` | One shared `EventSource` on `api/activity/events`; `setEventSourceFactory` is the test seam |
| `lib/storage.ts` | The only `localStorage` user; keys prefixed `code-git:` |
| `state/store.ts` | `createStore` + `useStore` (`useSyncExternalStore`) |
| `state/tabs.ts` | `tabsReducer` (pure), `tabsStore`, `tabKey`, persistence |
| `state/useRepos.ts`, `useActivity.ts`, `useRepoSummary.ts` | One store per feature; per-checkout state is a map keyed by `tabKey` |
| `state/shownPanel.ts` | Which on-demand panel each tab shows (`showPanel`, `hidePanel`, `useShownPanel`); `pruneClosedTabs` drops a closed tab's keys from a tab-keyed store |
| `state/diff.ts` | `diffStore` (per tab: source, list, selection, viewed path, file diffs by `fileKey`), `prefsStore` (persisted `code-git:diff-prefs`), the list/file loaders |
| `features/diff/` | `openDiff.ts` (the entry point), `api.ts` (wire types + op wrappers), `model.ts` / `viewRows.ts` / `wordDiff.ts` / `segments.ts` (pure row models), `highlight/` (Prism, lazily loaded), the panels and views |
| `state/workdir.ts` | `workdirStore` (per tab: the unstaged/staged lists from `diff.files`, merge state, the commit draft, template draft, amend, skip-hooks, the last op error, focus request, narrow dialog); `runWorkdirOp` (busy → op → refresh lists + summary + an open unstaged/staged diff), `commitDraft`, `setAmend` |
| `features/workdir/` | The Changes panel: `panel.ts`, `WorkdirPanel` (slot instance, shown per `rightSlot.ts`; always mounts `ConfirmHost`, `ChangesDialog` and the global keys), `WorkdirContent`, `FileSection`, `CommitBox` (`commitRules`), `DetachedBanner`, `ChangesButton` (the graph toolbar's narrow button) and `ChangesDialog` (mounted by `WorkdirPanel`), `actions.ts` (file actions + `'workdir-file'` menu), `entry.ts` (`openWorkingTree`), `api.ts` (wire types + op wrappers) |
| `features/staging/` | Hunk and line staging in the diff: `partial.ts` (`canPartial`, the single UI rule), `selection.ts` (pure `toggle`, `extendRange`, `toRequest`, `hunkRequest`, `previewLines`), `actions.ts` (`applyLines`), `HunkActions`, `SelectionBar` |
| `state/lineSelection.ts` | Per tab, the selected `h:i` line keys, valid only for the viewed `fileKey` and diff list `generation` |
| `lib/confirm.ts` | `confirm(opts)` → `Promise<boolean>`: the one pending confirmation, rendered by `ConfirmHost` (`features/workdir/ConfirmDialog.tsx`) |
| `lib/download.ts` | `downloadBytes` (blob URL → `a.download`), `decodeBase64`: the only object-URL / download-link builder |
| `shell/Shell.tsx` | Layout, panel slots, picker |
| `shell/panels.ts`, `shell/menus.ts`, `shell/ActionMenu.tsx` | The panel and context-menu registries |
| `features/<feature>/` | Feature components and their tests |
| `features/graph/` | The commit graph ([graph](graph.md)): pure `layout.ts` (lanes), `rows.ts` (row order), `visibility.ts` (hide/solo → tips), `labels.ts`, `ancestry.ts`, `columns.ts` (the column catalogue), `windowFor.ts` (virtual window); the panels `GraphPanel.tsx`, `RefsPanel.tsx`, `details/`; `actions.ts` (`GRAPH_ACTIONS`), `contexts.ts`, `drag.ts`, `jump.ts`; `panel.ts` (the three `PanelDef`s) |
| `state/graph.ts`, `state/graphPrefs.ts`, `state/graphSelection.ts` | Graph data per checkout (snapshot, pages, stats, refresh triggers); per-project prefs; selection and the file-open intent |
| `shell/ContextMenuHost.tsx` | A context menu at the pointer for any registered context (`openContextMenu`) |
| `features/branches/` | Branches, tags and HEAD ([refs](refs.md)): `api.ts` (wire types + op wrappers), `run.ts` (`runRefOp`: toast + graph refresh), `actions.ts` (`BRANCH_ACTIONS`, the cc HEAD gate `withCcHeadAck`), `refInfo.ts` (checked-out / cc-owned reads of the graph's refs), `RefDialogHost.tsx` + `dialogs/`, `TrackingBadge.tsx`, `CreateBranchButton.tsx` |
| `state/refDialog.ts`, `state/refSelection.ts`, `state/branchTracking.ts` | The pending branch/tag dialog; the refs panel's branch selection per tab (`refSelectionReducer`, `selectedRefs`); ahead/behind per project (`useTracking`) |
| `lib/opToast.ts`, `shell/Toasts.tsx` | `trackOp` (an op's running → outcome toast); the one sonner `<Toaster>`, mounted beside `<App>` in `main.tsx` |
| `lib/cssVars.ts`, `lib/limit.ts` | `setCssPx` (the only `.style` user); `mapLimit` (bounded concurrency) |
| `components/ui/`, `lib/utils.ts`, `lib/modalFocus.ts`, `lib/textEntry.ts`, `lib/useMediaQuery.ts` | Copied from cc's `web/src` on first use; the plugin's own code from then on |

## Extension points

What a later card touches to add a feature — each is one file of its own plus one line in a shared file:

| To add | Create | Register in |
|---|---|---|
| A backend op | `src/git/ops/<feature>.js` exporting `ops = [{name, kind, cancellable?, params, run}]` | the list passed to `buildRegistry` in `src/git/ops/index.js` |
| Backend routes (rarely: ops go through `api/ops/:name`) | `src/routes/<feature>.js` exporting `mount(router, deps)` | `mountRoutes` in `src/routes/index.js` |
| A panel | a `PanelDef` (`{id, slot, title, component, order, onDemand?}`) in `frontend/src/features/<feature>/` | `PANELS` in `frontend/src/shell/panels.ts` |
| A panel shown on demand (the diff) | a `PanelDef` with `onDemand: true`; show it with `showPanel(tab, id)` (`state/shownPanel.ts`) | `PANELS`; while shown it replaces its slot's other panels for that tab |
| Opening a diff (graph, details panel) | call `openDiff(target, source, {path?})` from `features/diff/openDiff.ts`; `closeDiff(target)` | nothing |
| Bringing up the commit box (the graph's work-in-progress row, "Edit HEAD message…") | call `openWorkingTree(target, {amend?: 'message', focus?})` from `features/workdir/entry.ts`: wide → the right slot shows Changes (a commit selection is cleared) and, unless `focus: false`, its summary takes the focus; below `lg` → opens the Changes dialog; `amend: 'message'` ticks Amend with HEAD's message. `openWip(tab, checkout, opts)` does the same for a WIP row, opening another checkout's tab first | nothing |
| Which panel the right slot shows | `changesInRightSlot(items)` (`features/workdir/rightSlot.ts`): the Changes panel for an empty graph selection or a single WIP row, the commit details otherwise; both panels read it | nothing |
| Refreshing the Changes lists after an op of another card | `refreshWorkdir(target)` (`features/workdir/entry.ts`) | nothing |
| Asking before a destructive action | `await confirm({title, body, items?, count?, preview?, irreversible?, confirmLabel})` (`lib/confirm.ts`); send nothing unless it resolves true | nothing (the Changes panel mounts `ConfirmHost`) |
| Context-menu actions | `MenuAction[]` in the feature folder (fields below) | `ACTIONS` in `frontend/src/shell/menus.ts`; render with `<ActionMenuItems context ctx>` inside a `DropdownMenuContent`, or open at the pointer with `openContextMenu({host, context, ctx, at})` and a mounted `<ContextMenuHost host>` |
| Per-checkout UI state | `frontend/src/state/<feature>.ts`: a `createStore` map keyed by `tabKey` | nothing; add its reset to `frontend/src/test/setup.ts` |

**`MenuAction<C>`**: `{id, context, label: string | (ctx) => string, when?, run?, children?, group?, order?, destructive?, primary?}`. `children` is a submenu — a list, or `(ctx) => list` to build it from the ctx (one item per remote) — whose children inherit the context; a submenu with no child left after `when` is not shown. `group` puts a separator between consecutive actions of different groups; `order` (default 500) sorts, ties keep registration order. `primary` marks the action a double-click runs: `runPrimary(context, ctx)` (`shell/menus.ts`) runs the first primary action offered and returns whether one ran. A menu with no action does not open.

**Order convention**: 100 checkout / navigation, 200 create, 300 history-rewriting, 400 stash, 800 view, 900 copy, 950 visibility.

**Graph contexts** (`features/graph/contexts.ts`; every ctx has `tab`):

| `context` | ctx |
|---|---|
| `commit` | `{commit: CommitItem, refs: Ref[]` (visible refs at it)`, selection: RowId[]}` |
| `commits` | `{rows: GraphRow[]}`, two or more selected rows, top to bottom |
| `wip` | `{checkout: Target, name, isOwn}` |
| `branch` | `{ref: Ref}`, local or remote (check `ref.kind`) |
| `tag` | `{ref: Ref}` |
| `stash` | `{stash: Stash}` |
| `remote` | `{remote: string}` |
| `worktree` | `{worktree: GitWorktree, ccCheckout: Target \| null}` |
| `file` | `{commit: oid, parent: oid \| null, file: {status, path, oldPath}}` |
| `branch-drop` | `{source: DragRef, target: DragRef}` — a branch chip dropped on another; `DragRef = {name: full refname, kind: 'local' \| 'remote', short, remote, oid}`. Orders 100–199 are reserved for merge / rebase; Fast-forward is 200, Reset 300 |
| `branches` | `{refs: Ref[]}` — two or more branches selected in the refs panel (local and remote) |

**Graph stores other cards read** (`frontend/src/state/graphSelection.ts`, `features/graph/drag.ts`):

- `graphSelectionStore`: per `tabKey`, `{ids, anchor, focus, items}`; `items` (also `selectedRows(tab)`) are `{kind: 'commit' | 'stash', oid} | {kind: 'wip', checkout: Target}`, top to bottom.
- `fileIntentStore`: `{seq, tab, commit, parent, path, oldPath, selection}` — the last file clicked in the details panel (`requestFileOpen`); `seq` increases per request. `features/graph/diffWiring.ts` subscribes and opens the diff (`openDiff`); every graph entry point to a diff goes through `selectionDiff` / `openIn` there.
- `branchDropStore`: `{seq, tab, source, target, at}` — every drop, before its menu opens.

**Ref writes other cards build on:**

- **Toasts**: `trackOp(fn, {running, done, failed?, toastRunning?})` in `lib/opToast.ts` for any op the user should see progress of; `done` may return a warning with an action, or `null` for no toast.
- **Remote commands**: `src/git/remote/push.js` (`remoteName` in `params`, `knownRemote`, `push` with `NETWORK_LIMITS` and the auth/unreachable classification); fetch and pull reuse `NETWORK_LIMITS` and `classifyRemoteFailure`.
- **Undo**: every ref-changing op returns `result.undo` (`undoRecord`, [refs → Undo record](refs.md#undo-record)); a journal reads it in `runRefOp` (`features/branches/run.ts`).
- **Branch actions**: `checkout(tab, ref)`, `reset(tab, point, mode)` and `withCcHeadAck` in `features/branches/actions.ts`; `openRefDialog` for a confirmation.

**Dynamic geometry** (positions, sizes from data) is set only through `setCssPx(el, '--name', px)` (`lib/cssVars.ts`: a finite number, a `--[a-z][a-z0-9-]*` name) and read by Tailwind classes such as `h-(--graph-total)`; `guards.test.ts` fails on any other `.style` access outside `components/ui/`.

**Op definition rules** (enforced by `buildRegistry` at load; a violation throws):

- `name` matches `^[a-z]+\.[a-zA-Z]+$` and is unique.
- `kind` is `'read'` or `'write'`.
- `cancellable`, when given, is a boolean; it defaults to `kind === 'read'`. A write sets `cancellable: true` only where aborting mid-command cannot leave the repo half-changed (fetch, push), and its card states why.
- `params(raw)` validates and returns typed params or throws a `Refusal`; `run(git, params, {target})` returns JSON. `target` is the call's validated `{project, worktree}` (worktree `null` = main checkout), for an op that names its output after the checkout (`diff.patch`); git still runs only through `git`. `git(args, opts)` is `runGit` bound to the call's context. One op may run several commands; each gets its own activity entry with the call's `opRunId`.

## Runner pipeline (`runGit`)

1. argv = `['git', ...BASE_ARGS, ...args]`. `BASE_ARGS` disables the pager, colour, path quoting, fsmonitor and submodule recursion (`submodule.recurse=false`: a repo's `true` would make a discard of a submodule row discard the submodule's own uncommitted work; a later card passes `--recurse-submodules` explicitly), and pins `--work-tree=.`: the checkout cc runs the command in is the working tree, whatever the repo's `core.worktree` says (it resolves after any `-C <subpath>` an op adds). A bare repository then looks like a working tree of its own files, so `repo.summary` (before `status`) and every write check first whether the git dir is the working tree itself — `rev-parse --git-dir` printing exactly `.`, no path parsed — and refuse `BARE_REPO` (`src/git/worktree.js`: `isBare`, `assertWorktree`). Never `core.bare`: the repository sets it (directly or through an `[include]`), so a bare repo saying `false` would pass.
2. env = `BASE_ENV` + (`READ_ENV` for reads) + the op's env. An op's env naming a protected variable (`isProtectedEnv`: the names in `PROTECTED_ENV` — `GIT_TERMINAL_PROMPT`, `GCM_INTERACTIVE`, `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_LITERAL_PATHSPECS`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_EXEC_PATH` — and every name starting with a `PROTECTED_ENV_PREFIXES` entry: `GIT_SSH` (`GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_SSH_VARIANT`, …) or `GIT_CONFIG`) throws before anything runs or is logged: a code-git bug, answered 500 `INTERNAL`. `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` stay overridable (an interactive-rebase todo editor, say).
3. A write takes its **project's** lock (worktrees share refs and objects); reads and other projects never wait.
4. The activity entry opens (`running`) with its own `AbortController`, combined with the op's signal.
5. `exec` → cc. The deadline and output cap default from `LIMITS[kind]`.
6. The entry closes with cc's duration, the exit code, the stderr tail, and a status. An exit outside `okExit` (default `[0]`) throws `GIT_FAILED`.

**Non-interactive git.** `BASE_ENV` sets `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_EDITOR=false`, `GIT_SEQUENCE_EDITOR=false` (an accidental editor launch fails instead of hanging), `GIT_LITERAL_PATHSPECS=1` and `LC_ALL=C` (git's own messages only — repo-specific matching such as `NOT_A_REPO` relies on it). `READ_ENV` adds `GIT_OPTIONAL_LOCKS=0`, so a read never refreshes the index.

**Validation.** No route takes argv or git options. Everything a user names is checked before any exec:

| Input | Check | Then |
|---|---|---|
| target | `assertTarget`: only `project`/`worktree` keys; names not `.`/`..` (they would rewrite the cc URL a name is spliced into) | sent as exec form A, so the System is always the project's own |
| a ref to create | `assertRefName` (`git check-ref-format --allow-onelevel` rules, no leading `-`) | — |
| an object id | `assertOid`: 40 or 64 lowercase hex | sent on stdin or after `--end-of-options` |
| a revision | `assertRev`: no leading `-`, whitespace or control characters | placed after `--end-of-options` where the subcommand parses options |
| a path | `assertPath`: relative, no `..` segment, NUL or backslash; a leading `-` is allowed | always after `--`; `GIT_LITERAL_PATHSPECS=1` makes `:(glob)`, `*` and friends literal |
| a `-C` subpath | `assertSubpath`: `assertPath` + no leading `-` | — |

**No process or filesystem access in `src/`** except `src/http/static.js` reading `frontend/dist`: git runs only through cc. A test (`exec.test.js` guard) enforces it.

## Diff

- **Paging unit = one file.** `diff.files` is one `--raw --numstat -z` command under `DIFF_LIMITS.listMaxOutputBytes`; past it the whole list is refused (`OUTPUT_TOO_LARGE`), never shown partial. Each file's hunks are a separate `diff.file` under `fileMaxOutputBytes`.
- **Pinned pair.** `diff.files` returns the resolved `pair`; the UI loads every file with `{kind: 'pair', ...pair}`, so a moving HEAD or ref cannot mix two commits in one view. Work-in-progress sides are refetched by Refresh or a new `openDiff`.
- **Config that reshapes diff text is overridden on every command** (`DIFF_CONFIG`, `DIFF_FLAGS`, `FORMAT_PATCH_FLAGS`); the list of keys and their overrides: [wiki: gotchas/diff-parsing](../.wiki/gotchas/diff-parsing.md). The test fixture (`tests/_diffRepo.js`) sets all of them. **Not neutralised:** `filter.<driver>.clean` / `.process` still run when a diff reads a worktree file (worktree sides and untracked `--no-index`); git has no diff flag to disable them, and `git status` (`repo.summary`) already runs them for tracked files.
- **Contract for later cards.** `openDiff(target, source, {path})` opens a diff (the graph's details panel and multi-select). `FileDiff` → `Hunk` (id = `header`) → `DiffLine` is the model per-hunk/line staging addresses as `(hunk index, line index)`; a patch rebuilt from it needs `whitespace: 'none'` ([protocol](protocol.md#difffile-read-cancellable)).
- **UI state.** `diffStore` is keyed by `tabKey`; a list load bumps `generation`, and a file answer for an older generation is dropped. `fileKey` = path + context + whitespace, so switching mode or context refetches only what is missing. Inline, Split and File view request `context: 'full'`; Hunk mode the chosen context.
- **Line staging in the views.** `Cell` carries its `(hunk, index)`; a hunk row its `hunk`. `UnifiedView` / `SplitView` take an optional `staging: StagingView` (`CodeLine.tsx`: `selected`, `onToggle`, `hunkActions`); only `DiffPanel` builds it, and only when `canPartial`. The request's `context` is `contextFor(prefs)`, the context the hunks were loaded with.
- **Rows** render as `div`s in chunks of `CHUNK_ROWS` with `content-visibility: auto` (`Chunked` in `features/diff/CodeLine.tsx`); a change block's first row carries `data-change-index`, a search match `data-match` / `data-match-current`.

### Rendering safety: highlighting

- `highlight/prismManual.ts` sets `globalThis.Prism = {manual: true, …}` and is the first import of `highlight/prism.ts`, so Prism never highlights `language-*` elements on load. `prism.ts` is reached only by `import()` (its own chunk).
- Only `Prism.tokenize` is used. `highlightLines` flattens the token tree to `{text, cls}` segments; `cls` comes only from the fixed `TOKEN_CLASS` map; `CodeLine` renders them as React text. `guards.test.ts` refuses `Prism.highlight`, `highlightElement` and `highlightAll` anywhere.
- Bounded per file side: past `HIGHLIGHT_MAX_LINE_CHARS`, `HIGHLIGHT_MAX_LINES` or `HIGHLIGHT_MAX_SIDE_CHARS` the side is plain and the tokenizer is not called. Word emphasis is bounded by `WORD_DIFF_MAX_CHARS` / `WORD_DIFF_MAX_TOKENS`.
- A patch download is a local `blob:` URL of `text/x-diff` bytes, clicked and revoked, never rendered; its name is the backend's sanitized `filename`. Only `lib/download.ts` builds object URLs or download links (guard test).

## Staging and committing

- **Byte-exact selection patches.** The line ops read the file's diff as latin1 (one character per byte), so CR, non-UTF-8 bytes and git's path quoting pass through unchanged; only the comparison with the request decodes UTF-8, the way `diff.file` decoded what the UI showed. Rules: [protocol → Stage selection](protocol.md#stage-selection-stagestagelines-stageunstagelines-stagediscardlines-write).

- **Residual risks.** `commit.gpgSign=true` runs the configured signer; a signer that cannot sign (no key, or no pinentry: the exec has no tty) fails at once as `GIT_FAILED` — verified with gpg 2 + pinentry-curses (`RUN_REAL_GPG=1` test in `tests/ops-commit.test.js`). A signer that waits forever would run until the write timeout. Commit messages are assumed UTF-8 (`i18n.commitEncoding` is not read).
  - **`git apply --index` writes through an untracked symlink.** It checks a path's leading directories against the index only, so with an untracked `link → /outside` a patch creating `link/x` writes `/outside/x` (exit 0). Plain `git apply` (worktree) lstat-checks and refuses ("beyond a symbolic link"); `--cached` writes only the index. So no op passes `--index`: `patch.apply` offers worktree and index only. Any later op that would use `--index` (stash, cherry-pick by patch) must not, or must first refuse every path git's worktree check refuses.
  - **Programs a hostile repo config, `.gitattributes` or hooks make git run** during staging, committing and the ref writes ([refs](refs.md)) (accepted: cc projects are the user's own; the same class as C1's `git status` running filters):

| Config | Runs on |
|---|---|
| `filter.<driver>.smudge` / `.process` | writing a worktree file: `patch.apply` (worktree), `stage.discardLines`, `stage.discardFiles` (tracked), `files.restore`; checkouts (`branch.checkout`, `branch.create` with checkout), `head.reset` hard, this checkout's `branch.fastForward`, `head.revert`, `head.cherryPick`, `head.abort` |
| `filter.<driver>.clean` / `.process` | reading a worktree file into git: `stage.files`, `stage.stageLines` and every diff of a worktree side (including the selection ops' re-reads); `head.reset` hard's `stash create` |
| `core.hooksPath` (and `.git/hooks`) | `commit.create` (pre-commit, commit-msg, …), unless **Skip Git hooks**; pre-push (every push: `branch.deleteRemote`, `tag.push`, `tag.deleteRemote`); post-checkout (checkouts); post-merge (fast-forwards by `merge --ff-only`); reference-transaction (every ref update); the commit hooks git runs for `head.revert` / `head.cherryPick` |
| `commit.gpgSign` / `gpg.program` | `commit.create`; the commits `head.revert` and `head.cherryPick` make |
| `tag.gpgSign` / `tag.forceSignAnnotated` / `gpg.program` | `tag.create`. A signer that cannot sign fails as `GIT_FAILED` and can leave `.git/TAG_EDITMSG` behind; one that waits runs until the write timeout |
| `core.sshCommand`, `remote.<name>.receivepack` / `.uploadpack`, `url.<base>.insteadOf` with `protocol.<name>.allow` (e.g. an `ext::` transport) | every push: `branch.deleteRemote`, `tag.push`, `tag.deleteRemote` (the env cannot set them — `GIT_SSH*` and `GIT_CONFIG*` are protected names — but the repo's config can) |

  - **A project whose `.git` is a file pointing at another repository's git dir makes code-git act on that repository.** That is git's own model (cc worktrees use `.git` files legitimately) and cc projects are the user's own; the same class as the other hostile-repo residuals. `--work-tree=.` keeps the working tree the checkout's, not the git dir.

### What each destructive op destroys

For the undo card: what an op overwrites or deletes, and whether git can give it back. The branch, tag and HEAD ops: [refs → Undo record](refs.md#undo-record) (their `result.undo` and the table there).

| Op | Destroys | Recoverable from git |
|---|---|---|
| `stage.files`, `stage.unstageFiles` | The previous index entries of those paths | Yes: HEAD and the worktree still hold both sides |
| `stage.discardFiles` — tracked | The worktree content of those paths (returned in `result.tracked`) | No: it is in no object. An undo needs a `hash-object -w` snapshot taken before the discard |
| `stage.discardFiles` — untracked | The files (returned in `result.untracked`) | No; the same snapshot would be needed |
| `stage.stageLines`, `stage.unstageLines` | Nothing outside the index | Yes |
| `ignore.add` | With `stopTracking`, the index entries of the matching files (returned in `result.untracked`); the files stay | Yes: `git add` re-tracks them; `.gitignore` gains one line |
| `files.restore` | That path's index entry and worktree content (an untracked symlink in the way is replaced by a directory) | The index entry yes (HEAD); uncommitted worktree content no |
| `patch.apply` | Nothing it does not change; atomic | Yes: the same patch applied with `-R` |
| `commit.create` with `amend` | Nothing: HEAD moves to the new commit | Yes: the replaced commit stays in the reflog (`HEAD@{1}`) |
| `stage.discardLines` | Exactly the lines of the applied patch, from the worktree | Yes, by the op itself: `result.patchB64` applied forward (`git apply`) restores them |

## Long ops, cancel and paging

- cc's exec buffers output and has no progress channel. An op stays pending up to its `timeoutMs`; its activity entry is pushed as `running` first, so the UI shows an elapsed timer and, when the op is cancellable, **Cancel**.
- Cancel aborts the request to cc; cc kills the command when its client disconnects. The HTTP client of `POST api/ops/:name` going away aborts the op the same way — only when the op is cancellable. A non-cancellable write keeps running and is logged.
- The fetch deadline is past cc's (`timeoutMs + min(10 s, timeoutMs)`) so cc reports `EXEC_TIMEOUT` first.
- Large reads page by git arguments, never by re-slicing output ([protocol](protocol.md#paging-convention-for-ops-that-list)).

## Activity log

- In memory, per backend process, newest `LIMITS.activityRing` entries. **Diagnostic only**: undo, reflog and every other feature derive state from git, never from this log.
- Records what ran (argv), where, the op's env overlay with secret-looking values redacted, stdin size (never content), the stderr tail (hook output included, decoded with `TextDecoder` `fatal: false`).
- `events` (an `EventEmitter`) feeds the SSE route; the UI refetches on each event.

## UI state and routing

- No state library: `createStore` + `useSyncExternalStore`. Each feature owns its store; per-checkout state is keyed by `tabKey` (`project + '\0' + (worktree ?? '')`).
- Tabs persist under `code-git:tabs`; the active tab is mirrored into `?project=…&worktree=…` with `history.pushState` (which cc's bridge turns into `replaceState`), read on load and on `popstate`.
- Untrusted text (argv, stderr, ref and project names, git messages) renders only as React text children: no raw-HTML API, no `href`/`src`/`style` built from data. `guards.test.ts` scans the sources for both, and for colours that bypass the tokens (literal colours, palette shades, `white`/`black`, non-`var()` arbitrary values) outside the copied `components/ui/`.
- Palette: `cc-theme-fallback.css` is a one-time snapshot of cc's tokens in `@layer base`; embedded, cc's unlayered `/pluginTheme.css` wins. `palette.test.ts` pins its values and the `@theme inline` block from cc's `docs/plugin-ui.md`.

## Test patterns

- **Backend** (`tests/`, `node --test`): `_fakeCc.js` is a real HTTP server standing in for cc. Its `POST /api/exec` validates the request like cc (unknown keys, form A/B, env names, caps), records any form-B or `shell` use in `state.violations`, and runs **real git** in the resolved directory with a hermetic env (temp `HOME`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL`). It enforces timeout, output cap and spawn failure, and kills the command on client disconnect. Knobs: `execHook(body)` → a canned answer, `'hold'` (answer when `release()`d; `nextHeld()` resolves it, `held.disconnected` / `held.closed` report a client abort) or `'reset'`; `systemDown(project)`.
- A "remote" project (`system: 'docker'`) runs locally, proving the plugin addresses it by `{project, worktree}` alone.
- `_diffRepo.js`: `diffRepo(t)` — one repo with every diff source and file state (merge, root, orphan, side branch, rename, binary, LFS pointer, oversized file, gitlink, `-rf` and `:(glob)*`, staged/unstaged/untracked, symlinks) and a hostile `.git/config` set last; the Playwright seed's `diffs` project reuses it.
- `_ops.js`: `opWorld(t)` — one repo behind the fake cc and `op(name, params)` running an op as the route does; `hostile(repo)` sets `STAGE_HOSTILE_CONFIG` (the diff fixture's keys, a failing `diff.external`, `apply.whitespace=error`, `apply.ignoreWhitespace=change`); `status()`, `indexBlob(path)`, `execArgv()`. The staging, commit, ignore and patch op tests build on it; `RUN_REAL_GPG=1` enables the one real-gpg test.
- `_git.js`: `makeRepo(t)` (temp dir, `main`, pinned identity and dates, cleaned up after the test), `bareRemote`, `worktreeAdd`, `hook`. `_ctx.js` builds a runner context; `_app.js` boots the server on port 0 and reads SSE.
- `_refsWorld.js`: `refsWorld(t)` — a repo with one commit pushed to a bare `origin`, the fake cc, `op(name, params, worktree?)`, `worktree(name, branch)` (a git worktree registered with the fake cc), `argvs()` / `writes()` (the exec log after `BASE_ARGS`), `refused(code, extra)`, `endOfOptionsBefore(argv, value)`.
- **UI** (`frontend/src/**/*.test.{ts,tsx}`, Vitest + happy-dom): `test/stubFetch.ts` (route table; an unstubbed or root-relative request fails), `test/fakeEventSource.ts`, `test/fixtures.ts`, `test/diffFixtures.ts` (`dfile`, `filesResult`, `hunk`, `fdiff`), `test/workdirWorld.ts` (a stubbed backend for the Changes panel and line staging: lists by source kind, the commit reads, every write answered ok unless overridden; `posts(op)`); `test/setup.ts` resets every store, storage and the URL after each test.
- **Graph tests**: `tests/_graphFixture.js` (`buildGraphFixture`: a seeded large history via `git fast-import`); UI side `test/graphData.ts` (row/ref builders) and `test/graphBackend.ts` (`stubGraph(world, extra?)`: the graph ops over a mutable in-memory world, plus `extra` routes for another feature's ops). Tests that mock `@/shell/menus` call `vi.resetModules()` and import the menu modules dynamically: `test/setup.ts` has already loaded the real registry.
- **Harnesses**: `harness/playwright/` (seeded screenshots, golden path, the diff path, the staging path, the graph's visual and perf checks, read-only live checks) and `harness/mutation/` (code-mutant routes `server` and `ui`).
