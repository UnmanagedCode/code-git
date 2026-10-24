> See also: [README](../README.md) · [features](features.md) · [architecture](architecture.md) · [submodules](submodules.md)

# Protocol

The backend's HTTP API (all paths relative to the plugin root: `/plugins/code-git/` in cc, `/` standalone), the UI's routes, and the cc routes the backend consumes.

## Conventions

- JSON everywhere under `api/`. A refusal is `{error, code, …extra}` with the status from `HTTP_STATUS` (`src/refusals.js`), the single source for codes. A url password in any string of it — `error`, `stderr`, a list of names — is masked (`maskDeep` over `maskUrls`, in `Refusal.toBody`); so are the success payloads that carry git's stderr (`remote.fetch`'s `partial` and per-remote `error`, `graph.refs`' `worktreesError`). Masking (`maskUrls`, `src/mask.js`, linear in the text's length) runs from the first `:` after `scheme://` (any scheme, one of digits only too; the user name holds no whitespace) to the `@` that ends the url's authority within one line, never across another url. A url starts only at a url boundary — the text's start, whitespace, a quote, `(`, `[`, `<`, `,`, `=`, or a `<transport>::` starting there itself — so a `://` inside a password (`https://u:pw://x@h`) is part of it. An `@` *strongly* ends an authority when a host-like run then `/`, `:`, `?`, `#`, a quote or a closing bracket follows; *weakly* when whitespace or the line's end follows. A password that stops at whitespace ends at the last `@` of its token; one going on past whitespace ends at the first strong `@` on the line, else its token's own last `@` when strong, else the first weak `@` after the token, else the token's weak one — never at an `@` inside it. An empty password is left as it is (no `***` inserted). So a user name holding `@` and a password holding quotes, `://` or a space are covered — and one holding `@` where git quotes the url whole — and a second url, or `user@host` text after a url that ends strongly (quoted, or with a path or port), is not touched. A `%3A` (any case) counts as the userinfo `:` and a `%40` as its `@` (git percent-decodes the userinfo). git's trace and trace2 output, which prints an ssh url's userinfo with no scheme, is off on every exec (`TRACE_OFF`: [architecture → Non-interactive git](architecture.md)). Beside urls, git's git-protocol look-up line `unable to look up <userinfo>@<host> (port <n>)` (the authority without its scheme, decoded) has its password masked: the host runs to the first ` (port ` or next look-up after its first `@` (a decoded password may hold ` (port ` or the look-up text), else the line's end, and is masked from its first `:` to its last `@`: `user:***@host`.
  - **Not masked (residual):** a password *starting* with whitespace, or starting with digits followed by `/`, `?`, `#`, a quote, a closing bracket or the line's end (read as a port), when the rest of it lies past whitespace (`https://u: pw@h/r` in a git message); a url glued to the text before it by any other character (`x:https://u:pw@h/r`).
    - A raw `@` in a password: git splits the userinfo at the first `@` and may print the password's tail as the user name (`https://u:p@ssZq7pw@h/r` → `fatal: unable to access 'https://ssZq7pw@h/r/'`); no url-shaped mask sees it.
    - An inner `@` followed by `/`, `"` or `#` in a spaced password can leave a tail (`https://u:a@b/c d@e` → `https://u:***@b/c d@e`); a spaced scheme-like run inside the userinfo is left alone (`https://u:p a://x@h/r`). Both need a raw `@` or whitespace in the userinfo, which git and curl reject.
  - **Not masked (repository content):** a url password inside a tracked or working-tree file, `.gitmodules` included, shows as written in the diff, File view, blame, file history, patch copy/download, merge tool and stash diffs. Any git tool shows the same content; stage selection compares each line's `text` with a re-read diff, and `diff.patch` is byte-exact. The op fields that carry a `.gitmodules` url are masked: `submodule.list`'s `url` and `submodule.setUrl`'s `url` ([submodules](submodules.md)).
  - **Over-masked (the safe side):** a credential-less url with a `:` in its own token followed on the line by an `@` (`https://h/p:contact me@corp.example` → `https://h/p:***@corp.example`, `https://h:8443 failed for git@host` → `https://h:***@host`); a credentialed url followed on the line by a strong `@` (`'https://u:pw@h/r' rejected for git@example.com/x` → `'https://u:***@example.com/x`); one ending weakly followed by any `@` (`https://u:pw@h rejected for git@example.com` → `https://u:***@example.com`); a `%40` in a path after a `:` (`https://u:pw@h/%40scope/r` → `https://u:***%40scope/r`) and a `%3A` in a path before an `@` (`https://h/a%3Ab@c` → `https://h/a%3A***@c`), in a value too.
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
| `GET api/activity` | — | `{entries: ActivityEntry[], runs: OpRun[]}`, each newest last | — |
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

