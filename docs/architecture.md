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
| `src/git/params.js` | Shared op-param checks: `paramsObject`, `optBool`, `pathList`; `nulPaths` (stdin for `--pathspec-from-file`), `chunkPaths` (argv chunks) |
| `src/git/stage/limits.js` | `STAGE_LIMITS`: staging, commit-template, `.gitignore` and patch caps |
| `src/git/ops/stage.js` | `stage.files`, `stage.unstageFiles`, `stage.discardFiles`; `stage.stageLines`, `stage.unstageLines`, `stage.discardLines` |
| `src/git/ops/commit.js` | `commit.create`, `commit.headMessage`, `commit.template` |
| `src/git/commit/message.js` | `joinMessage`, `splitMessage`, `templateDraft` (pure): the only place a message is split or joined |
| `src/git/stage/selection.js` | `buildSelectionPatch` (pure): a hunk/line selection + the file's latin1 diff → the patch to apply; `asShown` |
| `src/git/diff/limits.js` | `DIFF_LIMITS`: the diff caps (list / file / patch bytes, oversize lines, max commits and paths) |
| `src/git/parse/diff.js` | `parseRawNumstat`, `parseFilePatch`, `detectLfs`, `sideLines` — pure |
| `src/git/parse/status.js` | `parseStatus`: porcelain v2 `-z` → summary |
| `src/git/ops/graph.js` | `graph.refs`, `graph.page`, `graph.stats`, `graph.search`, `graph.commit` ([graph](graph.md)) |
| `src/git/parse/graph.js` | The graph ops' parsers: NUL-field records, refs, stashes, worktrees, shortstats, commit metadata, name-status |
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
| `lib/download.ts` | `downloadBytes` (blob URL → `a.download`), `decodeBase64`: the only object-URL / download-link builder |
| `shell/Shell.tsx` | Layout, panel slots, picker |
| `shell/panels.ts`, `shell/menus.ts`, `shell/ActionMenu.tsx` | The panel and context-menu registries |
| `features/<feature>/` | Feature components and their tests |
| `features/graph/` | The commit graph ([graph](graph.md)): pure `layout.ts` (lanes), `rows.ts` (row order), `visibility.ts` (hide/solo → tips), `labels.ts`, `ancestry.ts`, `columns.ts` (the column catalogue), `windowFor.ts` (virtual window); the panels `GraphPanel.tsx`, `RefsPanel.tsx`, `details/`; `actions.ts` (`GRAPH_ACTIONS`), `contexts.ts`, `drag.ts`, `jump.ts`; `panel.ts` (the three `PanelDef`s) |
| `state/graph.ts`, `state/graphPrefs.ts`, `state/graphSelection.ts` | Graph data per checkout (snapshot, pages, stats, refresh triggers); per-project prefs; selection and the file-open intent |
| `shell/ContextMenuHost.tsx` | A context menu at the pointer for any registered context (`openContextMenu`) |
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
| Context-menu actions | `MenuAction[]` in the feature folder (fields below) | `ACTIONS` in `frontend/src/shell/menus.ts`; render with `<ActionMenuItems context ctx>` inside a `DropdownMenuContent`, or open at the pointer with `openContextMenu({host, context, ctx, at})` and a mounted `<ContextMenuHost host>` |
| Per-checkout UI state | `frontend/src/state/<feature>.ts`: a `createStore` map keyed by `tabKey` | nothing; add its reset to `frontend/src/test/setup.ts` |

**`MenuAction<C>`**: `{id, context, label: string | (ctx) => string, when?, run?, children?, group?, order?, destructive?}`. `children` is a submenu (its children inherit the context; a submenu with no child left after `when` is not shown); `group` puts a separator between consecutive actions of different groups; `order` (default 500) sorts, ties keep registration order. A menu with no action does not open.

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
| `branch-drop` | `{source: DragRef, target: DragRef}` — a branch chip dropped on another; `DragRef = {name: full refname, kind: 'local' \| 'remote', short, remote, oid}` |

**Graph stores other cards read** (`frontend/src/state/graphSelection.ts`, `features/graph/drag.ts`):

- `graphSelectionStore`: per `tabKey`, `{ids, anchor, focus, items}`; `items` (also `selectedRows(tab)`) are `{kind: 'commit' | 'stash', oid} | {kind: 'wip', checkout: Target}`, top to bottom.
- `fileIntentStore`: `{seq, tab, commit, parent, path, oldPath, selection}` — the last file clicked in the details panel (`requestFileOpen`); `seq` increases per request. `features/graph/diffWiring.ts` subscribes and opens the diff (`openDiff`); every graph entry point to a diff goes through `selectionDiff` / `openIn` there.
- `branchDropStore`: `{seq, tab, source, target, at}` — every drop, before its menu opens.

**Dynamic geometry** (positions, sizes from data) is set only through `setCssPx(el, '--name', px)` (`lib/cssVars.ts`: a finite number, a `--[a-z][a-z0-9-]*` name) and read by Tailwind classes such as `h-(--graph-total)`; `guards.test.ts` fails on any other `.style` access outside `components/ui/`.

**Op definition rules** (enforced by `buildRegistry` at load; a violation throws):

