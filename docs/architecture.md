> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md)

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
| `src/git/validate.js` | Pure input checks: `assertTarget`, `assertRefName`, `assertRev`, `assertPath`, `assertSubpath` |
| `src/git/limits.js` | `LIMITS`: per-kind timeout / output cap, stderr cap, activity ring size, cc read deadline |
| `src/git/runner.js` | `runGit(ctx, args, opts)`: **the** choke point for git |
| `src/git/locks.js` | `createLocks()`: keyed promise queue |
| `src/git/ops/index.js` | The op registry: `buildRegistry`, `OPS`, `getOp` |
| `src/git/ops/repo.js` | `repo.summary` |
| `src/git/parse/status.js` | `parseStatus`: porcelain v2 `-z` → summary |
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
| `shell/Shell.tsx` | Layout, panel slots, picker |
| `shell/panels.ts`, `shell/menus.ts`, `shell/ActionMenu.tsx` | The panel and context-menu registries |
| `features/<feature>/` | Feature components and their tests |
| `components/ui/`, `lib/utils.ts`, `lib/modalFocus.ts`, `lib/textEntry.ts`, `lib/useMediaQuery.ts` | Copied from cc's `web/src` on first use; the plugin's own code from then on |

## Extension points

What a later card touches to add a feature — each is one file of its own plus one line in a shared file:

| To add | Create | Register in |
|---|---|---|
| A backend op | `src/git/ops/<feature>.js` exporting `ops = [{name, kind, cancellable?, params, run}]` | the list passed to `buildRegistry` in `src/git/ops/index.js` |
| Backend routes (rarely: ops go through `api/ops/:name`) | `src/routes/<feature>.js` exporting `mount(router, deps)` | `mountRoutes` in `src/routes/index.js` |
| A panel | a `PanelDef` (`{id, slot, title, component, order}`) in `frontend/src/features/<feature>/` | `PANELS` in `frontend/src/shell/panels.ts` |
| Context-menu actions | `MenuAction[]` (`{id, context, label, when?, run, destructive?}`) in the feature folder | `ACTIONS` in `frontend/src/shell/menus.ts`; render with `<ActionMenuItems context ctx>` |
| Per-checkout UI state | `frontend/src/state/<feature>.ts`: a `createStore` map keyed by `tabKey` | nothing; add its reset to `frontend/src/test/setup.ts` |

**Op definition rules** (enforced by `buildRegistry` at load; a violation throws):

- `name` matches `^[a-z]+\.[a-zA-Z]+$` and is unique.
- `kind` is `'read'` or `'write'`.
- `cancellable`, when given, is a boolean; it defaults to `kind === 'read'`. A write sets `cancellable: true` only where aborting mid-command cannot leave the repo half-changed (fetch, push), and its card states why.
- `params(raw)` validates and returns typed params or throws a `Refusal`; `run(git, params)` returns JSON. `git(args, opts)` is `runGit` bound to the call's context. One op may run several commands; each gets its own activity entry with the call's `opRunId`.

## Runner pipeline (`runGit`)

1. argv = `['git', ...BASE_ARGS, ...args]`. `BASE_ARGS` disables the pager, colour, path quoting and fsmonitor.
2. env = `BASE_ENV` + (`READ_ENV` for reads) + the op's env. An op's env naming a protected variable (`isProtectedEnv`: the names in `PROTECTED_ENV` — prompts, `GIT_LITERAL_PATHSPECS`, `GIT_DIR`/`GIT_WORK_TREE`, `GIT_EXEC_PATH`, `GIT_SSH_COMMAND`/`GIT_SSH` — and every `GIT_CONFIG*` name) throws before anything runs or is logged: a code-git bug, answered 500 `INTERNAL`. `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` stay overridable (an interactive-rebase todo editor, say).
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
| a revision | `assertRev`: no leading `-`, whitespace or control characters | placed after `--end-of-options` where the subcommand parses options |
| a path | `assertPath`: relative, no `..` segment, NUL or backslash; a leading `-` is allowed | always after `--`; `GIT_LITERAL_PATHSPECS=1` makes `:(glob)`, `*` and friends literal |
| a `-C` subpath | `assertSubpath`: `assertPath` + no leading `-` | — |

**No process or filesystem access in `src/`** except `src/http/static.js` reading `frontend/dist`: git runs only through cc. A test (`exec.test.js` guard) enforces it.

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
- `_git.js`: `makeRepo(t)` (temp dir, `main`, pinned identity and dates, cleaned up after the test), `bareRemote`, `worktreeAdd`, `hook`. `_ctx.js` builds a runner context; `_app.js` boots the server on port 0 and reads SSE.
- **UI** (`frontend/src/**/*.test.{ts,tsx}`, Vitest + happy-dom): `test/stubFetch.ts` (route table; an unstubbed or root-relative request fails), `test/fakeEventSource.ts`, `test/fixtures.ts`; `test/setup.ts` resets every store, storage and the URL after each test.
- **Harnesses**: `harness/playwright/` (seeded screenshots, golden path, read-only live check) and `harness/mutation/` (code-mutant routes `server` and `ui`).
