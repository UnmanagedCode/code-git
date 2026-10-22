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

**`Worktree`** (`toWorktree` in `src/routes/repos.js`): `{worktreeName, branch, baseBranch, locked}` — cc's worktree rows, trimmed. `locked` is `true` when the user locked the worktree in cc (cc's `locked: true`), `false` when cc's row has no `locked`.

## Ops

`POST api/ops/:name` with `{target: {project, worktree?}, params?}`. No route accepts argv or git options: an op builds its argv from typed params.

| Check (in order) | Refusal |
|---|---|
| Body is an object with only `target` and `params` | 400 `BAD_PARAMS` |
| `target` is `{project, worktree?}` and nothing else; names non-empty, ≤ 200 chars, not `.` or `..`, no NUL or `/` (`assertTarget`) | 400 `BAD_TARGET` |
| `:name` is a registered op | 404 `UNKNOWN_OP` |
| The op's own `params` check | 400 `BAD_PARAMS`, `BAD_REF`, `BAD_PATH` |
| Running it | the op's refusals, plus the exec refusals below |

**Cancel and disconnect.** An op is `cancellable` when its definition says so; the default is `true` for `kind: 'read'` and `false` for `kind: 'write'`. A cancellable op is aborted by `POST api/activity/:id/cancel` on the entry of its **currently running** command (an entry of one of its already-finished commands answers 409 `NOT_RUNNING`), after which the op's request answers 409 `CANCELLED`; or by its HTTP client going away, in which case nobody receives an answer and the outcome is only in the activity log (the entry ends `cancelled`). A non-cancellable op is aborted by neither: it runs to completion and its outcome lands in the activity log.

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

### Diff sources

Every diff op takes a `source` (`parseSource`, `resolveSource` and `pairArgs` in `src/git/diff/source.js`). A source resolves to a **pair** of pinned sides: `{old: Side, new: Side}`, `Side` = `{type: 'tree', oid}` | `{type: 'index'}` | `{type: 'worktree'}`.

| `source` | Old side → new side | Notes |
|---|---|---|
| `{kind: 'commit', rev, parent?}` | the commit's parent `parent` → the commit | `parent` 1-based, default 1 (a merge's first parent); a root commit diffs against the empty tree; `parent` past the commit's parents → `BAD_PARAMS` |
| `{kind: 'unstaged'}` | index → worktree | the file list adds untracked files (`status: '?'`) |
| `{kind: 'staged'}` | HEAD → index | an unborn HEAD → the empty tree |
| `{kind: 'compare', from, to, mode}` | `..`: `from` → `to`; `...`: merge base → `to` | no merge base → `NO_MERGE_BASE` |
| `{kind: 'worktree', rev}` | `rev` → worktree | tracked files only (staged + unstaged) |
| `{kind: 'commits', oids, wip?}` | see the multi-select rule | full oids, 1…`DIFF_LIMITS.maxCommits`, unique |
| `{kind: 'pair', old, new}` | as given | allowed: tree→tree, tree→index, tree→worktree, index→worktree; a tree side's `oid` is a full oid |

- **Validation** (`parseSource`): an unknown kind or key, or a malformed field → `BAD_PARAMS`. `rev`, `from`, `to` pass `assertCommitish`: `assertRev`, plus no leading `^` and no `..` (ranges are built by code-git) → `BAD_REF`.
- **A typed revision** resolves with `rev-parse --verify --quiet --end-of-options <rev>^{commit}`; no commit → 404 `REV_UNKNOWN`. `commits` oids are checked in one `cat-file --batch-check`; a non-commit → `REV_UNKNOWN`.
- **Multi-select rule** (`commits`), GitKraken's:

| Selection | Diff |
|---|---|
| A contiguous first-parent run (one tip; `rev-list --first-parent` from it yields exactly the selection) | combined: oldest's first parent (empty tree for a root) → newest |
| Exactly 2 commits, not contiguous | direct: older → newer (the ancestor, or by commit date when diverged) |
| 3 or more, not contiguous | 409 `DIFF_NOT_CONTIGUOUS` |
| `wip: true` | allowed only on a contiguous run whose newest is HEAD; the new side is then the worktree. Otherwise `DIFF_NOT_CONTIGUOUS` |

