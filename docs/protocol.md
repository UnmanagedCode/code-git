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
- First `git rev-parse --git-dir`: exactly `.` (the git dir is the working tree; nothing is parsed, so a path holding a newline cannot fool it) → 409 `BARE_REPO`, before `status` runs. Under `BASE_ARGS`' `--work-tree=.` a bare repository's status would succeed, walking its own files as untracked. The repository's `core.bare` is never consulted: true, false (set directly or through an `[include]`) or unset, a bare repository is refused. A normal repo (`.git`), a linked worktree — of a normal or a bare repo — and a `--separate-git-dir` clone have their git dir elsewhere. Outside a repository this command exits 128 → `NOT_A_REPO` as above.

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
- **A typed revision** resolves with `rev-parse --verify --quiet --end-of-options <rev>^{commit}`; no commit (exit 1, or exit 128 with no message, such as `HEAD@{999}` past the reflog) → 404 `REV_UNKNOWN`. Exit 128 with a message (bad config, not a repository) stays 422 `GIT_FAILED` with git's `stderr`. `commits` oids are checked in one `cat-file --batch-check`; a non-commit → `REV_UNKNOWN`.
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
  2. A raw probe, `git diff --no-index --raw -z … -- /dev/null path`, must name exactly one entry, `path` itself. A symlink to a directory fails it: `--no-index` would diff `path/null`, a file outside the repo. The probe is stat-only for regular files (its oids are zeros, no content is returned); a special file at `path/null` (a FIFO) is opened and can block until the read timeout, still returning no data.
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

- `params`: `{source, paths?}`; `paths` 1…`DIFF_LIMITS.maxPaths`, each `assertPath`. Git pairs a rename or copy only when **both** its paths are in `paths`; with the new path alone the patch adds it and never deletes the old one (the UI sends both: `patchPaths` in `features/diff/patch.ts`).
- **Mailbox** (`git am`-able) for one non-merge commit, or a merge-free contiguous `series` without `wip`: `git format-patch --stdout FORMAT_PATCH_FLAGS DIFF_FLAGS --end-of-options <base>..<tip> -- [paths]` (`--root <tip>` from a root commit). `FORMAT_PATCH_FLAGS` (`src/git/diff/source.js`) switches off every `format.*` key that adds a signature, headers, recipients, a cover letter, numbering, threading, a base, a From override, attachments, notes or a sign-off.
- **Plain** (`git apply`-able) otherwise: `git diff --binary DIFF_FLAGS <pair> -- [paths]`. Binary changes are included; untracked files are not.
- Capped at `DIFF_LIMITS.patchMaxOutputBytes`.
- `result`: `{filename, base64, bytes}` — the bytes base64-encoded, so the download is byte-exact.

| Source | `filename` |
|---|---|
| a commit | `<oid7>.patch` |
| tree → tree (a run, a direct compare, two refs) | `<old7>..<new7>.patch` |
| index → worktree / tree → index / tree → worktree | `<project>-unstaged.patch` / `-staged` / `-worktree`; the project name reduced to `[A-Za-z0-9._-]` (others → `_`), at most 80 characters |

### Graph ops (`src/git/ops/graph.js`; all reads, cancellable)

Every log-family command adds `--no-show-signature --no-ext-diff --no-textconv`. Constants at the top of `src/git/ops/graph.js`: `PAGE_MAX`, `TIPS_MAX`, `SEARCH_MAX`, `STATS_MAX`, `QUERY_MAX`. An **oid** param is 40 or 64 lowercase hex (`assertOid`, else `BAD_REF`); an oid list is deduplicated and sorted, and goes to git on **stdin**, never argv. Unknown param keys are `BAD_PARAMS`. Behaviour and git version floors: [graph](graph.md).

| Op | `params` | Runs (after `git` + `BASE_ARGS`) | `result` |
|---|---|---|---|
| `graph.refs` | none (as `repo.summary`) | `for-each-ref` (refs/heads, refs/remotes, refs/tags); `remote`; `rev-parse --verify -q HEAD`; `symbolic-ref -q HEAD`; `worktree list --porcelain -z`; `stash list` — in parallel | `{head, refs: Ref[], stashes: Stash[], worktrees: GitWorktree[] \| null, worktreesError: string \| null}` |
| `graph.page` | `{tips: oid[] (0..TIPS_MAX), skip: int ≥ 0, limit: 1..PAGE_MAX}` | `log --stdin --topo-order --format=… --skip=<skip> --max-count=<limit+1>` | `{items: CommitItem[], nextCursor: number \| null}` |
| `graph.stats` | `{oids: oid[] (1..STATS_MAX)}` | `log --no-walk=unsorted --stdin --root --format=%x00%H%x00%P --shortstat` | `{stats: {[oid]: {files, insertions, deletions} \| null}}` |
| `graph.search` | `{mode: 'commits' \| 'path', query: string, tips: oid[] (0..TIPS_MAX)}` | below | `{matches: oid[], truncated: boolean}` |
| `graph.commit` | `{oid}` | `log -1 --no-walk --format=… <oid>`, then `diff-tree -r -z --no-commit-id --name-status -M --root --no-ext-diff --no-textconv [<first parent>] <oid>` (full-hex oids need no `--end-of-options`) | `CommitDetail` |