`POST api/ops/:name` with `{target: {project, worktree?, sub?}, params?}`. No route accepts argv or git options: an op builds its argv from typed params. `sub` names a submodule inside the checkout as a chain of paths (`['libs/a', 'b']`: submodule `b` of submodule `libs/a`), omitted for the checkout itself; the runner turns it into `-C <path> --git-dir=.git` and cc never sees it ([submodules → Addressing](submodules.md#addressing)).

| Check (in order) | Refusal |
|---|---|
| Body is an object with only `target` and `params` | 400 `BAD_PARAMS` |
| `target` is `{project, worktree?, sub?}` and nothing else; names non-empty, ≤ 200 chars, not `.` or `..`, no NUL or `/`; `sub`, when present, an array of 1…`SUBMODULE_LIMITS.maxDepth` `submodulePath` entries (`assertTarget`, `submoduleChain`) | 400 `BAD_TARGET` |
| `:name` is a registered op | 404 `UNKNOWN_OP` |
| The op's own `params` check | 400 `BAD_PARAMS`, `BAD_REF`, `BAD_PATH`, `BAD_URL` |
| With `sub`: the chain is a cloned submodule whose real path is inside the checkout and whose git dir, at every level, is the one git gives it (`assertInsideCheckout`: reads under the op run) | 409 `SUBMODULE_NOT_POPULATED` `{path}`, 409 `SUBMODULE_UNSAFE` `{reason: 'escapes' \| 'gitdir', path}` |
| Running it | the op's refusals, plus the exec refusals below |

**The undo journal.** Every write that is not `undo.*` or `remote.fetch` (journal-neutral) clears the checkout's undo and redo slots before it runs; a registered one that succeeds records its plan ([undo → Journal](undo.md#journal)).

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

**Every diff command** carries `DIFF_CONFIG` (`-c diff.suppressBlankEmpty=false`, before the subcommand) and `DIFF_FLAGS` (`--no-color --no-ext-diff --no-textconv --no-relative -M --src-prefix=a/ --dst-prefix=b/ --inter-hunk-context=0 --submodule=short`), both in `src/git/diff/source.js`. `whitespace` (`none` default, `eol`, `change`, `all`) adds `WHITESPACE_FLAGS[whitespace]`. The UI sends only `none` and `all` (`whitespaceFor` in `frontend/src/state/diff.ts`).

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
| `graph.commit` | `{oid}` | `log -1 --no-walk --format=… <oid>`, then `diff-tree -r -z --no-commit-id --raw --numstat --no-abbrev -M --root --no-ext-diff --no-textconv [<first parent>] <oid>`, parsed by `parseRawNumstat` (full-hex oids need no `--end-of-options`) | `CommitDetail` |

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
- **`CommitDetail`** (`graph.commit`): `{oid, parents, author: {name, email, time}, committer: {name, email, time}, subject, body, coAuthors: [{name, email}], signature: {status, signer|null, key|null}, files: [{status, path, oldPath|null, added|null, deleted|null, binary, submodule}] | null, filesError: {code, message, limitBytes?} | null}`. A file's `added` / `deleted` are numstat's line counts, both null for a binary file; `submodule` is true for a gitlink (whose counts are its `Subproject commit` line, not content).
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
- Before the writes (after the gates): the discard snapshot, a dangling commit of the paths' worktree content built in a temporary index ([undo → Record keys](undo.md#record-keys)).
- `result`: `{tracked, untracked, undo}` — what was discarded; `undo.discard = {snapshot, tracked, untracked}`.

### Stage selection: `stage.stageLines`, `stage.unstageLines`, `stage.discardLines` (write)

Stage, unstage or discard a selection of one file's hunks and lines. One implementation (`applySelection` in `src/git/ops/stage.js`; the request check `selectionParams` and the re-read + build `readSelectionPatch` in `src/git/stage/readSelection.js`, shared with `stash.pushLines`; the pure builder is `buildSelectionPatch` in `src/git/stage/selection.js`).

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

Every apply adds `--whitespace=nowarn --no-ignore-whitespace` (overriding `apply.whitespace` and `apply.ignoreWhitespace`) and reads the patch from stdin. **Never `--unidiff-zero`**: the patch is built from a second re-read at `max(context, APPLY_MIN_CONTEXT)` (`src/git/stage/readSelection.js`; `'full'` stays full), because `git apply --unidiff-zero` matches a context-free hunk at the wrong occurrence — on a file without a final newline it exits 0 having changed other lines, even with git's own `-U0` patch. With context, git checks it, and a hunk without leading or trailing context must sit at the file's start or end.

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
- Checks: `amend` with an unborn HEAD → 409 `NO_HEAD`. Without `amend`: `git rev-parse -q --verify MERGE_HEAD` (read for the undo record too) and `git diff --cached --quiet --no-ext-diff --no-textconv --ignore-submodules=none`; nothing staged (exit 0) **and** no merge in progress (exit 1) → 409 `NOTHING_TO_COMMIT`. A merge with nothing staged commits.
- Runs `git commit [--amend [--only]] [--no-verify] -F -`. No `--cleanup`: the repo's `commit.cleanup` applies; git's default for `-F` is `whitespace`, which keeps `#` lines.

| Mode | Flags | Effect |
|---|---|---|
| commit | — | Staged changes; on a detached HEAD, HEAD moves and no branch does |
| amend | `--amend` | Replaces HEAD with the staged changes + the message; a root commit stays parentless |
| message-only amend | `--amend --only` (no paths) | Replaces HEAD's message; the tree is HEAD's, staged changes stay staged |
| skip hooks | `--no-verify` | No `pre-commit` / `commit-msg` hooks |

- A hook or signing failure → 422 `GIT_FAILED` with git's `stderr` (the hook's output).
- `result`: `{oid, undo}`: `oid` is HEAD after the commit (`rev-parse --verify --quiet HEAD^{commit}`); `undo` has `refs` (HEAD's branch), `head` (before → after) and `created: {tip: oid, not: [HEAD before, MERGE_HEAD when concluding a merge]}`.

### `commit.state` (read, cancellable)

- `params`: none. Runs `operationState` (`src/git/sequence/state.js`; the commands and their order: [merge → State detection](merge.md#state-detection)).
- `result`: `{merging, operation, conflicts}`:
  - `merging`: `MERGE_HEAD` exists — a merge is being concluded, so a commit is valid with nothing staged (the commit box enables its button on it).
  - `operation`: `null`, or `{kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert', incoming: {oid, subject} | null /* MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD */, rebase: {branch: 'refs/heads/…' | null, onto: oid | null, step: int | null, total: int | null} | null}` (precedence rebase > merge > cherry-pick > revert).
  - `conflicts`: `[{path, kind, base, ours, theirs}]`, every unmerged path whatever is in progress; `kind` ∈ `bothModified`, `bothAdded`, `deletedByThem`, `deletedByUs`, `addedByUs`, `addedByThem`, `bothDeleted`; each side `{mode, oid}` or `null` (stage 1 base, 2 ours, 3 theirs).
  - A UI reading an answer without `operation` / `conflicts` takes `null` / `[]`.

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
- A FIFO template, or a link to one at any hop, refuses the whole op `PROBE_TIMEOUT` (`path` = the path probed).

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
- Reads `.gitignore` with `readNoIndex`. A symlink, binary, directory, or a file over `STAGE_LIMITS.gitignoreMaxBytes` → 409 `GITIGNORE_UNSUPPORTED`; a FIFO → 504 `PROBE_TIMEOUT`. Nothing is written either way.
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
- The ops that write the working tree or the index first check for a bare repository (`assertWorktree`): 409 `BARE_REPO` from `branch.checkout`, `branch.create` with `checkout`, `head.reset` mixed and hard, `head.revert`, `head.cherryPick`, `head.abort`, `head.continue`, `head.skip`, and `branch.fastForward` of this checkout's own branch. Soft reset and the other ops change refs only.
- A symbolic ref (`%(symref)` set) as the branch an op checks out, renames, fast-forwards, moves or sets the upstream of — local, or `refs/remotes/<r>/HEAD` and other remote aliases for checkout: 409 `SYMBOLIC_REF` with `target`. `branch.delete` deletes a symbolic ref itself, never its target. A *dangling* symbolic ref (its target missing: `for-each-ref` does not list it) is found by `symbolic-ref -q <ref>` on the exact name: `branch.create` and `tag.create` of that name, `branch.rename` from or to it and `branch.delete` of it refuse `SYMBOLIC_REF` (never `REF_UNKNOWN`), since git would create the target, in any namespace, under the alias's name. Every `update-ref` passes `--no-deref`.
- Every ref-changing op returns `undo`: `UndoRecord` below.

```
UndoRecord      { refs: RefChange[], remoteRefs: RemoteRefChange[],
                  head: {old: {branch: refname|null, oid: oid|null}, new: {branch, oid}} | null,
                  worktreeSnapshot: oid | null,
                  stashes: StashChange[] /* the stash ops' ([stash](stash.md#undo-record)); [] here */,
                  worktreePatch: base64 | null /* stash.applyFile's; null here */,
                  worktreeState?: {paths, before, mid?, after} /* stash.push, pop, branch: each {head, index, files} */,
                  removedPatch?: base64 /* stash.pushLines */,
                  created?: {tip: oid, not: oid[]} | null /* the commits the op made: tip minus what not reaches */,
                  indexTree?: oid | null /* head.reset mixed: the index's tree before; null when it had unmerged entries */,
                  discard?: {snapshot: oid, tracked: path[], untracked: path[]} /* stage.discardFiles */ }
                  /* created / indexTree / discard / worktreeState / removedPatch: present only when set ([undo → Record keys](undo.md#record-keys)) */
RefChange       { ref /* refs/heads/… | refs/tags/… */, old: oid|null /* null = created */, new: oid|null /* null = deleted */,
                  upstream?: refname|null /* a deleted branch's upstream; a tracking branch branch.checkout created */,
                  symref?: refname /* a deleted symbolic ref's target: restore with symbolic-ref; old and new are null */ }
RemoteRefChange { remote, ref /* refs/heads/… | refs/tags/… on the remote */, old: oid|null /* best known */, new: oid|null,
                  tracking?: refname|null /* branch.deleteRemote: the tracking ref here git deleted with it (old is its value) */ }
StashChange     { oid, old: {message}|null, new: {message}|null, restore: 'store' | 'pop' | 'drop' }
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
| `head.revert` | write | `{oid, mainline?: 1…16}` | `assertNoOperation`; `revert --no-edit [-m <n>] --end-of-options <oid>` (exit 0 or 1) | `{conflicts, files, oid /* the new commit, null on conflicts */, undo}` | `OPERATION_IN_PROGRESS`; `CONFLICTED` (unmerged paths, nothing in progress); `NO_HEAD`; `CHECKOUT_CONFLICT`; `PICK_EMPTY`; `GIT_FAILED` (a merge without `mainline`, …) |
| `head.cherryPick` | write | `{oid, mainline?: 1…16}` | `assertNoOperation`; `cherry-pick [-m <n>] --end-of-options <oid>` (exit 0 or 1) | as `head.revert` | as `head.revert` |
| `head.abort` | write | `{which: 'merge' \| 'rebase' \| 'cherry-pick' \| 'revert'}` | `operationState`; `<which> --abort` | `{undo}` (`undo.head`) | `NOTHING_IN_PROGRESS` (`which` is not the operation in progress) |
| `head.continue` | write | `{which: 'merge' \| 'rebase' \| 'cherry-pick' \| 'revert'}` | `operationState`; `<which> --continue` (a rebase with `REBASE`'s pins first), env `GIT_EDITOR=:`, exit 0 or 1, `SEQUENCE_LIMITS.timeoutMs`; the state again | `{outcome: 'done' \| 'conflicts' \| 'stopped', files /* conflicts: the unmerged paths */, oid /* HEAD after */, undo /* done only */}` | `NOTHING_IN_PROGRESS`; `CONFLICTED` (`files`, before anything runs); `NOTHING_TO_COMMIT`; `DIRTY_WORKTREE`; `GIT_FAILED` — after a failure the operation stays in progress ([merge → Continue, skip and abort](merge.md#continue-skip-and-abort)) |
| `head.skip` | write | `{which: 'rebase' \| 'cherry-pick' \| 'revert'}` | as `head.continue` with `--skip`, no `CONFLICTED` check | as `head.continue` | `BAD_PARAMS` (`merge`); `NOTHING_IN_PROGRESS`; `GIT_FAILED` |

- **Revert and cherry-pick outcomes.** Stopped on conflicts (exit 1 with `REVERT_HEAD` / `CHERRY_PICK_HEAD` and unmerged files): `{conflicts: true, files}` (`diff --name-only --diff-filter=U -z`), the operation left in progress for `head.continue`, `head.skip`, `head.abort` or a commit. Exit 1 with nothing unmerged (the change is already in HEAD): the operation is aborted and 409 `PICK_EMPTY`. Local changes in the way: `CHECKOUT_CONFLICT`.

**Remote names and pushes** (`src/git/remote/push.js`, shared with later remote ops):

- `remote` is checked in `params` (non-empty, ≤ 200 characters, no leading `-`, whitespace or control character) and then must be one of `git remote`'s names; either failure is 404 `REMOTE_UNKNOWN`, the first before any exec.
- A push is `-c protocol.ext.allow=never -c protocol.fd.allow=never -c remote.<remote>.mirror=false push --porcelain --no-follow-tags [--set-upstream] [--force-with-lease=<ref>:<expect>…] --end-of-options <remote> <refspecs…>` (`--no-follow-tags`: a configured `push.followTags` never publishes a tag nobody selected). Like every network command it runs through `netRun` (`src/git/remote/net.js`): `NET_CONFIG` first, `NETWORK_LIMITS` (`src/git/remote/limits.js`); it accepts exit 0, 1 and 128. No env is added: `BASE_ENV` already disables every prompt. Never `--force` and never a `+` refspec: a lease (`expect` empty = the ref must not exist on the remote) is the only overwrite.
- Before a push, each destination (a branch or a tag: git updates either) is mapped through the remote's configured fetch refspecs (`git config --get-all remote.<name>.fetch`; `src/git/remote/tracking.js`) to the local refs git updates with it (a ref mapped onto the refspec's own source is left out: git writes it the value just pushed from it). Each must lie under `refs/remotes/`, else 409 `REMOTE_CONFIG_UNSUPPORTED` with `remote` and the `refspec` (`assertPushTracking`, the rule `remote.fetch` applies with `refs/tags/` also allowed); none may be a symbolic ref, live or dangling: git would follow it to its target. Else 409 `SYMBOLIC_REF` with `target`, and nothing runs. Accepted refspecs: `[+]refs/…:refs/…` (exact, or one `*` on each side), `[+]refs/…` (stores nothing) and `^refs/…`; negative refspecs are not applied by the check, so a push git would leave alone may be refused: git 2.55 honours a negative refspec against an exact mapping (`^refs/heads/main` with `+refs/heads/main:refs/heads/mirror`) but not against a wildcard one (`+refs/heads/*:refs/heads/mirror/*` still moves `mirror/<b>`), and the check does not tell the two apart. Any other shape is 409 `REMOTE_CONFIG_UNSUPPORTED` with `remote` and `refspec`. So is a remote with no url (no non-empty `remote.<name>.url` after the last empty value, which clears the list; a `pushurl` does not count) **and** a legacy `.git/remotes/<name>` or `.git/branches/<name>` file, from which git would take refspecs (`refspec: null`; found with `rev-parse --git-path` and `hash-object --no-filters`). A push-only remote with no legacy file maps through its config.
- Results and undo lists come from the `--porcelain` ref lines for the refspecs' destinations only (`splitRequested` in `src/git/parse/push.js`); a line for any other ref is listed in `unrequested: [{ref, flag}]` (the porcelain flag), never dropped.
- No ref line and a non-zero exit: 502 `REMOTE_AUTH_FAILED` or 502 `REMOTE_UNREACHABLE` (`remoteFailure` in `src/git/remote/net.js` over `classifyRemoteFailure` in `src/git/parse/push.js`), with `reason` and `stderr`; anything else (a pre-push hook that refused) 422 `GIT_FAILED` with `stderr`. Hooks always run.
- Every ref rejected and none updated or up to date: 409 `PUSH_REJECTED` with `rejected: [{ref, reason}]`; the message names each `ref: reason` (the first five, then a count). A partly rejected push succeeds and lists `rejected`.

### Stash ops (`src/git/ops/stash.js`; all writes, not cancellable)

`stash.push`, `stash.pushLines`, `stash.apply`, `stash.pop`, `stash.applyFile`, `stash.drop`, `stash.rename`, `stash.branch`. A stash is always named by its W commit's full oid (`{oid}`), never `stash@{n}`. A `stash.push` `GIT_FAILED` may carry `{oid, selector}`: git stored the stash before failing. Params, argv, gates, refusals, results and the undo record: [stash](stash.md).

### Remote ops (`src/git/ops/remote.js`)

Behaviour, the rules and what each op destroys: [remotes](remotes.md). Common rules (beside the branch ops' above):

- An existing remote's `name` passes `remoteName` (404 `REMOTE_UNKNOWN`, before any exec) and must be one of `git remote`'s. A **new** name (`remote.add`, `remote.rename`'s `newName`) passes `newRemoteName` (`src/git/remote/url.js`): the same shape, plus git's own rule (`refs/remotes/<name>/…` must be a valid ref, `assertRefName`) and no `=` (a push's `-c remote.<name>.mirror=false` would split there); else 400 `BAD_REF`. A **url** passes `remoteUrl` (a `git://` url carrying userinfo is refused too, the url never echoed: [remotes → Remote config](remotes.md#remote-config)): else 400 `BAD_URL` — except a `remote.edit` url holding the mask (`editedUrl`), checked in the op against the current value: unchanged, or 400 `BAD_URL` before any write.
- A remote git reads from a legacy `.git/remotes` / `.git/branches` file (no url in config, the file exists): 409 `REMOTE_CONFIG_UNSUPPORTED` with `remote`, `refspec: null`, for every op that changes or removes it.
- `undo.remotes`: `[{name, old: RemoteConfig | null, new: RemoteConfig | null}]` (old null = created, new null = removed); `RemoteConfig = {urls, pushUrls /* in order, empty ones kept, each with its password masked (maskUrl, forTheWire): the journal keeps them raw */, fetch /* raw config values, in order, empty ones kept */, extra: [[var /* lower case */, null]] /* every other remote.<name>.<var>, in config order; the value withheld (forTheWire): the journal keeps it raw */, upstreams: [{branch /* short */, merge: refname | null}] /* branch.<b>.remote = this remote */}`; `upstreams` is read from the repo's own config (`config --local`); `remote.remove`'s `old` also has `branchKeys: [[key, value]]` — the repo's own `branch.<b>.remote` / `.merge` / `.pushremote` keys git cleared (the local keys before minus after `remote remove`) — and `pushDefault: bool` (a local `remote.pushDefault` naming it, cleared). `clearedUpstreams` in the result is `branchKeys`' upstreams: `[{branch, merge}]` per branch whose `remote` or `merge` key was cleared.
- `remote.add`, `remote.edit`, `remote.rename`, `remote.remove` are registered for undo; `remote.fetch` is journal-neutral (never undone, the slots kept); `remote.pull` and `remote.push` clear the slots ([undo](undo.md)).

| Op | kind | `params` | Runs | `result` | Refusals |
|---|---|---|---|---|---|
| `remote.list` | read | none | `remote`; `config -z --get-regexp ^remote\.` (a key's remote is the longest listed name it starts with: names may hold dots); for a url-less remote the legacy-file check | `{remotes: [{name, urls, pushUrls /* after the last empty value, as git counts them; each a userinfo password shown as *** (maskUrl) */, fetch /* as configured */, displayUrl /* the first url, else push url */ \| null, displayPushUrl /* the first push url */ \| null, legacy, multiUrl, multiPushUrl /* the raw list holds several values (an empty reset counts): remote.edit refuses to replace it */}]}` | — |
| `remote.add` | write | `{name, url, pushUrl?}` | `remote add --end-of-options <name> <url>`; with `pushUrl`: `remote set-url --push --end-of-options <name> <pushUrl>` | `{name, undo}` | `BAD_REF`, `BAD_URL` (also a url or push url whose password is the mask `***`: `isMaskedUrl`, before any exec), `REMOTE_EXISTS` (from `git remote`, before any write) |
| `remote.edit` | write | `{name, url?, pushUrl?: string \| null}` (at least one; the UI sends only what changed). A field equal to `maskUrl` of the raw list's single value is unchanged: treated as not sent (nothing written, the stored password kept); an edit left writing nothing records no undo entry | `remote set-url --end-of-options <name> <url>`; `remote set-url --push --end-of-options <name> <pushUrl>`; `pushUrl: null`: `config --unset-all remote.<name>.pushurl` (exit 0 or 5) | `{name, undo}` (`old` and `new`) | `REMOTE_UNKNOWN`; `REMOTE_CONFIG_UNSUPPORTED` (the list it would replace — `url` or `pushurl` — holds more than one value, or a legacy remote; checked before the mask); `BAD_URL` (also any other field whose password is the mask `***`, before any write: never spliced with the stored password) |
| `remote.rename` | write | `{name, newName}` | `remote rename --end-of-options <name> <newName>` (git moves `refs/remotes/<name>/*`, the HEAD alias with it, and rewrites `branch.<b>.remote`) | `{name: newName, undo}` | `REMOTE_UNKNOWN`; `BAD_REF`; `REMOTE_EXISTS`; `REMOTE_CONFIG_UNSUPPORTED` unless the fetch refspecs are exactly `+refs/heads/*:refs/remotes/<name>/*` (the one shape git rewrites); `SYMBOLIC_REF` (`ref`, `target`): a live symbolic ref among its tracking refs other than its HEAD alias |
| `remote.remove` | write | `{name}` | the tracking refs (`for-each-ref` over its fetch destinations, `refs/remotes/` only) and its config first; `remote remove --end-of-options <name>`; the refs again | `{name, deletedRefs: refname[], clearedUpstreams: [{branch, merge}], undo}` (`undo.refs`: the deleted tracking refs with their oids, a symbolic one with `symref`; `undo.remotes`: its config) | `REMOTE_UNKNOWN`; `SYMBOLIC_REF` (as rename); `REMOTE_CONFIG_UNSUPPORTED` (legacy, or a fetch refspec code-git cannot map) |
| `remote.fetch` | write, **cancellable** | `{remote: name \| null /* null: every remote with a url */, prune?: bool}` | per remote: its fetch refspecs (`config --get-all remote.<r>.fetch`) checked; `for-each-ref --format=%(refname)%00%(objectname)%00%(symref)` over their destinations and `refs/tags`; `-c protocol.ext.allow=never -c protocol.fd.allow=never -c gc.auto=0 -c maintenance.auto=false fetch --no-recurse-submodules --prune\|--no-prune --no-prune-tags --end-of-options <remote>` (exit 0, 1 or 128); the same `for-each-ref` again | `{remotes: [{remote, changes: [{ref, old, new}] /* plain refs created (old null), moved, pruned (new null) */, pruned: ref[], symrefsResolved: [{ref, target}], partial: stderr \| null} \| {remote, error: {code, message, reason?, stderr}}], undo}` (`undo.refs` = every remote's `changes`) | one named remote throws its refusal: `REMOTE_UNKNOWN`, `REMOTE_AUTH_FAILED`, `REMOTE_UNREACHABLE`, `REMOTE_CONFIG_UNSUPPORTED` (a refspec writing outside `refs/remotes/` and `refs/tags/`), `SYMBOLIC_REF` (`ref`, `target`), `GIT_FAILED`; with `null` those are each remote's `error` |
| `remote.peek` | read, cancellable | `{remote, branch /* short */}` | `-c protocol.ext.allow=never -c protocol.fd.allow=never ls-remote --refs --end-of-options <remote> refs/heads/<branch>` (the exact name kept); the tracking ref its fetch refspecs map the branch to | `{oid: oid \| null /* on the remote */, tracking: {ref, oid} \| null, stale: bool /* oid ≠ tracking.oid */}` | `REMOTE_UNKNOWN`, `BAD_REF`, `REMOTE_AUTH_FAILED`, `REMOTE_UNREACHABLE`, `GIT_FAILED` |
| `remote.pull` | write (**not** cancellable) | `{mode: 'ff' \| 'ffOnly' \| 'rebase', ccOwned?}` | HEAD's branch and `for-each-ref --format=%(upstream)%00%(upstream:remotename) <branch>`; rebase: `status --porcelain=v2 -z --untracked-files=no`; the fetch of that remote (as `remote.fetch`, no prune); `merge-base --is-ancestor`; then a fast-forward `-c merge.autoStash=false merge --ff-only --end-of-options <oid>` (any mode), or diverged — ff: `-c merge.autoStash=false merge --ff --no-edit -m "Merge remote-tracking branch '<remote>/<b>'" --no-stat --end-of-options <oid>` (exit 0 or 1); rebase: `-c rebase.autoStash=false -c rebase.updateRefs=false -c rebase.autoSquash=false -c rebase.backend=merge -c rebase.rebaseMerges=false rebase --end-of-options <oid>` (exit 0 or 1; stopped on conflicts → left in progress). Before anything: `assertNoOperation` | `{mode, upstream: refname, outcome: 'upToDate' \| 'fastForward' \| 'merged' \| 'rebased' \| 'conflicts', files: path[] /* conflicts: the unmerged files, the merge or rebase left in progress */, oid /* HEAD after */, fetch /* that remote's fetch result */, undo}` (`undo.refs` = the fetch's changes + the branch's move; `undo.head` when HEAD moved) | `BARE_REPO`; `NO_HEAD`; `NO_UPSTREAM` (detached, none, local, an unknown remote, or gone after the fetch); `OPERATION_IN_PROGRESS` / `CONFLICTED` (before the fetch); rebase: `CC_OWNED_BRANCH` (`head: true`), `DIRTY_WORKTREE`; ffOnly diverged: `NOT_FAST_FORWARD`; `CHECKOUT_CONFLICT`; the fetch's refusals |
| `remote.push` | write, **cancellable** | `{branch /* local, short */, remote?, to? /* the branch on the remote; needs remote; default: branch */, setUpstream?, forceWithLease?: {expect: oid \| null /* null: must not exist there */}, ccOwned?}` | no `remote`: the branch's upstream (`%(upstream:remotename)`, `%(upstream:remoteref)`); then `push` (above) of `refs/heads/<branch>:refs/heads/<to>` with `--set-upstream` and `--force-with-lease=refs/heads/<to>:<expect>` as asked | `{remote, branch, to, created, forced, upToDate, upstreamSet, unrequested, undo /* always empty: a push is never undone */}` | `REF_UNKNOWN`; `SYMBOLIC_REF` (the local branch, live or dangling, or its tracking ref); `NO_UPSTREAM` (no `remote` and no upstream branch on a remote); `REMOTE_UNKNOWN`; `CC_OWNED_BRANCH` (`branch` or `to` is `code-conductor/*`); `PUSH_REJECTED` with `remote`, `to` and `tracking: {ref, oid} \| null` (where it went, and the tracking ref here: what a lease is taken against); the push refusals |

### Undo ops (`src/git/ops/undo.js`)

Behaviour, plans and the slot rules: [undo](undo.md). The journal is the backend's own (in memory, per checkout); no op takes a plan from the client.

```
UndoSlot { id: number, op: string /* the op name */, label: string, confirm: Confirm | null /* for this slot's direction */ }
Confirm  {kind: 'deletesRefs', refs: refname[]} | {kind: 'discards', paths: path[]} | {kind: 'resetHard'}
       | {kind: 'dropsStashes', messages: string[] /* the stash messages it drops: untrusted text */}
       | {kind: 'deletesRemote', name: string, refs: refname[] /* the tracking refs it deletes */}
```

A label and a confirm carry remote names, ref names, paths and stash messages. A result's `warnings` may name a restored branch's upstream ref; a refusal may quote a fetch refspec (`REMOTE_CONFIG_UNSUPPORTED`'s `refspec`), and a url's password in any of its strings is masked. None carries a remote's `extra` value (a proxy, a pack command). The remote ops' own results carry `extra` values as `null`, `urls` / `pushUrls` masked (`maskUrl`), every other record field raw ([undo → What crosses the wire](undo.md#record-keys)); the activity log records an `extra` value written by an undo or redo as `***`.

| Op | kind | `params` | Runs | `result` | Refusals |
|---|---|---|---|---|---|
| `undo.state` | read (cancellable) | none | nothing | `{undo: UndoSlot \| null, redo: UndoSlot \| null}` | — |
| `undo.undo` | write, **not** cancellable | `{id /* the slot's UndoSlot.id */, ccOwned?}` | `assertNoOperation`; the pushed rule; every step's preflight, then every apply ([undo → Steps](undo.md#steps)) | `{entry: UndoSlot /* confirm for undo */, warnings: string[] /* an upstream not restored */}` | `NOTHING_TO_UNDO`; `UNDO_STALE`; `UNDO_PUSHED` (`oid`, `refs`); `OPERATION_IN_PROGRESS`; `CONFLICTED`; `BARE_REPO`; `DIRTY_WORKTREE`; `CHECKOUT_CONFLICT`; `BRANCH_CHECKED_OUT`; `CC_OWNED_BRANCH` (`head: true` for this HEAD); `SYMBOLIC_REF`; `PATH_BLOCKED`; `REMOTE_CONFIG_UNSUPPORTED` (a remote rename's gates: its refspec or a legacy file changed since); `STASH_MOVED` (a stash drop raced: nothing lost); a failure after a step wrote carries `appliedSteps` |
| `undo.redo` | write, **not** cancellable | as `undo.undo` | as `undo.undo`, no pushed rule | as `undo.undo` | as `undo.undo` with `NOTHING_TO_REDO`, no `UNDO_PUSHED` |

### History ops (`src/git/ops/history.js`; all reads, cancellable)

Behaviour and UI: [history](history.md). Every log-family command takes `LOG_SAFE` (`--no-show-signature --no-ext-diff --no-textconv`, exported by `graph.js`). `rev` is a full oid the client froze (never `HEAD`): pages stay stable while refs move. Caps: `HISTORY_LIMITS` (`src/git/history/limits.js`).

| Op | `params` | Runs | `result` | Refusals |
|---|---|---|---|---|
| `history.file` | `{rev, path, skip?: 0…followMaxCommits−1 (0), limit?: 1…pageMax (pageMax)}` | `rev-parse` (a commit); `log --follow -M --name-status -z <LOG_SAFE> --format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%s --max-count=<min(skip+limit+1, followMaxCommits)> --end-of-options <rev> -- <path>` (the paging exception above) | `{items: [{oid, parents, author, email, time, subject, status /* R100, M, A, … */, path /* the name at that commit */, oldPath /* a rename's or copy's old name, else null */}], nextCursor: skip + limit \| null /* null on the last page */, truncated}` | `REV_UNKNOWN`; `OUTPUT_TOO_LARGE` |
| `history.blame` | `{rev, path, start?: ≥ 1 (1), count?: 1…blameLinesMax}` | `cat-file -t <rev>:<path>` (a blob); `diff --numstat -z --no-ext-diff --no-textconv --no-renames --end-of-options <empty tree> <rev> -- <path>` (the line total; `-` = binary); `blame --porcelain --no-textconv --no-ignore-revs-file -L <start>,+<n> <rev> -- <path>` (no `--end-of-options`: blame reads it as a revision; `rev` is a full oid) | `{total, lines: [{n, oid, origLine, text}], commits: {[oid]: {author, mail, time, summary, filename, previous: oid \| null, previousPath /* the file's name in previous: the old name after a rename */}}}`; `start` past the end: `lines: []` | `PATH_NOT_IN_COMMIT`; `BINARY_FILE`; `OUTPUT_TOO_LARGE` |
| `history.reflog` | `{ref: 'HEAD' \| 'refs/heads/<b>', skip?: ≥ 0, limit?: 1…pageMax}` | `log -g -z --date=unix <LOG_SAFE> --format=%H%x00%gd%x00%gs%x00%gn%x00%ge%x00%s --skip=<skip> --max-count=<limit+1> --end-of-options <ref> --` (`%gd` is `<ref>@{<unix time>}` under `--date=unix`) | `{items: [{selector: '<HEAD \| b>@{skip+i}', oid, time, action /* %gs */, who: {name, email}, subject}], nextCursor}`; no such ref or no reflog: `items: []` | `BAD_REF` (anything else, before any exec) |
| `history.paths` | `{rev}` | `ls-tree -r -z --name-only --full-tree --end-of-options <rev>` under `pathsMaxOutputBytes` | `{paths}` | `REV_UNKNOWN`; `OUTPUT_TOO_LARGE` (the palette then takes a typed path) |

### Merge, rebase and conflict ops

Behaviour, the stop rule and the state detection: [merge](merge.md). The continue, skip and abort ops are `head.*` (the table above); `commit.state` reports what is in progress. Every write here is not cancellable; params are a plain object (an unknown key → `BAD_PARAMS`), oids full hex.

| Op | kind | `params` | Runs | `result` | Refusals |
|---|---|---|---|---|---|
| `merge.start` | write | `{ref: 'refs/heads/…' \| 'refs/remotes/…' \| 'refs/tags/…' \| null, oid, mode: 'ff' \| 'noFf' \| 'squash', expect /* HEAD now */}` | `assertNoOperation`; `merge-base --is-ancestor`; `-c merge.autoStash=false merge <--ff \| --no-ff> --no-edit -m <message> --no-stat --end-of-options <oid>` (squash: `--squash`, no message), exit 0 or 1; squash: `rev-parse --git-path SQUASH_MSG`, `stripspace -s` | `{outcome: 'upToDate' \| 'fastForward' \| 'merged' \| 'squashed' \| 'conflicts', files /* conflicts */, oid /* HEAD after */, message /* squashed: SQUASH_MSG's text, else null */, undo}` | `BARE_REPO`; `OPERATION_IN_PROGRESS`; `CONFLICTED`; `NO_HEAD`; `REF_MOVED` (HEAD ≠ `expect`, or `ref` no longer at `oid`); `REV_UNKNOWN`; `CHECKOUT_CONFLICT`; `GIT_FAILED` |
| `conflict.read` | read (cancellable) | `{path}` | [merge → Conflict files](merge.md#conflict-files); `assertNotBlocked` before the worktree file is read | `{path, kind, content: 'text' \| 'binary' \| 'large' \| 'symlink' \| 'submodule' \| 'oneSided' \| 'none', base, ours, theirs /* each {mode, oid, b64 /* text and symlink only */} \| null */, worktree: {oid /* no-filter hash, null when not a file */, b64 /* text case */} \| null /* absent */}` | `BAD_PATH`; `NOT_CONFLICTED`; `PATH_BLOCKED` |
| `conflict.save` | write | `{path, contentB64 /* ≤ CONFLICT_LIMITS.saveMaxBytes */, expect: oid \| null}` | the gates, then `hash-object -w --stdin --path=<p>`, `mktree -z` per level, `restore --source=<tree> --worktree -- <p>` | `{oid}` (the worktree file's new no-filter hash) | `BARE_REPO`; `NOT_CONFLICTED`; `NOT_TEXT_CONFLICT`; `PATH_BLOCKED`; `FILE_CHANGED` (`expect`, `actual`); `BAD_PARAMS` |
| `conflict.take` | write | `{paths /* 1…CONFLICT_LIMITS.takeMax */, side: 'ours' \| 'theirs'}` | `assertNotBlocked` over every path and `assertFileTarget` on each path where no stage is a gitlink, before any write; then `update-index -z --index-info` (gitlinks), `checkout --<side> --` + `add --`, `rm -q -f --` (deleted on that side) | `{resolved: path[], deleted: path[]}` | `BARE_REPO`; `NOT_CONFLICTED` (`paths`); `PATH_BLOCKED` |
| `rebase.plan` | read (cancellable) | `{base, head}` \| `{oids: oid[] /* 1…REBASE_LIMITS.maxCommits */}` | range: `rev-list --count`, `log -z --reverse --no-show-signature --format=%H%x00%P%x00%an%x00%ae%x00%at%x00%B --end-of-options <base>..<head>`; oids: `cat-file --batch-check`, `log --no-walk=unsorted -z … --stdin` | `{commits: [{oid, parents, summary, description, author: {name, email, time}}]}` (oldest first / the given order) | `REV_UNKNOWN`; `HAS_MERGES`; `TOO_MANY_COMMITS {count, max}`; `BAD_PARAMS` (both forms, duplicates) |
| `rebase.interactive` | write | `{mode: 'rebase' \| 'pick', base, onto, expect, rows: [{oid, action: 'pick' \| 'reword' \| 'edit' \| 'squash' \| 'fixup' \| 'drop', message?: {summary, description?}}] /* oldest first */, ccOwned?}` | the gates of `rebase.start` (pick: no cc check); `rev-list <base>..<expect>` (rebase) or the plan of the rows (pick); `config --type=bool --get commit.gpgSign`; a carrier per row that takes a message (`log -1`, `commit-tree [-S] -p <parent> -F - --end-of-options <oid>^{tree}`, the message on stdin, the author in env); `<REBASE pins> rebase -i --empty=drop --onto=<onto> --end-of-options <base>` with env `GIT_SEQUENCE_EDITOR='cat >'` and the todo on stdin | as `rebase.start` | as `rebase.start`; `BAD_PARAMS` ([merge → Interactive rebase](merge.md#interactive-rebase)); `TOO_MANY_COMMITS` |
| `rebase.start` | write | `{onto, upstream, expect, ccOwned?}` | the gates of [merge → Rebase](merge.md#rebase) (`git version`, `assertNoOperation`, `status`, `rev-list --merges --count <upstream>..HEAD`); `<REBASE pins> rebase --onto=<onto> --end-of-options <upstream>`, exit 0 or 1 | `{outcome: 'done' \| 'upToDate' \| 'conflicts' \| 'stopped', files, oid /* HEAD after */, undo /* done: the branch's move */}` | `BARE_REPO`; `GIT_TOO_OLD` (< 2.26); `OPERATION_IN_PROGRESS`; `CONFLICTED`; `NO_HEAD`; `REF_MOVED`; `CC_OWNED_BRANCH` (`head: true`); `DIRTY_WORKTREE`; `REV_UNKNOWN`; `HAS_MERGES`; `CHECKOUT_CONFLICT` (untracked files in the way; aborted); `GIT_FAILED` (aborted, `stderr`) |

### Submodule ops (`src/git/ops/submodule.js`)

`submodule.list` (read, cancellable); `submodule.add`, `submodule.init`, `submodule.update`, `submodule.sync`, `submodule.setUrl`, `submodule.remove`, `submodule.commitPointer` (writes, not cancellable). Paths are relative to the target's repo. Params, argv, gates, refusals and results: [submodules → Ops](submodules.md#ops-srcgitopssubmodulejs).

### Git-flow ops (`src/git/ops/flow.js`)

Behaviour, the preflight and the departures from nvie: [gitflow](gitflow.md). Writes are not cancellable and have no undo (they clear the slots). Names are short (`main`, `feature/x`).

| Op | kind | `params` | Runs | `result` | Refusals |
|---|---|---|---|---|---|
| `flow.config` | read (cancellable) | `{}` | `config -z --get-regexp ^gitflow\.` (exit 0 or 1); `readHeads`; `ownHead` | `{initialized /* usable: complete and passing the write ops' checks */, main, develop, prefixes: {feature, release, hotfix, versionTag} /* each null when unset */, defaults: {main /* main, master, HEAD's branch or null */, develop, prefixes}}` | — |
| `flow.init` | write | `{main, develop, prefixes: {feature, release, hotfix, versionTag}}` | `readHeads`, `ownHead`; when develop is missing: `branch --no-track --end-of-options <develop> <main's oid>`; six × `config --local --end-of-options <key> <value>` | `{config /* as flow.config without defaults */, createdDevelop}` | `BAD_REF` (an invalid name or prefix, or one under `code-conductor/`); `BAD_PARAMS` (equal branches, an empty or repeated type prefix, a type prefix that prefixes main or develop); `NO_HEAD`; `REF_UNKNOWN` (main); `SYMBOLIC_REF` |
| `flow.start` | write | `{type: 'feature' \| 'release' \| 'hotfix', name, ccOwned?}` | the gates of [gitflow → What each op runs](gitflow.md#what-each-op-runs); `switch --no-guess --no-track -c <prefix><name> --end-of-options <base's oid>` | `{branch, base, oid}` | `BARE_REPO`; `FLOW_NOT_INITIALIZED`; `BAD_REF`; `REF_EXISTS` (the branch, or a release's / hotfix's version tag); `FLOW_EXISTS {branch}`; `REF_UNKNOWN`; `SYMBOLIC_REF`; `CC_OWNED_BRANCH` (`head: true`); `CHECKOUT_CONFLICT` |
| `flow.finish` | write | `{type, name, expect /* the flow branch's oid */, tagMessage? /* release, hotfix: required, non-blank, ≤ REF_LIMITS.tagMessageMaxBytes, no NUL; a feature: absent */, ccOwned?}` | every gate, then `merge-tree --write-tree -z --name-only --no-messages --end-of-options <into> <branch>` per merge (exit 0 or 1); then per merge `switch --no-guess --end-of-options <into>` + `-c merge.autoStash=false merge --no-ff --no-edit -m "Merge branch '<branch>'" --no-stat --end-of-options <oid>`, the tag after the main merge (`tag -a --cleanup=verbatim -F - --end-of-options <tag> <oid>`), `branch -d --end-of-options <branch>` (exit 0 or 1) | `{branch, merges: [{into, outcome: 'merged' \| 'upToDate', oid}], tag: {name, oid /* the tag object */} \| null, deleted, head /* develop */}` | `BAD_PARAMS`; `BAD_REF`; `BARE_REPO`; `OPERATION_IN_PROGRESS`; `CONFLICTED`; `DIRTY_WORKTREE`; `GIT_TOO_OLD` (< 2.38); `FLOW_NOT_INITIALIZED`; `REF_UNKNOWN`; `SYMBOLIC_REF`; `REF_MOVED`; `BRANCH_CHECKED_OUT {worktree}`; `CC_OWNED_BRANCH` (`head: true`); `REF_EXISTS` (the tag); `FLOW_CONFLICT {into, files}` (nothing written); `FLOW_INCOMPLETE {step, into?, done, cause}` (once git changed anything; a step refused before that answers its own refusal, e.g. `CHECKOUT_CONFLICT`) |

### LFS ops (`src/git/ops/lfs.js`)

Behaviour, what writes and the `.gitattributes` parse: [lfs](lfs.md). Every git-lfs command but `version` runs as `--no-literal-pathspecs lfs …`. None is cancellable; none has an undo.

| Op | kind | `params` | Runs | `result` | Refusals |
|---|---|---|---|---|---|
| `lfs.status` | read (cancellable) | `{}` | `-c alias.lfs= lfs version` (exit 0 or 1; the gate of every LFS write too); when usable: `config --get filter.lfs.process` (exit 0 or 1), the root `.gitattributes` (`readNoIndex`) | `{available, version: string \| null, supported, filters: bool \| null, attributes: 'ok' \| 'unsupported' \| null, patterns: string[] \| null}` (the last three null when git-lfs is absent or below 3.2.0) | `GIT_FAILED` (an unrecognised version, another `lfs version` failure); `PROBE_TIMEOUT` (a FIFO `.gitattributes`) |
| `lfs.files` | write, `journal: 'neutral'` | `{}` | `lfs ls-files --json` (`LFS_LIMITS.listMaxOutputBytes`) | `{files: [{path, size, oid, downloaded} /* a missing field null */]}` | `BARE_REPO`; `LFS_UNAVAILABLE`; `GIT_TOO_OLD`; `OUTPUT_TOO_LARGE`; `GIT_FAILED` (also malformed output) |
| `lfs.track` | write | `{pattern}` | `lfs track -- <pattern>` | `{pattern}` | `BAD_PARAMS` (`checkPattern`); `BARE_REPO`; `LFS_UNAVAILABLE`; `GIT_TOO_OLD`; `ATTRIBUTES_UNSUPPORTED`; `PROBE_TIMEOUT`; `GIT_FAILED` |
| `lfs.untrack` | write | `{pattern}` | the patterns read before, the `.gitattributes` check, `lfs untrack -- <pattern>`, the patterns read after | `{pattern, removed}` | as `lfs.track` |
| `lfs.pull` | write | `{}` | `NET_CONFIG lfs pull` (`netRun`, `LFS_LIMITS.netTimeoutMs`) | `{}` | `BARE_REPO`; `LFS_UNAVAILABLE`; `GIT_TOO_OLD`; `GIT_FAILED` (`stderr`: network and auth failures too) |
| `lfs.prune` | write | `{}` | `lfs prune` | `{}` | `BARE_REPO`; `LFS_UNAVAILABLE`; `GIT_TOO_OLD`; `GIT_FAILED` |

### Paging convention (for ops that list)

An op that lists pages **by git arguments**, never by slicing output (cc's exec is buffered). One that pages by cursor returns `{items, nextCursor}` (`nextCursor: null` on the last page): `graph.page` pages the log by `--skip` over an explicit tip set sent on stdin — topo order is only stable for a fixed tip set, so the caller freezes one ([graph](graph.md#snapshot-and-refresh)). The diff is paged one file at a time: `diff.files` lists every file with one command (refused past its cap, never clipped), and `diff.file` fetches one file's hunks. Other listings page their own way: blame by `-L a,b` (`history.blame`), the reflog by `--skip` (`history.reflog`), blobs by `cat-file -s` before reading.

**The one exception: `history.file`.** `git log --follow` applies `--skip` to the unfiltered walk and loses the rename when it skips one (a four-commit history with `--skip=2` comes back empty; `tests/history-git-probes.test.js` pins it), while `--max-count` counts the shown commits correctly. So each page re-walks from the frozen `rev` with `--max-count=skip+limit+1` and drops the first `skip` records. The walk never exceeds `HISTORY_LIMITS.followMaxCommits` commits, sized so that many records at `followRecordBudgetBytes` fit `fileMaxOutputBytes` (a test pins it); a page that reaches the cap answers `truncated: true` with `nextCursor: null`, and a longer record makes it refuse `OUTPUT_TOO_LARGE`, never a clipped page.


## Activity

**`ActivityEntry`** (one git command; `createActivityLog` in `src/activity/log.js`):

| Field | Meaning |
|---|---|
| `id` | Number, increasing |
| `opRunId` | Shared by the commands of one op call |
| `op` | Op name |
| `target` | `{project, worktree, sub?}` (`worktree: null` = main checkout; `sub` only for a command run in a submodule, the chain it ran in) |
| `argv` | Exactly what ran, `git` first |
| `env` | The op's own env overlay (not the base env); values of names matching `/TOKEN\|PASS\|SECRET\|KEY/i` are `[redacted]` |
| `stdinBytes` | Size of stdin; its content is never recorded |
| `kind` | `read` \| `write`, from the op definition |
| `cancellable` | From the op definition |
| `startedAt` | ISO time |
| `durationMs`, `exitCode` | cc's; `null` while running or when the command never ran to an exit |
| `stderr`, `stderrTruncated` | Decoded as UTF-8 (invalid bytes replaced), the **tail** up to `LIMITS.stderrCap` bytes; a url's password inside it is masked (`maskUrls` in `src/mask.js`: git quotes the url a submodule clone failed on) |
| `status` | `running` → `ok` \| `failed` (exit outside the op's accepted codes, `code: GIT_FAILED`) \| `refused` (a cc refusal) \| `timeout` (`GIT_TIMEOUT`) \| `cancelled` (`CANCELLED`) |
| `code` | The refusal code, or `null` |

**`OpRun`** (one call of a **write** op; `openRun` in `src/activity/log.js`, opened by `POST api/ops/:name`). Reads open none.

| Field | Meaning |
|---|---|
| `id` | Number, increasing (its own sequence, not an entry's `id`) |
| `opRunId` | The `opRunId` its commands' entries carry |
| `op`, `kind` | Op name; always `write` |
| `target` | As an entry's: the call's `{project, worktree, sub?}` |
| `status` | `running` → `ended` |
| `startedAt`, `endedAt` | ISO times; `endedAt` is `null` while running |

**Run guarantee.** A run is `running` from the route's start of the call — before the submodule containment preflight and the op's first command — until the op returned or threw **and every git call it made has settled**, the time a call spent waiting for the project's write lock included. Then it is `ended`, exactly once. So once a run is `ended`, no command of that call is running or can still start: a read made then sees the repository as the write left it. A failed op, a refusal (preflight included) and a client that went away all end the run too (a non-cancellable write's run ends when its commands finish). Two writes on one project are two runs, each ending on its own. Between two commands of a write no entry may be `running` while its run is: the run, not the entries, says whether a write is in flight.

**Events.** `GET api/activity/events` sends `event: activity` with the entry as `data` (JSON) when an entry opens and when it closes, `event: run` with the `OpRun` as `data` when a run opens and when it ends, and a `: ping` comment every `HEARTBEAT_MS` (`src/routes/activity.js`). Treat events as signals: the UI refetches `api/activity` on each.

The log keeps the newest `LIMITS.activityRing` entries in memory, and as many runs: over the cap the oldest **ended** runs go, never a running one, so the run ring exceeds `LIMITS.activityRing` only by the runs still running. It is diagnostic: nothing derives repo state from it (the UI times its refreshes by the runs).

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
| `CONFLICTED` | 409 | A path to discard has a merge conflict; or the index has unmerged paths where an op needs none (a stash save or apply; a start with nothing in progress; `head.continue`); `files` where listed |
| `PARTIAL_UNSUPPORTED` | 409 | Hunk or line staging asked of a file that is not a plain modification |
| `SELECTION_UNSUPPORTED` | 409 | A line selection git cannot apply as one patch (an end-of-file newline change left out) |
| `STALE_DIFF` | 409 | The selected hunk or lines no longer match the file's diff |
| `NOTHING_TO_COMMIT` | 409 | Nothing staged and no merge in progress; or a `head.continue` git refused because it would commit nothing (the operation stays); `stderr` |
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
| `CHECKOUT_CONFLICT` | 409 | Local changes would be overwritten (or a stash's untracked file is already there); `files`, `stderr` |
| `SYMBOLIC_REF` | 409 | The branch named is a symbolic ref; `target` = the ref it points at |
| `REMOTE_CONFIG_UNSUPPORTED` | 409 | A fetch refspec of the remote code-git cannot map to the tracking refs a push updates, or a remote with no url whose config git reads from a legacy remote file; `remote`, `refspec` |
| `REMOTE_UNKNOWN` | 404 | The remote name is malformed or not one of `git remote`'s |
| `PUSH_REJECTED` | 409 | The remote rejected every ref of a push; `rejected`; from `remote.push` also `remote`, `to`, `tracking: {ref, oid} \| null` |
| `BAD_URL` | 400 | A remote or submodule url refused (`remoteUrl` in `src/git/remote/url.js`; `submoduleUrl` in `src/git/submodule/url.js` adds relative `./` / `../` urls): not an allowlisted shape, a `<transport>::` helper url, a leading `-`, whitespace or a control character, too long |
| `REMOTE_EXISTS` | 409 | A remote of that name exists (`remote.add`, `remote.rename`) |
| `NO_UPSTREAM` | 409 | Pull or push without a remote, and HEAD's branch (or the branch) has no remote upstream; detached HEAD |
| `DIRTY_WORKTREE` | 409 | A rebase pull with tracked changes in the working tree or the index; or a rebase's `head.continue` git refused over unstaged changes (the rebase stays; `stderr`) |
| `NOT_CONFLICTED` | 409 | The conflict tool named a path with no unmerged entry; `paths` from `conflict.take` |
| `NOT_TEXT_CONFLICT` | 409 | `conflict.save` of a path whose stages are not regular files (a symlink, a submodule, deleted on both sides) |
| `FILE_CHANGED` | 409 | `conflict.save`: the worktree file is no longer what was read; `expect`, `actual` |
| `TOO_MANY_COMMITS` | 409 | A rebase plan or an interactive rebase over `REBASE_LIMITS.maxCommits` commits; `{count, max}` |
| `HAS_MERGES` | 409 | A rebase's range (`upstream..HEAD`) holds a merge commit: it is not flattened; rebase it with git |
| `OPERATION_IN_PROGRESS` | 409 | A merge, rebase, cherry-pick or revert is in progress where an op would start another, or — `submodule.commitPointer` — where a commit would conclude it or land in its middle; `operation` = its kind (`merge` \| `rebase` \| `cherry-pick` \| `revert`). "Finish or abort it first" |
| `PICK_EMPTY` | 409 | A revert or cherry-pick would commit nothing; nothing is left in progress |
| `NOTHING_IN_PROGRESS` | 409 | `head.abort` / `head.continue` / `head.skip` whose `which` is not the operation in progress (or none is) |
| `STASH_UNKNOWN` | 404 | The oid is not in the stash list ([stash](stash.md)) |
| `NOTHING_TO_STASH` | 409 | A save had nothing to stash: git printed "No local changes to save" on stdout (decided from that line, not from whether `refs/stash` moved) |
| `PATH_BLOCKED` | 409 | A stash op (or `conflict.save`, or `conflict.take` for any path it names, before it writes anything; `conflict.read`, which would read through it) would write through something git cannot write into: a leading directory of a path it writes is an untracked (or ignored) symlink or file (`assertNotBlocked`), or — for `stash.applyFile`, `stash.pushLines`, `conflict.save`, and `conflict.take` on every path where no stage is a gitlink — the file itself is a directory or a link to a directory (`assertFileTarget`); `paths` ([stash → Gates](stash.md#gates)) |
| `STASH_MOVED` | 409 | The stash list changed while dropping; the entry dropped by mistake was stored back; `{oid, restored}` |
| `BINARY_FILE` | 409 | `history.blame` of a binary file (its numstat is `-`) |
| `NOTHING_TO_UNDO`, `NOTHING_TO_REDO` | 409 | The checkout's undo (redo) slot is empty ([undo](undo.md)) |
| `UNDO_STALE` (id) | 409 | The slot no longer holds that `id` (the client's `undo.state` is old): the slots are **kept**; refetch |
| `UNDO_STALE` (state) | 409 | The checkout changed since the op (HEAD, a ref, the index or a file is not what the plan expects, found by a preflight or a transaction's compare-and-swap): the slots are **cleared** ([undo → Ops](undo.md#ops)) |
| `UNDO_PUSHED` | 409 | A commit the op created is reachable from a remote-tracking ref; `oid`, `refs`; the slots are cleared |
| `GIT_TOO_OLD` | 409 | The project's System runs a git below the feature's floor (a rebase: 2.26; `feature: 'git-flow finish'`: 2.38), or a git-lfs below 3.2.0 (`feature: 'git-lfs'`, `have` its version); `{feature, need, have}` |
| `FLOW_NOT_INITIALIZED` | 409 | `flow.start` / `flow.finish`: the `gitflow.*` settings are unset or not usable ([gitflow](gitflow.md#settings)) |
| `FLOW_EXISTS` | 409 | `flow.start` of a release or hotfix while another of that type is open; `branch` |
| `FLOW_CONFLICT` | 409 | `flow.finish`: a merge would conflict (the preflight); nothing written; `into`, `files` |
| `FLOW_INCOMPLETE` | 409 | `flow.finish` stopped after git changed something (a step refused before that answers its own refusal); `step` (`switch` / `merge` / `tag` / `delete`), `into`, `done` (the steps done), `cause: {code, message, stderr, files?}` |
| `LFS_UNAVAILABLE` | 409 | An LFS write on a System without git-lfs |
| `ATTRIBUTES_UNSUPPORTED` | 409 | `lfs.track` / `lfs.untrack`: the root `.gitattributes` is a symlink or not a regular file |
| `SUBMODULE_UNKNOWN` | 404 | No `.gitmodules` entry declares that path; `path` |
| `SUBMODULE_UNSAFE` | 409 | Not acted on: `reason` `name` / `path` / `duplicate` (`.gitmodules` declares the name at another path or the path under another name) / `escapes` (the entry, or a chain resolving outside the checkout; `path`), `gitdir` (a chain level's `.git` names another repository's git dir; `path`), `url` (a url git would clone or resolve against is refused; `names`), `config` (the repo's own config sets `protocol.*`; `keys`), `gitmodules` (`.gitmodules` is a symlink) |
| `SUBMODULE_NOT_POPULATED` | 409 | The submodule is not cloned (or the chain's directory does not exist); `path` |
| `SUBMODULE_EXISTS` | 409 | `submodule.add`: `reason` `exists` (the path is in the index, an entry has that path or name, or anything is already on disk at the path) or `gitdir` (a removed submodule of that name kept `.git/modules/<name>`); `path`, `name` |
| `SUBMODULE_DIRTY` | 409 | `submodule.remove` without `discard`: `{path, modified, untracked, orphaned, staged, gitmodules}`; or an update's checkout over local changes (`stderr`) |
| `SUBMODULE_COMMITS_AT_RISK` | 409 | `submodule.update` without `discardCommits` would leave commits on no branch; `paths: [{path, count}]` |
| `SUBMODULE_POINTER_MOVED` | 409 | `submodule.commitPointer`: the submodule's HEAD is not `expect`; `path`, `head` |
| `SUBMODULE_CONFLICTED` | 409 | `submodule.update` of a gitlink in conflict (git would skip it and exit 0); `paths` |
| `SUBMODULE_NOT_RECORDED` | 409 | `.gitmodules` declares it but its gitlink is not in the index: `submodule.init` / `update` / `sync`, and `submodule.remove` of such an entry whose directory holds a clone; `paths`. `reason: 'typechange'`: `submodule.remove` where a file or a directory is staged in the gitlink's place |
| `SUBMODULE_TRANSPORT_BLOCKED` | 409 | git's protocol policy refused the url's transport; `transport`, `stderr` (for `file`: the System's `protocol.file.allow` does not allow it) |
| `BODY_TOO_LARGE` | 413 | Request body over 1 MB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | A state-changing request that is not JSON |
| `GIT_FAILED` | 422 | git exited with a code the op does not accept; `exitCode`, `stderr` |
| `OUTPUT_TOO_LARGE` | 422 | Output passed the op's cap; the command was killed; `limitBytes` |
| `INTERNAL` | 500 | A code-git bug (logged) |
| `SYSTEM_UNREACHABLE` | 502 | The project's System cannot be asked; `detail` = cc's code |
| `GIT_UNAVAILABLE` | 502 | git could not start on the System; `errno` |
| `REMOTE_AUTH_FAILED` | 502 | The remote refused the credentials, or would have prompted for them; `reason` (`credentials` — refused, or an http 401/403 · `prompt` — git needed to ask · `ssh-key` · `ssh-host-key`), `stderr`. The message says what to set up on the System |
| `REMOTE_UNREACHABLE` | 502 | The remote could not be reached; `reason` (`dns` · `refused` · `timeout` · `not-found` — no repository at the url · `unavailable`), `stderr` |
| `CONDUCTOR_UNAVAILABLE` | 503 | No `CONDUCTOR_URL`, cc did not answer, or answered without a usable body |
| `GIT_TIMEOUT` | 504 | The command passed its deadline and was killed; partial `stderr` |
| `PROBE_TIMEOUT` | 504 | A stat-only probe of a file (`worktreeEntry` / `readNoIndex` in `src/git/diff/noIndex.js`) did not finish within `DIFF_LIMITS.probeTimeoutMs`: a special file such as a FIFO, or an unresponsive System; `path`, `timeoutMs` |

## UI routes

The document stays at the plugin root; the active tab is in the query string, never the hash.

| Query | Meaning |
|---|---|
| (none) | No URL-named tab: the persisted tabs only |
| `?project=<name>` | The project's main checkout |
| `?project=<name>&worktree=<name>` | That worktree |
| `…&sub=<path>&sub=<path>…` | A submodule tab: one `sub` per chain entry, in order |

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