- `name` matches `^[a-z]+\.[a-zA-Z]+$` and is unique.
- `kind` is `'read'` or `'write'`.
- `cancellable`, when given, is a boolean; it defaults to `kind === 'read'`. A write sets `cancellable: true` only where aborting mid-command cannot leave the repo half-changed (fetch, push), and its card states why.
- `params(raw)` validates and returns typed params or throws a `Refusal`; `run(git, params, {target})` returns JSON. `target` is the call's validated `{project, worktree}` (worktree `null` = main checkout), for an op that names its output after the checkout (`diff.patch`); git still runs only through `git`. `git(args, opts)` is `runGit` bound to the call's context. One op may run several commands; each gets its own activity entry with the call's `opRunId`.

## Runner pipeline (`runGit`)

1. argv = `['git', ...BASE_ARGS, ...args]`. `BASE_ARGS` disables the pager, colour, path quoting and fsmonitor.
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
- **Rows** render as `div`s in chunks of `CHUNK_ROWS` with `content-visibility: auto` (`Chunked` in `features/diff/CodeLine.tsx`); a change block's first row carries `data-change-index`, a search match `data-match` / `data-match-current`.

### Rendering safety: highlighting

- `highlight/prismManual.ts` sets `globalThis.Prism = {manual: true, …}` and is the first import of `highlight/prism.ts`, so Prism never highlights `language-*` elements on load. `prism.ts` is reached only by `import()` (its own chunk).
- Only `Prism.tokenize` is used. `highlightLines` flattens the token tree to `{text, cls}` segments; `cls` comes only from the fixed `TOKEN_CLASS` map; `CodeLine` renders them as React text. `guards.test.ts` refuses `Prism.highlight`, `highlightElement` and `highlightAll` anywhere.
- Bounded per file side: past `HIGHLIGHT_MAX_LINE_CHARS`, `HIGHLIGHT_MAX_LINES` or `HIGHLIGHT_MAX_SIDE_CHARS` the side is plain and the tokenizer is not called. Word emphasis is bounded by `WORD_DIFF_MAX_CHARS` / `WORD_DIFF_MAX_TOKENS`.
- A patch download is a local `blob:` URL of `text/x-diff` bytes, clicked and revoked, never rendered; its name is the backend's sanitized `filename`. Only `lib/download.ts` builds object URLs or download links (guard test).

## Staging and committing

- **Byte-exact selection patches.** The line ops read the file's diff as latin1 (one character per byte), so CR, non-UTF-8 bytes and git's path quoting pass through unchanged; only the comparison with the request decodes UTF-8, the way `diff.file` decoded what the UI showed. Rules: [protocol → Stage selection](protocol.md#stage-selection-stagestagelines-stageunstagelines-stagediscardlines-write).

- **Residual risks.** `commit.gpgSign=true` runs the configured signer; a signer that cannot sign (no key, or no pinentry: the exec has no tty) fails at once as `GIT_FAILED` — verified with gpg 2 + pinentry-curses (`RUN_REAL_GPG=1` test in `tests/ops-commit.test.js`). A signer that waits forever would run until the write timeout. Commit messages are assumed UTF-8 (`i18n.commitEncoding` is not read).

### What each destructive op destroys

For the undo card: what an op overwrites or deletes, and whether git can give it back.

| Op | Destroys | Recoverable from git |
|---|---|---|
| `stage.files`, `stage.unstageFiles` | The previous index entries of those paths | Yes: HEAD and the worktree still hold both sides |
| `stage.discardFiles` — tracked | The worktree content of those paths (returned in `result.tracked`) | No: it is in no object. An undo needs a `hash-object -w` snapshot taken before the discard |
| `stage.discardFiles` — untracked | The files (returned in `result.untracked`) | No; the same snapshot would be needed |
| `stage.stageLines`, `stage.unstageLines` | Nothing outside the index | Yes |
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
- `_git.js`: `makeRepo(t)` (temp dir, `main`, pinned identity and dates, cleaned up after the test), `bareRemote`, `worktreeAdd`, `hook`. `_ctx.js` builds a runner context; `_app.js` boots the server on port 0 and reads SSE.
- **UI** (`frontend/src/**/*.test.{ts,tsx}`, Vitest + happy-dom): `test/stubFetch.ts` (route table; an unstubbed or root-relative request fails), `test/fakeEventSource.ts`, `test/fixtures.ts`, `test/diffFixtures.ts` (`dfile`, `filesResult`, `hunk`, `fdiff`); `test/setup.ts` resets every store, storage and the URL after each test.
- **Graph tests**: `tests/_graphFixture.js` (`buildGraphFixture`: a seeded large history via `git fast-import`); UI side `test/graphData.ts` (row/ref builders) and `test/graphBackend.ts` (`stubGraph(world)`: the graph ops over a mutable in-memory world). Tests that mock `@/shell/menus` call `vi.resetModules()` and import the menu modules dynamically: `test/setup.ts` has already loaded the real registry.
- **Harnesses**: `harness/playwright/` (seeded screenshots, golden path, the diff path, the graph's visual and perf checks, read-only live checks) and `harness/mutation/` (code-mutant routes `server` and `ui`).