- **Empty `tips`** (`graph.page`, `graph.search`): an empty result, no command run.
- `head`: `{oid: string|null, branch: full refname|null, detached, unborn}` (`branch` is `refs/heads/…`, unlike `repo.summary`'s short name).
- **`Ref`**: `{name: full refname, kind: 'local'|'remote'|'tag', short, remote: string|null, oid: string|null, isHead}`. `oid` is the commit the ref names; an annotated tag is peeled (`%(*objectname)`); `null` when it does not reach a commit (a tag of a tree; a tag of a tag on a git that peels one level only). `remote` is the longest `git remote` name prefixing the path after `refs/remotes/` (remote names may hold `/`), else its first segment. `refs/remotes/*/HEAD` symrefs are skipped.
- **`Stash`**: `{oid, parents: oid[], selector: 'stash@{n}', time: unix s, subject}`, newest first.
- **`GitWorktree`**: `{path, head: oid|null, branch: full refname|null, detached, bare, locked}`, as git lists them (main first).
- **`worktree list -z` failing** (git < 2.36): `worktrees: null`, `worktreesError` = its stderr; its activity entry is `failed`. Any other command failing fails the op.
- **`CommitItem`**: `{oid, parents: oid[], author: {name, email}, time: author unix s, subject}`.
- **`graph.page` cursor**: `nextCursor = skip + limit` when git returned `limit + 1` rows, else `null`.
- **`graph.stats`**: `null` = a merge (no stat); a non-merge with no stat line is `{files: 0, insertions: 0, deletions: 0}`.
- **`graph.search`**: `query` is 1..`QUERY_MAX` characters with no control character (`BAD_PARAMS`).
  - `commits`: the union of `log --stdin --topo-order --format=%H -i -F --grep=<query>`, the same with `--author=<query>` (git ANDs the two, so they run apart), and — when the query matches `/^[0-9a-f]{4,64}$/i` — `rev-parse --disambiguate=<lowercased>` (exit 0 or 128) filtered to commits by `cat-file --batch-check`. The query is always inside one `--grep=`/`--author=` element, so an option-shaped query is a pattern; `-F` makes it a fixed string.
  - `path`: `assertPath(query)` (`BAD_PATH`), then `log --stdin --topo-order --format=%H -- <query>`; `GIT_LITERAL_PATHSPECS=1` keeps it literal.
  - Each log asks for `SEARCH_MAX + 1`; `matches` holds at most `SEARCH_MAX`, and `truncated` is true when any command or the union passed it. A sha match may be unreachable from the tips.
- **`CommitDetail`** (`graph.commit`): `{oid, parents, author: {name, email, time}, committer: {name, email, time}, subject, body, coAuthors: [{name, email}], signature: {status, signer|null, key|null}, files: [{status, path, oldPath|null}] | null, filesError: {code, message, limitBytes?} | null}`.
  - `signature.status` is git's `%G?` letter (`N` = unsigned). `%G?` runs the repo's signing program for this one commit; no other graph op asks for it.
  - `coAuthors` come from `Co-authored-by:` trailers; a value that is not `Name <email>` is dropped.
  - `files`: a merge against its first parent, a root commit against the empty tree; `status` is the first letter of git's (`A`, `M`, `D`, `R`, `C`, `T`, …); a rename/copy carries `oldPath`.
  - The two commands are separate: when the file list fails (e.g. 422 `OUTPUT_TOO_LARGE` on a huge commit), `files` is `null` and `filesError` says why, and the metadata is still returned. A cancel cancels the op; a failing metadata command fails it.
### Staging ops: shared rules

The ops below change the index or the worktree (`kind: 'write'`, not cancellable). Their caps are `STAGE_LIMITS` (`src/git/stage/limits.js`).

- Every path passes `assertPath`. A list holds 1…`STAGE_LIMITS.maxPaths` paths; duplicates are dropped.
- **Multi-path commands read their paths from stdin**: `--pathspec-from-file=- --pathspec-file-nul` (`add`, `reset`, `restore`, `rm`), so the argv never grows with the request.
- **`ls-files` and `clean` have no `--pathspec-from-file`**: their paths go after `--`, in chunks of at most `STAGE_LIMITS.argvChunkBytes` argv bytes, one command per chunk.
- `GIT_LITERAL_PATHSPECS=1` applies to both forms: a path named `*.txt` matches only itself.
- A rename or copy is two paths: the UI sends both (`patchPaths`, `features/diff/patch.ts`).

### `stage.files` (write)

- `params`: `{paths}` or `{all: true}`, exactly one (else `BAD_PARAMS`).
- Runs `git add -A --pathspec-from-file=- --pathspec-file-nul` (paths on stdin), or `git add -A`.
- Accepts every unstaged status: `M`, `D`, `T`, `?`, `U`. Staging a `U` path marks it resolved.
- `result`: `{paths}` (`null` for all).

### `stage.unstageFiles` (write)

- `params`: `{paths}` or `{all: true}`.
- HEAD born (`rev-parse --verify --quiet HEAD^{commit}`): `git reset -q --pathspec-from-file=- --pathspec-file-nul`, or `git reset -q`.
- HEAD unborn: `git rm --cached -r -q --ignore-unmatch --pathspec-from-file=- --pathspec-file-nul`, or `git rm --cached -r -q --ignore-unmatch -- .`. The files stay on disk, untracked.
- `result`: `{paths}` (`null` for all).

### `stage.discardFiles` (write)

- `params`: `{tracked?: paths, untracked?: paths}`; at least one path in total, at most `STAGE_LIMITS.maxPaths`.
- Both gates run before anything changes, so a refused request discards nothing:

| Gate | Command (per chunk) | Refusal |
|---|---|---|
| Each tracked path names one file: no trailing `/`, no empty or `.` segment (`filePath`, at params) | — | 400 `BAD_PATH` |
| Each tracked path is a file in the index (not a directory, not `.`) | `git ls-files -c -z -- <tracked>` lists every one | 400 `BAD_PATH` |
| No tracked path is unmerged | `git ls-files -u -z -- <tracked>` prints nothing | 409 `CONFLICTED` |
| Nothing untracked or ignored lies under a tracked path (a tracked file now a directory on disk: restoring it would delete the directory's contents) | `git ls-files --others -z -- <tracked>` prints nothing | 409 `UNTRACKED_UNDER_PATH`, `paths` = the first 100 found |
| No untracked path ends in `/` (a nested repository) | — | 400 `BAD_PATH` |
| git lists exactly the requested untracked set | `git ls-files --others --exclude-standard -z -- <untracked>` | 400 `BAD_PATH` (an ignored, tracked, missing path, a directory, a path through a symlinked directory) |

- Then `git restore --worktree --pathspec-from-file=- --pathspec-file-nul` for the tracked paths (from the index: staged changes stay), and `git clean -f -q -- <untracked chunk>` per chunk. Never `-d`, never `-x`.
- "Discard all" in the UI is this op called with the unstaged and untracked lists the panel showed: a file created after that is never touched.
- `result`: `{tracked, untracked}` — what was discarded. Neither is recoverable from git (see architecture → What each destructive op destroys).

### Stage selection: `stage.stageLines`, `stage.unstageLines`, `stage.discardLines` (write)

Stage, unstage or discard a selection of one file's hunks and lines. One implementation (`applySelection` in `src/git/ops/stage.js`; the pure builder is `buildSelectionPatch` in `src/git/stage/selection.js`).

- `params`: `{path, context?, hunks: [{header, lines: [{index, text}]}]}`.
  - `context`: 0…1000 or `'full'` (default 3) — the context the diff was shown with.
  - At least one hunk; each hunk at least one line; headers unique, line indices unique integers ≥ 0 within a hunk.
  - `header` (≤ 4096 characters, starts `@@ `) is `Hunk.header` as `diff.file` returned it; `index` is the line's index in `Hunk.lines`; `text` is that line's `DiffLine.text`.
  - Whole hunk = every add/del line of that hunk (the UI fills them in).

| Op | Re-reads (whitespace never ignored; `DIFF_CONFIG`, `DIFF_FLAGS`, `-U<context>`) | Builds | Applies |
|---|---|---|---|
| `stage.stageLines` | index → worktree: `git diff … -- path` | forward | `git apply --cached` |
| `stage.unstageLines` | HEAD → index: `git diff … --cached --end-of-options <HEAD oid> -- path` | reverse | `git apply --cached -R` |
| `stage.discardLines` | index → worktree | reverse | `git apply -R` (worktree only) |

Every apply adds `--whitespace=nowarn --no-ignore-whitespace` (overriding `apply.whitespace` and `apply.ignoreWhitespace`) and reads the patch from stdin. **Never `--unidiff-zero`**: the patch is built from a second re-read at `max(context, APPLY_MIN_CONTEXT)` (`src/git/ops/stage.js`; `'full'` stays full), because `git apply --unidiff-zero` matches a context-free hunk at the wrong occurrence — on a file without a final newline it exits 0 having changed other lines, even with git's own `-U0` patch. With context, git checks it, and a hunk without leading or trailing context must sit at the file's start or end.

**Steps:**

1. Re-run the diff at the request's `context` and decode it as **latin1** (one character per byte), then parse it with `parseFilePatch`. A request's `header` and `text` are compared with the fresh diff's bytes decoded as UTF-8 (invalid bytes replaced) — what the UI was shown. When `context` is under `APPLY_MIN_CONTEXT`, re-run it at that context too: each selected line is found there by kind, line number on its side and text (git's edit script is the same at every `-U`; only the hunk grouping changes), and steps 2–5 build from that read. A line not found → `STALE_DIFF`.
2. **409 `PARTIAL_UNSUPPORTED`** when the file header has `new file mode`, `deleted file mode`, `rename from`, `copy from`, `diff --cc` / `diff --combined`, `Binary files` / `GIT binary patch`, or a `160000` mode; when there are no hunks (an empty diff, a mode-only change); and for `unstageLines` on an unborn HEAD. A single path never pairs as a rename, so a staged rename reads as a new file. The UI offers hunk/line actions only for `M` files.
3. **409 `STALE_DIFF`** when a requested header is not in the fresh diff, an index is out of range or names a context line, or a line's text differs.
4. **Build** (only requested hunks are emitted):

| Line | forward (stage) | reverse (unstage, discard) |
|---|---|---|
| context | context | context |
| selected `-` / `+` | kept | kept |
| unselected `-` | context | dropped |
| unselected `+` | dropped | context |

   - **Within a change block** (a run of `-`/`+` lines) the i-th removed line pairs with the i-th added line, as the split view shows them, and each pair is emitted removed-then-added. Staging `c → C` out of `-c -d +C +D` gives `C d`.
   - **Header:** git's own `diff --git`, `---` and `+++` lines, verbatim (git's path quoting); the `index` and `old mode`/`new mode` lines are dropped, so a mode change is never applied as a side effect.
   - **Counts:** the side the patch applies to (old for forward, new for reverse) keeps git's start and count. The other side's count is recomputed; its start = `before + 1`, or `before` when its count is 0, where `before` = the fixed side's lines before the hunk (`start − 1`, or `start` for an empty side) plus the growth of the hunks already emitted.
   - Emitted as `@@ -a,b +c,d @@`, without git's section text.