**`Resolved`** (in `diff.files`' result): `{pair, commit: {oid, parents} | null, mergeBase: string | null, series: {oids /* newest first */, direct, wip, merges} | null}`. `commit` is set for `kind: 'commit'`; `mergeBase` for `...`; `series` for `commits` (`merges`: a commit of the run is a merge). The UI sends `{kind: 'pair', ...pair}` for every later `diff.file`, so the files it lists and the hunks it shows come from the same commits.

**Every diff command** carries `DIFF_CONFIG` (`-c diff.suppressBlankEmpty=false`, before the subcommand) and `DIFF_FLAGS` (`--no-color --no-ext-diff --no-textconv --no-relative -M --src-prefix=a/ --dst-prefix=b/ --inter-hunk-context=0 --submodule=short`), both in `src/git/diff/source.js`. `whitespace` (`none` default, `eol`, `change`, `all`) adds `WHITESPACE_FLAGS[whitespace]`.

### `diff.files` (read, cancellable)

- `params`: `{source, whitespace?}`.
- Runs `git diff … --raw --numstat -z --no-abbrev <pair> --`, capped at `DIFF_LIMITS.listMaxOutputBytes` (`src/git/diff/limits.js`); for an index → worktree pair also `git ls-files --others --exclude-standard -z`.
- `result`: `Resolved` + `files: DiffFile[]`, in git's order, untracked files last:

| `DiffFile` field | Meaning |
|---|---|
| `path`, `oldPath` | `oldPath` only for a rename/copy |
| `status` | `A` `M` `D` `R` `C` `T` `U` (unmerged: listed once, as `U`), `?` (untracked) |
| `similarity` | rename/copy score, else `null` |
| `added`, `deleted` | numstat counts; `null` for binary and untracked files |
| `binary` | numstat `-\t-` |
| `submodule` | either side's mode is `160000` (a gitlink) |
| `oversized` | `added + deleted > DIFF_LIMITS.oversizeLines`: the UI asks before loading it |
| `oldMode`, `newMode`, `oldOid`, `newOid` | from the raw record; `null` for an absent side (a worktree side has no oid) |

- Over the cap: 422 `OUTPUT_TOO_LARGE` with `limitBytes` — never a partial or empty list.

### `diff.file` (read, cancellable)

- `params`: `{source, path, oldPath?, untracked?, context?, whitespace?}`. `context`: 0…1000 or `'full'` (the whole file), default 3. Paths pass `assertPath`. `untracked: true` only for an index → worktree pair (`BAD_PARAMS` otherwise) and never with `oldPath`.
- Runs `git diff … -U<context> <pair> -- [oldPath] path`, capped at `DIFF_LIMITS.fileMaxOutputBytes`; over it: 422 `OUTPUT_TOO_LARGE` with `limitBytes`.
- Untracked, three steps, each refusal 400 `BAD_PATH`:
  1. `git ls-files --others --exclude-standard -z -- path` must list exactly `path` (git lists no path through a symlinked directory).
  2. A stat-only probe, `git diff --no-index --raw -z … -- /dev/null path`, must name exactly one entry, `path` itself. A symlink to a directory fails it: `--no-index` would diff `path/null`, a file outside the repo. The probe reads no content (its oids are zeros).
  3. `git diff --no-index … -- /dev/null path` (exit 0 or 1).
- An untracked symlink to a file shows as mode `120000` with one added line, its target path; the target's content is never read. A symlink to a directory is refused.
- `result` = `FileDiff`, the model per-hunk/line staging builds on:

```
FileDiff { path, oldPath, binary, unmerged, oldMode, newMode,
           lfs: {old: LfsPointer|null, new: LfsPointer|null} | null,
           submodule: {old: oid|null, new: oid|null, dirty: boolean} | null,
           hunks: Hunk[] }
Hunk     { header /* "@@ -a,b +c,d @@ section", unique per file: the hunk's id */, oldStart, oldLines, newStart, newLines, lines: DiffLine[] }
DiffLine { kind: 'context'|'add'|'del', text /* exact, no newline */, oldNo, newNo, noNewline }
LfsPointer { oid /* sha256 hex */, size }
```

| Field | Rule |
|---|---|
| A line's address | `(hunk index, line index)`; a hunk's id is its `header` |
| `unmerged` | git emitted `diff --cc`; `hunks` is empty |
| `submodule` | a gitlink: the `Subproject commit <oid>[-dirty]` lines; `hunks` is empty |
| `lfs` | a side whose single hunk starts at line 1 and is a Git LFS spec-v1 pointer; null for binary and gitlinks |
| `noNewline` | git printed `\ No newline at end of file` after the line |

- A caller that rebuilds a patch from `FileDiff` (staging a hunk or line) must request `whitespace: 'none'`: with whitespace ignored the hunks are not the file's real changes.

### `diff.patch` (read, cancellable)

- `params`: `{source, paths?}`; `paths` 1…`DIFF_LIMITS.maxPaths`, each `assertPath`.
- **Mailbox** (`git am`-able) for one non-merge commit, or a merge-free contiguous `series` without `wip`: `git format-patch --stdout FORMAT_PATCH_FLAGS DIFF_FLAGS --end-of-options <base>..<tip> -- [paths]` (`--root <tip>` from a root commit). `FORMAT_PATCH_FLAGS` (`src/git/diff/source.js`) switches off every `format.*` key that adds a signature, headers, recipients, a cover letter, numbering, threading, a base, a From override, attachments, notes or a sign-off.
- **Plain** (`git apply`-able) otherwise: `git diff --binary DIFF_FLAGS <pair> -- [paths]`. Binary changes are included; untracked files are not.
- Capped at `DIFF_LIMITS.patchMaxOutputBytes`.
- `result`: `{filename, base64, bytes}` — the bytes base64-encoded, so the download is byte-exact.

| Source | `filename` |
|---|---|
| a commit | `<oid7>.patch` |
| tree → tree (a run, a direct compare, two refs) | `<old7>..<new7>.patch` |
| index → worktree / tree → index / tree → worktree | `<project>-unstaged.patch` / `-staged` / `-worktree`; the project name reduced to `[A-Za-z0-9._-]` (others → `_`), at most 80 characters |

### Paging convention (for ops that list)

The diff is paged one file at a time: `diff.files` lists every file with one command (refused past its cap, never clipped), and `diff.file` fetches one file's hunks. An op that pages by cursor returns `{items, nextCursor}` (`nextCursor: null` on the last page) and pages **by git arguments**, never by slicing output (cc's exec is buffered): log by `--max-count` from a cursor commit, diffs by a `--numstat` summary then one path at a time, blame by `-L a,b`, blobs by `cat-file -s` before reading.

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
| `REV_UNKNOWN` | 404 | A revision does not name a commit |
| `NOT_A_REPO` | 409 | The checkout is not a git repository |
| `NOT_CANCELLABLE` | 409 | The entry's op does not allow cancel |
| `NOT_RUNNING` | 409 | The entry already finished |
| `CANCELLED` | 409 | The op was cancelled |
| `NO_MERGE_BASE` | 409 | `A...B` has no common ancestor |
| `DIFF_NOT_CONTIGUOUS` | 409 | A multi-selection the multi-select rule cannot diff |
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

Base: `$CONDUCTOR_URL`, read per call. Unset → 503 `CONDUCTOR_UNAVAILABLE` on the routes that reach cc: `api/repos`, `api/repos/:project/worktrees` and `api/ops/:name` (after its own request checks). The activity routes (`api/activity`, `api/activity/events`, `api/activity/:id/cancel`) keep working, an unknown `api/` path is still a 404 `NOT_FOUND`, and `/health` and the UI stay up.

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
