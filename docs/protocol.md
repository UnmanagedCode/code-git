> See also: [README](../README.md) · [features](features.md) · [architecture](architecture.md)

# Protocol

The backend's HTTP API (all paths relative to the plugin root: `/plugins/code-git/` in cc, `/` standalone), the UI's routes, and the cc routes the backend consumes.

## Conventions

- JSON everywhere under `api/`. A refusal is `{error, code, …extra}` with the status from `HTTP_STATUS` (`src/refusals.js`), the single source for codes.
- **State-changing requests** (every non-GET/HEAD under `api/`) must send `Content-Type: application/json` (`/^application\/json\s*(;|$)/i`), else 415 `UNSUPPORTED_MEDIA_TYPE`. Body limit 1 MB (over: 413 `BODY_TOO_LARGE`); malformed JSON: 400 `BAD_REQUEST`.
- Every response — API, UI, 404, 503, errors, parser-rejected requests — carries `Content-Security-Policy` (`CSP` in `src/http/security.js`) and `X-Content-Type-Options: nosniff`.
- An unknown `api/` path is a JSON 404 `NOT_FOUND`; no route answers with the UI.
- An unexpected server error is 500 `INTERNAL` with no detail (logged on the backend).

## Endpoints

| Method + path | Request | 200 response | Refusals |
|---|---|---|---|
| `GET health` (root, outside `api/`) | — | `{ok: true}` | — |
| `GET api/repos` | — | `{repos: Repo[]}` | `CONDUCTOR_UNAVAILABLE` |
| `GET api/repos/:project/worktrees` | — | `{worktrees: Worktree[]}` | `BAD_TARGET`, `PROJECT_UNKNOWN`, `CONDUCTOR_UNAVAILABLE` |
| `POST api/ops/:name` | `{target, params?}` | `{ok: true, result}` | see [Ops](#ops) |
| `GET api/activity` | — | `{entries: ActivityEntry[]}`, newest last | — |
| `GET api/activity/events` | — | `text/event-stream` (below) | — |
| `POST api/activity/:id/cancel` | `{}` (JSON) | `{ok: true}` | 404 `ACTIVITY_UNKNOWN`; 409 `NOT_CANCELLABLE` (the op does not allow cancel, whatever its state); 409 `NOT_RUNNING` (already finished) |

**`Repo`** — one per cc project, none filtered out (`toRepo` in `src/routes/repos.js`):

| Field | Type | Meaning |
|---|---|---|
| `project` | string | cc project name |
| `path` | string | Checkout path on the project's System |
| `workspace` | string \| null | cc workspace |
| `system`, `remoteId` | string, string \| null | The project's System (`local` has `remoteId: null`) |
| `isGitRepo` | boolean, **absent** = cc could not look | One of the reason fields then says why |
| `unbornHead` | boolean | A repo with no commits |
| `systemUnreachable`, `gitRefusal`, `degraded` | string \| null | cc's reason the project cannot be read |

**`Worktree`**: `{worktreeName, branch, baseBranch}` (cc's worktree rows, trimmed).

## Ops

`POST api/ops/:name` with `{target: {project, worktree?}, params?}`. No route accepts argv or git options: an op builds its argv from typed params.

| Check (in order) | Refusal |
|---|---|
| Body is an object with only `target` and `params` | 400 `BAD_PARAMS` |
| `target` is `{project, worktree?}` and nothing else; names non-empty, ≤ 200 chars, no NUL or `/` (`assertTarget`) | 400 `BAD_TARGET` |
| `:name` is a registered op | 404 `UNKNOWN_OP` |
| The op's own `params` check | 400 `BAD_PARAMS`, `BAD_REF`, `BAD_PATH` |
| Running it | the op's refusals, plus the exec refusals below |

**Cancel and disconnect.** An op is `cancellable` when its definition says so; the default is `true` for `kind: 'read'` and `false` for `kind: 'write'`. A cancellable op is aborted by `POST api/activity/:id/cancel` on any of its entries or by its HTTP client going away; the op then answers 409 `CANCELLED`. A non-cancellable op is aborted by neither: it runs to completion and its outcome lands in the activity log.

### `repo.summary` (read, cancellable)

- `params`: none (absent, `null` or `{}`; anything else `BAD_PARAMS`).
- Runs `git status --porcelain=v2 --branch -z --untracked-files=normal`.
- `result`:

```
{ head: {oid: string|null, branch: string|null, unborn: boolean},
  upstream: string|null, ahead: number|null, behind: number|null,
  counts: {staged, unstaged, untracked, conflicted} }
```

| Field | Rule |
|---|---|
| `head.branch` | `null` = detached HEAD |
| `head.unborn` | `true` with `oid: null` when the branch has no commits |
| `ahead`, `behind` | `null` when there is no upstream or git reports no counts for it |
| `counts.staged` / `unstaged` | Tracked entries changed in the index / worktree (an entry can count in both); a rename counts once |
| `counts.conflicted` | Unmerged entries |

- Refusal: 409 `NOT_A_REPO` with `detail` = git's stderr, when git exits 128 saying "not a git repository".

### Paging convention (for ops that list)

No C1 op pages. An op that does returns `{items, nextCursor}` (`nextCursor: null` on the last page) and pages **by git arguments**, never by slicing output (cc's exec is buffered): log by `--max-count` from a cursor commit, diffs by a `--numstat` summary then one path at a time, blame by `-L a,b`, blobs by `cat-file -s` before reading.

## Activity

**`ActivityEntry`** (one git command; `createActivityLog` in `src/activity/log.js`):

| Field | Meaning |
|---|---|
| `id` | Number, increasing |
| `opRunId` | Shared by the commands of one op call |
| `op` | Op name |
| `target` | `{project, worktree}` (`worktree: null` = main checkout) |
| `argv` | Exactly what ran, `git` first |
| `env` | The op's own env overlay (not the base env); values of names matching `/TOKEN\|PASS\|SECRET\|KEY/i` are `[redacted]` |
| `stdinBytes` | Size of stdin; its content is never recorded |
| `cancellable` | From the op definition |
| `startedAt` | ISO time |
| `durationMs`, `exitCode` | cc's; `null` while running or when the command never ran to an exit |
| `stderr`, `stderrTruncated` | Decoded as UTF-8 (invalid bytes replaced), the **tail** up to `LIMITS.stderrCap` bytes |
| `status` | `running` → `ok` \| `failed` (exit outside the op's accepted codes, `code: GIT_FAILED`) \| `refused` (a cc refusal) \| `timeout` (`GIT_TIMEOUT`) \| `cancelled` (`CANCELLED`) |
| `code` | The refusal code, or `null` |

**Events.** `GET api/activity/events` sends `event: activity` with the entry as `data` (JSON) when an entry opens and when it closes, and a `: ping` comment every `HEARTBEAT_MS` (`src/routes/activity.js`). Treat events as signals: the UI refetches `api/activity` on each.

The log keeps the newest `LIMITS.activityRing` entries in memory. It is diagnostic: nothing derives repo state from it.

## Refusal codes

Source: `HTTP_STATUS` in `src/refusals.js`.

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed JSON or another client error from the body parser |
| `BAD_TARGET` | 400 | `target` malformed or carrying another key |
| `BAD_PARAMS` | 400 | Body or op params malformed |
| `BAD_REF` | 400 | A ref name or revision refused (`assertRefName`, `assertRev`) |
| `BAD_PATH` | 400 | A path refused (`assertPath`, `assertSubpath`) |
| `PROJECT_UNKNOWN`, `WORKTREE_UNKNOWN` | 404 | cc does not know the project / worktree |
| `UNKNOWN_OP` | 404 | No such op |
| `ACTIVITY_UNKNOWN` | 404 | No such activity entry |
| `NOT_FOUND` | 404 | No such API route |
| `NOT_A_REPO` | 409 | The checkout is not a git repository |
| `NOT_CANCELLABLE` | 409 | The entry's op does not allow cancel |
| `NOT_RUNNING` | 409 | The entry already finished |
| `CANCELLED` | 409 | The op was cancelled |
| `BODY_TOO_LARGE` | 413 | Request body over 1 MB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | A state-changing request that is not JSON |
| `GIT_FAILED` | 422 | git exited with a code the op does not accept; `exitCode`, `stderr` |
| `OUTPUT_TOO_LARGE` | 422 | Output passed the op's cap; the command was killed; `limitBytes` |
| `INTERNAL` | 500 | A code-git bug (logged) |
| `SYSTEM_UNREACHABLE` | 502 | The project's System cannot be asked; `detail` = cc's code |
| `GIT_UNAVAILABLE` | 502 | git could not start on the System; `errno` |
| `CONDUCTOR_UNAVAILABLE` | 503 | No `CONDUCTOR_URL`, cc did not answer, or answered without a usable body |
| `GIT_TIMEOUT` | 504 | The command passed its deadline and was killed; partial `stderr` |

## UI routes

The document stays at the plugin root; the active tab is in the query string, never the hash.

| Query | Meaning |
|---|---|
| (none) | No URL-named tab: the persisted tabs only |
| `?project=<name>` | The project's main checkout |
| `?project=<name>&worktree=<name>` | That worktree |

## cc routes consumed

Base: `$CONDUCTOR_URL`, read per call. Unset → `CONDUCTOR_UNAVAILABLE` on every API route; `/health` and the UI stay up.

| Route | Use | Deadline / retry |
|---|---|---|
| `GET /api/projects` | `api/repos` | `LIMITS.ccReadTimeoutMs`; connection failures retried |
| `GET /api/projects/:name/worktrees` | `api/repos/:project/worktrees` | same |
| `POST /api/exec` | every git command | `timeoutMs + min(10 s, timeoutMs)`, past cc's own deadline so cc reports the timeout; connection failures retried for reads only |

**Exec request** (form A only; `exec` in `src/conductor/exec.js`):

```
{project, worktree?, argv: ['git', …], env, stdinB64?, encoding: 'base64', timeoutMs, maxOutputBytes}
```

- `worktree` is omitted for the main checkout (cc refuses unknown keys, and `null` is not sent).
- Never `system`, `remoteId`, `cwd` or `shell`: the System is always the project's own.
- `timeoutMs` and `maxOutputBytes` default per op kind (`LIMITS` in `src/git/limits.js`), within cc's caps (`CC_EXEC_CAPS`).

**Exec answers → code-git:**

| cc status / code | code-git |
|---|---|
| 200 (any exit code) | the result; the runner then applies the op's accepted exit codes |
| 404 `PROJECT_UNKNOWN` / `WORKTREE_UNKNOWN` | same code (404) |
| 501/502 `SYSTEMS_UNAVAILABLE`, `SYSTEM_NOT_REGISTERED`, `SYSTEM_NO_PROVIDER`, `SYSTEM_NO_REMOTES`, `SYSTEM_UNREACHABLE`, `REMOTE_NOT_FOUND` | `SYSTEM_UNREACHABLE` (502), `detail` = cc's code |
| 504 `EXEC_TIMEOUT` | `GIT_TIMEOUT` (504), partial `stderr` |
| 422 `EXEC_OUTPUT_TOO_LARGE` | `OUTPUT_TOO_LARGE` (422), `limitBytes` |
| 422 `EXEC_SPAWN_FAILED` | `GIT_UNAVAILABLE` (502), `errno` |
| 400 `INVALID_ARGUMENT`, or any other coded answer | `INTERNAL` (500), logged |
| 404 without a code, a non-JSON body, a connection failure or no answer by the deadline | `CONDUCTOR_UNAVAILABLE` (503) |
| (the op was cancelled) | `CANCELLED` (409); cc kills the command when the request is aborted |