5. **No newline at end of file:** a line keeps its `\ No newline at end of file` marker on every side it is on (context = both). It must still be the last line of each of those sides in the hunk, else **409 `SELECTION_UNSUPPORTED`** ("include the end-of-file newline change"): e.g. staging `+c` without `-b` when both lack a final newline.
6. `git apply` checks the context. A change between the re-read and the apply fails the apply: 422 `GIT_FAILED` with git's stderr ("patch does not apply"), nothing written. Each command takes the project lock; the op as a whole is not atomic.

- `result`: `{path}`; `discardLines` also returns `{patchB64}`, the exact patch applied with `-R`. Applying it forward (`git apply`) restores the discarded lines.

### `commit.create` (write)

- `params`: `{summary, description?, amend?, messageOnly?, noVerify?}`.
  - `summary`: non-empty after trimming, one line (no `\n`/`\r`). Neither field may contain NUL. → `BAD_PARAMS`.
  - `messageOnly` needs `amend` (`BAD_PARAMS`). Booleans default to `false`.
- Message: `joinMessage` (`src/git/commit/message.js`) — `summary.trim()`, then a blank line and the description with trailing whitespace trimmed (when non-empty), then `\n`. Sent on stdin.
- Checks: `amend` with an unborn HEAD → 409 `NO_HEAD`. Without `amend`: `git diff --cached --quiet --no-ext-diff --no-textconv --ignore-submodules=none` exits 0 (nothing staged) **and** `git rev-parse -q --verify MERGE_HEAD` exits 1 (no merge in progress) → 409 `NOTHING_TO_COMMIT`. A merge with nothing staged commits.
- Runs `git commit [--amend [--only]] [--no-verify] -F -`. No `--cleanup`: the repo's `commit.cleanup` applies; git's default for `-F` is `whitespace`, which keeps `#` lines.

| Mode | Flags | Effect |
|---|---|---|
| commit | — | Staged changes; on a detached HEAD, HEAD moves and no branch does |
| amend | `--amend` | Replaces HEAD with the staged changes + the message; a root commit stays parentless |
| message-only amend | `--amend --only` (no paths) | Replaces HEAD's message; the tree is HEAD's, staged changes stay staged |
| skip hooks | `--no-verify` | No `pre-commit` / `commit-msg` hooks |

- A hook or signing failure → 422 `GIT_FAILED` with git's `stderr` (the hook's output).
- `result`: `{oid}`, HEAD after the commit (`rev-parse --verify --quiet HEAD^{commit}`).

### `commit.state` (read, cancellable)

- `params`: none. Runs `git rev-parse -q --verify MERGE_HEAD`.
- `result`: `{merging}` — a merge is being concluded, so a commit is valid with nothing staged (the commit box enables its button on it).

### `commit.headMessage` (read, cancellable)

- `params`: none. Unborn HEAD → 409 `NO_HEAD`.
- Runs `git log -1 --no-show-signature --format=%B --end-of-options <HEAD oid>`.
- `result`: `{oid, summary, description}` (`splitMessage`: the first non-blank line, then the rest minus one leading blank line, trailing whitespace trimmed).

### `commit.template` (read, cancellable)

- `params`: none.
- `git config --path --get commit.template` (`~/` expanded). Unset → `{path: null, draft: null, problem: null}`.
- Reads the file with `readNoIndex` (`git diff --no-index /dev/null <path>`). A relative template path resolves against the repo toplevel (`git rev-parse --show-toplevel`); a symlink is followed by hand, each relative target against its link's directory, for up to `STAGE_LIMITS.templateMaxLinks` hops.
- Comment prefix: `core.commentString`, else `core.commentChar`; `auto` or unset → `#`. Lines starting with it are dropped, then `splitMessage`.
- `result`: `{path, draft: {summary, description} | null, problem: string | null}`. A missing, binary, non-file, over-`STAGE_LIMITS.templateMaxBytes` template or a link chain past the hop limit is a `problem`, never a refusal.

### `ignore.add` (write)

- `params`: `{kind: 'path' | 'ext' | 'dir', value, stopTracking?}`.
- Target: the **root `.gitignore`** (shared with the team). `.git/info/exclude` is not offered: `git apply` refuses `.git/` paths and code-git runs only git.
- Pattern, built only by `ignorePattern` (`src/git/ignore/pattern.js`):

| `kind` | Pattern | Matches |
|---|---|---|
| `path` | `/<path>` | that file |
| `dir` | `/<dir>/` (a trailing `/` in `value` is dropped first) | that directory |
| `ext` | `*.<ext>` (non-empty, no `/`, no leading `.`, else `BAD_PARAMS`) | such files at any depth |

  `\`, `*`, `?`, `[` and each trailing space are escaped with `\`; the `/` or `*.` prefix means a pattern never starts with `#` or `!`. A control character → `BAD_PATH`; `path` / `dir` also pass `assertPath` and refuse an empty or `.` segment (`BAD_PATH`): never `.`, the whole repository.
- Reads `.gitignore` with `readNoIndex`. A symlink, binary, directory, or a file over `STAGE_LIMITS.gitignoreMaxBytes` → 409 `GITIGNORE_UNSUPPORTED`.
- A line already equal to the pattern (a trailing `\r` ignored) → nothing is written (`added: false`).
- Else `git apply --whitespace=nowarn --no-ignore-whitespace -` (worktree, unstaged) of one hunk with the **whole file as context**: a concurrent edit makes the apply fail (422 `GIT_FAILED`) instead of being overwritten.
  - Absent → `new file mode 100644`, `--- /dev/null`.
  - Empty → `@@ -0,0 +1,1 @@` with `--unidiff-zero`.
  - No final newline → the last line is re-emitted with one (`-last`, `\ No newline at end of file`, `+last`).
  - A file whose last terminated line ends in CR gets `\r\n` on the new lines (the last line decides, not the first: `"\na\r\n"` gets CRLF).
- `stopTracking: true` (the UI confirms it): first `git ls-files -z -c -- <value>` (`path`, `dir`) or `git ls-files -z -c -i --exclude=<pattern>` (`ext`: this pattern only, never `--exclude-standard`) — a `path` that lists anything but itself is a folder → 400 `BAD_PATH` before anything is written — then, after `.gitignore`, `git rm --cached -q --pathspec-from-file=- --pathspec-file-nul` of that list. The files stay on disk. `.gitignore` is written first; a failing `rm` is 422 `GIT_FAILED` with `step: 'stopTracking'` and a message saying `.gitignore` was already changed.
- `result`: `{pattern, added, untracked: paths removed from the index}`.

### `files.restore` (write)

- `params`: `{oid /* full commit id, OID_RE */, path}`; `path` names one file (`filePath`: no trailing `/`, no empty or `.` segment → `BAD_PATH`).
- `git cat-file -t <oid>` must print `commit` (else 404 `REV_UNKNOWN`); `git cat-file -t <oid>:<path>` must print `blob` (else 404 `PATH_NOT_IN_COMMIT`: absent, a directory, a gitlink).
- `git ls-files --others -z -- <path>` must print nothing (a tracked file now a directory holding untracked or ignored files) → 409 `UNTRACKED_UNDER_PATH`, `paths`.
- Runs `git restore --source=<oid> --staged --worktree -- <path>` (GitKraken's "reset file to this commit"): index and worktree. Through an untracked symlinked directory git replaces the link with a real directory and writes inside the repo.
- `result`: `{oid, path}`.

### `patch.check` (read, cancellable) and `patch.apply` (write)

- `params`: `{patchB64, apply?: 'worktree' | 'index'}` (default `worktree`). Strict base64, decoded 1…`STAGE_LIMITS.applyPatchMaxBytes` bytes. `apply: 'both'` (`git apply --index`) is refused `BAD_PARAMS`: see the residual risks in architecture.
- `patch.check`: `git apply --check --numstat -z [--cached] --whitespace=nowarn --no-ignore-whitespace -`. `result`: `{files: [{path, added, deleted}]}` (counts `null` for binary; `--numstat -z` names a rename by its new path only).
- `patch.apply`: `git apply [--cached] --whitespace=nowarn --no-ignore-whitespace -`. `result`: `{apply, bytes}`.
- Atomic: no `--reject`, so all of it applies or none. Never `--unsafe-paths`, `--directory`, `-p`, `--include`/`--exclude`, `--3way`, `--index`.
- Exit 1 (does not apply) or 128 (no valid patch in the input; an `..`, absolute or `.git/` path) → 409 `PATCH_DOES_NOT_APPLY` with `exitCode` and `stderr`. Worktree mode also refuses a path beyond a symlink; index mode never writes to disk.
- A mailbox (`format-patch`) works: git skips the mail header.

### Branch, tag and HEAD ops (`src/git/ops/branch.js`, `tag.js`, `head.js`)

Behaviour, the checked-out and cc-owned rules and what each op destroys: [refs](refs.md). Common rules:

- Params are a plain object; an unknown key → `BAD_PARAMS`. A branch or tag **name** is short (`feature/a`) and passes `assertRefName`; `HEAD` and a leading `refs/` → `BAD_REF`. A **full ref** must start with the prefix the op names. An **oid** is full hex (`assertOid`). A name list holds 1…`REF_LIMITS.namesMax` (`src/git/refs/limits.js`) names, duplicates dropped.
- Every check runs before any write. `--end-of-options` precedes every user-named argument.
- `ccOwned: true` acknowledges a `code-conductor/*` branch (the UI's confirmation). Without it: 409 `CC_OWNED_BRANCH` with `branches` (short names), plus `head: true` when the refusal is about moving this checkout's own cc-owned HEAD.
- A branch checked out in a checkout the op may not touch: 409 `BRANCH_CHECKED_OUT` with `worktree` (that checkout's path).
- Local changes git would overwrite: 409 `CHECKOUT_CONFLICT` with `files` and `stderr`.
- The ops that write the working tree or the index first check for a bare repository (`assertWorktree`): 409 `BARE_REPO` from `branch.checkout`, `branch.create` with `checkout`, `head.reset` mixed and hard, `head.revert`, `head.cherryPick`, `head.abort`, and `branch.fastForward` of this checkout's own branch. Soft reset and the other ops change refs only.
- A symbolic ref (`%(symref)` set) as the branch an op checks out, renames, fast-forwards, moves or sets the upstream of — local, or `refs/remotes/<r>/HEAD` and other remote aliases for checkout: 409 `SYMBOLIC_REF` with `target`. `branch.delete` deletes a symbolic ref itself, never its target. A *dangling* symbolic ref (its target missing: `for-each-ref` does not list it) is found by `symbolic-ref -q <ref>` on the exact name: `branch.create` and `tag.create` of that name, `branch.rename` from or to it and `branch.delete` of it refuse `SYMBOLIC_REF` (never `REF_UNKNOWN`), since git would create the target, in any namespace, under the alias's name. Every `update-ref` passes `--no-deref`.
- Every ref-changing op returns `undo`: `UndoRecord` below.

```
UndoRecord      { refs: RefChange[], remoteRefs: RemoteRefChange[],
                  head: {old: {branch: refname|null, oid: oid|null}, new: {branch, oid}} | null,
                  worktreeSnapshot: oid | null }
RefChange       { ref /* refs/heads/… | refs/tags/… */, old: oid|null /* null = created */, new: oid|null /* null = deleted */,
                  upstream?: refname|null /* a deleted branch's upstream */,
                  symref?: refname /* a deleted symbolic ref's target: restore with symbolic-ref; old and new are null */ }
RemoteRefChange { remote, ref /* refs/heads/… | refs/tags/… on the remote */, old: oid|null /* best known */, new: oid|null,
                  tracking?: refname|null /* branch.deleteRemote: the tracking ref here git deleted with it (old is its value) */ }
```

| Op | kind | `params` | Runs (after the reads `for-each-ref refs/heads` with `%(worktreepath)`, `symbolic-ref -q HEAD`, `rev-parse --verify -q HEAD`) | `result` | Refusals |
|---|---|---|---|---|---|
| `branch.tracking` | read | none | `for-each-ref --format=%(refname)%00%(upstream)%00%(upstream:track,nobracket) refs/heads`; `remote` | `{remotes: string[], branches: {[ref]: {upstream: refname\|null, ahead, behind, gone}}}` | — |
| `branch.create` | write | `{name, from?: oid, checkout?: bool, ccOwned?}` | `branch --no-track --end-of-options <name> <oid>`; with `checkout`: `switch --no-guess --no-track -c <name> --end-of-options <oid>`. No `from` = HEAD | `{ref, oid, checkedOut, undo}` | `REF_EXISTS`; `NO_HEAD` (no `from`, unborn HEAD); `REV_UNKNOWN` (`from` not a commit); `CC_OWNED_BRANCH` (`checkout` on a cc-owned HEAD); `CHECKOUT_CONFLICT` |
| `branch.checkout` | write | `{ref: refs/heads/… \| refs/remotes/…, ccOwned?}` | local: `switch --no-guess --end-of-options <name>`. Remote, no local twin: `switch --no-guess --track -c <b> --end-of-options <ref>`; local twin: switch to it, then `merge --ff-only --end-of-options <oid>` when it tracks `ref` and is behind it | `{branch, created, localExisted, fastForwarded, ffBlocked: path[]\|null, undo}` | `REF_UNKNOWN`; `BRANCH_CHECKED_OUT` (elsewhere); `CC_OWNED_BRANCH`; `CHECKOUT_CONFLICT` |
| `branch.rename` | write | `{name, newName, ccOwned?}` | `branch -m --end-of-options <name> <newName>` | `{ref, undo}` | `REF_UNKNOWN`; `REF_EXISTS`; `BRANCH_CHECKED_OUT` (another checkout, or a checked-out cc branch anywhere); `CC_OWNED_BRANCH` (either name) |
| `branch.delete` | write | `{names, force?, ccOwned?}` | `branch -d\|-D --end-of-options <names…>` (exit 0 or 1), then the heads again | `{deleted, notMerged, undo}` | `REF_UNKNOWN`, `BRANCH_CHECKED_OUT` (any checkout, this one included), `CC_OWNED_BRANCH` — for any name, before anything is deleted; `GIT_FAILED` for a name git kept for another reason |
| `branch.deleteRemote` | write, **cancellable** | `{remote, branches: string[] /* names on the remote */, ccOwned?}` | `push --porcelain --end-of-options <remote> :refs/heads/<b>…` | `{deleted, rejected: [{ref, reason}], unrequested, undo}` (`undo.remoteRefs[].old` = the tracking ref before) | `REMOTE_UNKNOWN`; `CC_OWNED_BRANCH`; the push refusals below |
| `branch.setUpstream` | write | `{name, upstream: refs/remotes/… \| null}` | `branch --set-upstream-to=<u> --end-of-options <name>` / `branch --unset-upstream --end-of-options <name>` (skipped when none is set) | `{name, upstream, previous}` | `REF_UNKNOWN` (branch or upstream) |
| `branch.fastForward` | write | `{name, to: oid, expect: oid}` | `merge-base --is-ancestor <expect> <to>`; this checkout's branch: `merge --ff-only --end-of-options <to>`; else `update-ref -m "code-git: fast-forward" refs/heads/<name> <to> <expect>` | `{upToDate, undo}` | `REF_UNKNOWN`; `REF_MOVED` (not at `expect`); `BRANCH_CHECKED_OUT` (another checkout); `NOT_FAST_FORWARD`; `CHECKOUT_CONFLICT` |
| `branch.move` | write | `{name, to: oid, expect: oid, ccOwned?}` | `update-ref -m "code-git: reset" refs/heads/<name> <to> <expect>` | `{undo}` | `REF_UNKNOWN`; `BRANCH_CHECKED_OUT` (any checkout: this one's branch moves with `head.reset`); `CC_OWNED_BRANCH`; `REV_UNKNOWN`; `REF_MOVED` |
| `tag.create` | write | `{name, oid, message?}` | non-blank `message`: `tag -a --cleanup=verbatim -F - --end-of-options <name> <oid>`, the message on stdin (≤ `REF_LIMITS.tagMessageMaxBytes`, no NUL); else `tag --end-of-options <name> <oid>` | `{ref, oid /* tag object, or the commit for a lightweight tag */, undo}` | `REF_EXISTS`; `REV_UNKNOWN` |
| `tag.delete` | write | `{names}` | `tag -d --end-of-options <names…>` | `{deleted, undo}` (`old` = the tag object) | `REF_UNKNOWN` (any name, before anything is deleted) |
| `tag.push` | write, **cancellable** | `{remote, names}` | `push --porcelain --end-of-options <remote> refs/tags/<n>:refs/tags/<n>…` (never forced) | `{pushed, upToDate, rejected, unrequested, undo}` | `REMOTE_UNKNOWN`; `REF_UNKNOWN`; the push refusals below |
| `tag.deleteRemote` | write, **cancellable** | `{remote, names}` | `push --porcelain --end-of-options <remote> :refs/tags/<n>…` | `{deleted, rejected, unrequested, undo}` (`undo.remoteRefs[].old` = the local tag object, else null) | `REMOTE_UNKNOWN`; the push refusals below |
| `head.reset` | write | `{to: oid, mode: 'soft' \| 'mixed' \| 'hard', expect: oid /* HEAD now */, ccOwned?}` | hard only: `stash create` first; `reset --<mode> --end-of-options <to>` | `{undo}` (`undo.worktreeSnapshot` = the `stash create` commit of the discarded tracked changes, null when clean or not hard) | `NO_HEAD`; `REF_MOVED` (HEAD ≠ `expect`); `CC_OWNED_BRANCH` (`head: true`, any mode); `REV_UNKNOWN` |
| `head.revert` | write | `{oid, mainline?: 1…16}` | `revert --no-edit [-m <n>] --end-of-options <oid>` (exit 0 or 1) | `{conflicts, files, oid /* the new commit, null on conflicts */, undo}` | `NO_HEAD`; `CHECKOUT_CONFLICT`; `PICK_EMPTY`; `GIT_FAILED` (a merge without `mainline`, …) |
| `head.cherryPick` | write | `{oid, mainline?: 1…16}` | `cherry-pick [-m <n>] --end-of-options <oid>` (exit 0 or 1) | as `head.revert` | as `head.revert` |
| `head.abort` | write | `{which: 'revert' \| 'cherry-pick'}` | `<which> --abort` | `{undo}` (`undo.head`) | `NOTHING_IN_PROGRESS` (no `REVERT_HEAD` / `CHERRY_PICK_HEAD`) |

- **Revert and cherry-pick outcomes.** Stopped on conflicts (exit 1 with `REVERT_HEAD` / `CHERRY_PICK_HEAD` and unmerged files): `{conflicts: true, files}` (`diff --name-only --diff-filter=U -z`), the operation left in progress for `head.abort` or a commit. Exit 1 with nothing unmerged (the change is already in HEAD): the operation is aborted and 409 `PICK_EMPTY`. Local changes in the way: `CHECKOUT_CONFLICT`.

**Remote names and pushes** (`src/git/remote/push.js`, shared with later remote ops):

- `remote` is checked in `params` (non-empty, ≤ 200 characters, no leading `-`, whitespace or control character) and then must be one of `git remote`'s names; either failure is 404 `REMOTE_UNKNOWN`, the first before any exec.
- A push is `push --porcelain --no-follow-tags --end-of-options <remote> <refspecs…>` (`--no-follow-tags`: a configured `push.followTags` never publishes a tag nobody selected), runs with `NETWORK_LIMITS` (`src/git/remote/limits.js`) and accepts exit 0, 1 and 128. No env is added: `BASE_ENV` already disables every prompt.
- Before a push, each `refs/heads/<b>` destination is mapped through the remote's configured fetch refspecs (`git config --get-all remote.<name>.fetch`; `src/git/remote/tracking.js`) to the tracking refs here git updates with it, and none may be a symbolic ref, live or dangling: git would follow it to its target. Else 409 `SYMBOLIC_REF` with `target`, and nothing runs. Accepted refspecs: `[+]refs/…:refs/…` (exact, or one `*` on each side), `[+]refs/…` (stores nothing) and `^refs/…`; negative refspecs exclude nothing, because git's push-time tracking update ignores them. Any other shape is 409 `REMOTE_CONFIG_UNSUPPORTED` with `remote` and `refspec`. So is a remote with no url (no non-empty `remote.<name>.url` after the last empty value, which clears the list; a `pushurl` does not count) **and** a legacy `.git/remotes/<name>` or `.git/branches/<name>` file, from which git would take refspecs (`refspec: null`; found with `rev-parse --git-path` and `hash-object --no-filters`). A push-only remote with no legacy file maps through its config. Tag destinations update no tracking ref and read no fetch config.
- Results and undo lists come from the `--porcelain` ref lines for the refspecs' destinations only (`splitRequested` in `src/git/parse/push.js`); a line for any other ref is listed in `unrequested: [{ref, flag}]` (the porcelain flag), never dropped.
- No ref line and a non-zero exit: 502 `REMOTE_AUTH_FAILED` or 502 `REMOTE_UNREACHABLE` (`classifyRemoteFailure` in `src/git/parse/push.js`), with `stderr`; anything else (a pre-push hook that refused) 422 `GIT_FAILED` with `stderr`. Hooks always run.
- Every ref rejected and none updated or up to date: 409 `PUSH_REJECTED` with `rejected: [{ref, reason}]`; the message names each `ref: reason` (the first five, then a count). A partly rejected push succeeds and lists `rejected`.

### Paging convention (for ops that list)

An op that lists pages **by git arguments**, never by slicing output (cc's exec is buffered). One that pages by cursor returns `{items, nextCursor}` (`nextCursor: null` on the last page): `graph.page` pages the log by `--skip` over an explicit tip set sent on stdin — topo order is only stable for a fixed tip set, so the caller freezes one ([graph](graph.md#snapshot-and-refresh)). The diff is paged one file at a time: `diff.files` lists every file with one command (refused past its cap, never clipped), and `diff.file` fetches one file's hunks. Other listings page their own way: blame by `-L a,b`, blobs by `cat-file -s` before reading.


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
| `kind` | `read` \| `write`, from the op definition |
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
| `CONFLICTED` | 409 | A path to discard has a merge conflict |
| `PARTIAL_UNSUPPORTED` | 409 | Hunk or line staging asked of a file that is not a plain modification |
| `SELECTION_UNSUPPORTED` | 409 | A line selection git cannot apply as one patch (an end-of-file newline change left out) |
| `STALE_DIFF` | 409 | The selected hunk or lines no longer match the file's diff |
| `NOTHING_TO_COMMIT` | 409 | Nothing staged and no merge in progress |
| `NO_HEAD` | 409 | The op needs a commit and HEAD is unborn |
| `PATCH_DOES_NOT_APPLY` | 409 | `git apply` refused the patch; `stderr` |
| `GITIGNORE_UNSUPPORTED` | 409 | The root `.gitignore` is a symlink, binary or over `STAGE_LIMITS.gitignoreMaxBytes` |
| `PATH_NOT_IN_COMMIT` | 404 | The path is not a file in that commit |
| `UNTRACKED_UNDER_PATH` | 409 | A tracked path to discard is now a directory holding untracked or ignored files; `paths` |
| `BARE_REPO` | 409 | A bare repository (its git dir is the working tree, whatever `core.bare` says): `repo.summary` and every write that touches the working tree or the index refuse it (a pure ref write — a tag, a branch delete or move, a push — does not) |
| `REF_UNKNOWN` | 404 | A branch, tag or remote branch the op names does not exist |
| `BRANCH_CHECKED_OUT` | 409 | The branch is checked out where the op may not touch it; `worktree` = that checkout's path |
| `CC_OWNED_BRANCH` | 409 | A `code-conductor/*` branch without `ccOwned: true`; `branches`, and `head: true` for this checkout's own HEAD |
| `REF_EXISTS` | 409 | A branch or tag of that name exists |
| `REF_MOVED` | 409 | The ref is no longer at the op's `expect` |
| `NOT_FAST_FORWARD` | 409 | The target is not a descendant of the branch |
| `CHECKOUT_CONFLICT` | 409 | Local changes would be overwritten; `files`, `stderr` |
| `SYMBOLIC_REF` | 409 | The branch named is a symbolic ref; `target` = the ref it points at |
| `REMOTE_CONFIG_UNSUPPORTED` | 409 | A fetch refspec of the remote code-git cannot map to the tracking refs a push updates, or a remote with no url whose config git reads from a legacy remote file; `remote`, `refspec` |
| `REMOTE_UNKNOWN` | 404 | The remote name is malformed or not one of `git remote`'s |
| `PUSH_REJECTED` | 409 | The remote rejected every ref of a push; `rejected` |
| `PICK_EMPTY` | 409 | A revert or cherry-pick would commit nothing; nothing is left in progress |
| `NOTHING_IN_PROGRESS` | 409 | `head.abort` with no revert or cherry-pick in progress |
| `BODY_TOO_LARGE` | 413 | Request body over 1 MB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | A state-changing request that is not JSON |
| `GIT_FAILED` | 422 | git exited with a code the op does not accept; `exitCode`, `stderr` |
| `OUTPUT_TOO_LARGE` | 422 | Output passed the op's cap; the command was killed; `limitBytes` |
| `INTERNAL` | 500 | A code-git bug (logged) |
| `SYSTEM_UNREACHABLE` | 502 | The project's System cannot be asked; `detail` = cc's code |
| `GIT_UNAVAILABLE` | 502 | git could not start on the System; `errno` |
| `REMOTE_AUTH_FAILED` | 502 | The remote refused the credentials, or would have prompted for them; `stderr` |
| `REMOTE_UNREACHABLE` | 502 | The remote could not be reached; `stderr` |
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
