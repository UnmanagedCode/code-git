> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md) · [architecture](architecture.md)

# Submodules

A checkout's submodules: listed with their status in the left slot, added, initialized, updated (recursively), synced, given a new url and removed; and each opened as its own repo view (a **submodule tab**), with an offer to commit its new pointer in the parent when the tab closes.

## Model

| Term | Meaning |
|---|---|
| **chain** | A target's `sub`: the submodule paths from the cc checkout down, each relative to the repo before it. `['libs/a', 'b']` is submodule `b` of submodule `libs/a`. Absent for the checkout itself (never `[]` or `null`); 1…`SUBMODULE_LIMITS.maxDepth` entries (`src/git/submodule/limits.js`), each a `submodulePath` |
| **submodule tab** | A tab whose target has a chain. Every panel works in it unchanged: every op call sends the tab's target |
| **pointer** | The gitlink (mode `160000`): `recorded` in the index, `committed` in HEAD; `head` is the submodule's own HEAD |
| **entry** | One `.gitmodules` section with a path, joined with the repo's config, index, HEAD, status and a probe of its directory (`listSubmodules` in `src/git/submodule/list.js`) |

### Addressing

- The runner alone turns a chain into argv: `git BASE_ARGS -C <chain joined by /> --git-dir=.git <op args>` (`subArgs` in `src/git/runner.js`). cc only ever sees `{project, worktree}` (form A): `exec` builds its body from those two keys.
- `--git-dir=.git` turns off repository discovery. Without it, git walks up from a submodule that is not cloned yet to the parent and, under `--work-tree=.`, treats the submodule's directory as the parent's working tree: writes land in the parent's index. With it, that target exits 128. A gitfile (`gitdir: ../.git/modules/…`) is read as the git dir.
- `--work-tree=.` (in `BASE_ARGS`) resolves after `-C`, so the submodule's directory is the working tree.
- **Containment preflight** (`assertInsideCheckout` in `src/git/submodule/target.js`, run by `src/routes/ops.js` before any op with a chain): reads under the op run's id, no lock.
  1. The checkout's `rev-parse --show-toplevel`, then the submodule's: exit 128 → `SUBMODULE_NOT_POPULATED {path}`; output other than exactly `<checkout top>/<chain>\n` → `SUBMODULE_UNSAFE {reason: 'escapes', path}`. git realpaths the working tree, so a symlinked component anywhere in the chain differs; the whole outputs are compared, never split.
  2. The checkout's `rev-parse --absolute-git-dir`; then per chain level its `--absolute-git-dir` (realpathed by git) and its parent's `.gitmodules`. The level's git dir must be exactly `<parent's git dir>/modules/<name>` for the one valid name the parent's `.gitmodules` declares at that path (where `submodule update` puts it), or its own embedded `<level top>/.git`; else `SUBMODULE_UNSAFE {reason: 'gitdir', path}`. A crafted `.git` gitfile naming another repository — another submodule's git dir, the parent's own `.git`, anything outside — would otherwise receive the op's writes. The parent's *own* git dir, not the common dir: a cc worktree's submodules live under `<common>/worktrees/<wt>/modules/`.
  3. Cost per op: three checkout reads plus two reads per chain level (`gitDirMatches` in `src/git/submodule/gitdir.js` is the rule).
- A write in a submodule tab holds the **project's** lock: its pointer is the project's state.
- Activity entries of a submodule command carry `target.sub`; the UI labels them `project › path › …`.

### Status (`submodule.list` entries)

| Field | Meaning |
|---|---|
| `name`, `path`, `url`, `branch` | As `.gitmodules` (the working tree's file, as git reads it) declares them; `url` relative urls unresolved |
| `resolvedUrl`, `initialized` | `submodule.<name>.url` in the repo's local config (written by `submodule init`); initialized = it is set |
| `populated` | Its directory is a repository whose own top level is `<top>/<path>` |
| `recorded`, `committed`, `head` | Index gitlink (stage 0), HEAD's gitlink (null on an unborn HEAD or a new submodule), the submodule's HEAD (null when unborn or not cloned) |
| `outOfSync` | populated, and `head` ≠ `recorded` |
| `modified`, `untracked` | The `S<c><m><u>` field of `status --porcelain=v2 --ignore-submodules=none` |
| `added` | A gitlink in the index and none in HEAD |
| `conflicted` | An index entry at a stage above 0 |
| `typeChanged` | A stage-0 entry at the path that is not a gitlink (a file staged in its place), or files tracked under it (a directory in its place) |
| `blocked` | `'path'` (fails `submodulePath` — checked first, so a bad path is never probed or passed to argv — or another entry declares the same path), `'name'` (fails `submoduleName`), `'escapes'` (the probe found a top level elsewhere — a symlink — or a git dir other than `<repo git dir>/modules/<name>` or an embedded `.git`: a crafted gitfile), else null. Every op on a blocked entry refuses `SUBMODULE_UNSAFE {reason}`; a blocked path never reaches argv |
| `urlProblem` | `remoteUrl`'s refusal message for `resolvedUrl ?? url`; null when fine, absent, or relative and not resolved yet |

Sorted by path. Past `SUBMODULE_LIMITS.maxListed` entries the list is `truncated` and nothing past the cap is probed. Probes run at most `SUBMODULE_LIMITS.probeConcurrency` at a time.

## Ops (`src/git/ops/submodule.js`)

Every op acts on the target's repo (the checkout or the chain's submodule) with paths relative to it. `submodule.list` is a cancellable read; every write is non-cancellable (a killed clone leaves a half-populated `.git/modules/<name>`). `paths` params take 1…`SUBMODULE_LIMITS.maxListed` `submodulePath` entries.

| Op | Params | Gates (in order) | Runs | Returns |
|---|---|---|---|---|
| `submodule.list` | none | — | `rev-parse --show-toplevel`; `config -f .gitmodules -z --get-regexp '^submodule\..*\.(path\|url\|branch)$'` (exit 1: none, and nothing else runs); `config --local -z --get-regexp '^submodule\..*\.(url\|active)$'`; `ls-files -s -z -- <paths>`; `ls-tree -z HEAD -- <paths>`; `status --porcelain=v2 -z --ignore-submodules=none -unormal -- <paths>`; `rev-parse --absolute-git-dir`; per entry `-C <path> --git-dir=.git rev-parse --show-toplevel --absolute-git-dir HEAD` (exit 128 allowed) | `{submodules, truncated}` |
| `submodule.add` | `{url, path, name?, branch?}` (`submoduleUrl`, `submodulePath`, `submoduleName`, `assertRefName`) | not bare; `.gitmodules` not a symlink; path not in the index, no entry with that path or name, and nothing at the path in the working tree (git would adopt it, a gitfile's repository included, instead of cloning) (`SUBMODULE_EXISTS {reason: 'exists'}`); no repo-scope `protocol.*`; a relative url: the default remote's url passes `remoteUrl` | `submodule add [--name n] [-b b] -- <url> <path>` under `NET_CONFIG`, clone caps. "A git directory for … is found locally" → `SUBMODULE_EXISTS {reason: 'gitdir'}` | `{path, name}` (the gitlink and `.gitmodules` staged, git's behaviour) |
| `submodule.init` | `{paths}` | not bare; entries known and unblocked; each has a gitlink in the index (else `SUBMODULE_NOT_RECORDED {paths}`: git's submodule commands address submodules through the index; a conflicted gitlink counts as recorded) | `submodule init -- <paths>` (config only, no network) | `{submodules: [{path, resolvedUrl, urlProblem}]}` |
| `submodule.update` | `{paths, discardCommits?}` | not bare; entries known and unblocked; recorded (`SUBMODULE_NOT_RECORDED`); no repo-scope `protocol.*`; `submodule init -- <paths>`; every resolved url passes `remoteUrl` (`SUBMODULE_UNSAFE {reason: 'url', names}`); unless `discardCommits`, no populated entry with a detached HEAD has orphans (`SUBMODULE_COMMITS_AT_RISK {paths: [{path, count}]}`) | `submodule update --checkout --init --recursive -- <paths>` under `NET_CONFIG`, clone caps. Never `--force` | `{paths}` |
| `submodule.sync` | `{paths}` | not bare; entries known and unblocked; recorded (`SUBMODULE_NOT_RECORDED`); each `.gitmodules` url that is not relative passes `remoteUrl` | `submodule sync --recursive -- <paths>` | `{paths}` |
| `submodule.setUrl` | `{path, url}` (`submoduleUrl`) | not bare; `.gitmodules` not a symlink; entry known and unblocked | `config --file .gitmodules submodule.<name>.url <url>`; when initialized, `submodule sync -- <path>` | `{path, url}` (`.gitmodules` left unstaged) |
| `submodule.remove` | `{path, discard?}` | not bare; `.gitmodules` not a symlink; entry known and unblocked; unless `discard`: `SUBMODULE_DIRTY {path, modified, untracked, orphaned, staged, gitmodules}` when it is populated and modified or untracked, has orphans against `recorded`, has a staged pointer (`recorded` ≠ `committed`), or `.gitmodules` has unstaged changes | with unstaged `.gitmodules` changes, `add -- .gitmodules`; when initialized or populated, `submodule deinit [-f] -- <path>`; `rm -q [-f] -- <path>` (`-f` only with `discard`). Decided from `ls-files -s -z -- <path>`: **something other than a gitlink staged there** (`typeChanged`) → `SUBMODULE_NOT_RECORDED {reason: 'typechange'}`, the index untouched; **nothing at any stage**, gitlink in HEAD (`git rm --cached`) → `update-index --add --cacheinfo 160000,<committed>,<path>` first, then the gates and commands above — any refusal or failure after it (`discard`'s deinit and rm included) takes out exactly that entry again; declared only and not cloned → `config -f .gitmodules --remove-section submodule.<name>` (and `config --remove-section` of the local section when initialized), `add -- .gitmodules`, no deinit or rm; declared only and cloned → `SUBMODULE_NOT_RECORDED` | `{path, name}`; the gitlink removal and `.gitmodules` staged, `.git/modules/<name>` kept |
| `submodule.commitPointer` | `{path, expect, summary, description?}` (`assertOid`; the message as `commit.create`'s, `messageParams`) | not bare; entry known and unblocked; populated (`SUBMODULE_NOT_POPULATED`); `head` = `expect` (`SUBMODULE_POINTER_MOVED {path, head}`); `expect` ≠ `committed` (`NOTHING_TO_COMMIT`); no merge, cherry-pick or revert stopped (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`) and no rebase going (`rebase-merge` / `rebase-apply` under `rev-parse --git-path`): `OPERATION_IN_PROGRESS {operation}` | A temporary index (`$GIT_DIR/code-git-pointer-index`): `read-tree HEAD` (`--empty` when unborn), `update-index --add --cacheinfo 160000,<expect>,<path>`, `commit -F -` on it (the message on stdin; hooks run); then the same `update-index` on the real index. The commit holds exactly `expect` even if the submodule moved after the check; anything else staged stays staged | `{oid}` |

**Orphans** (`orphanCount` in `src/git/submodule/gates.js`): in the submodule, 0 when HEAD is on a branch; else `rev-list --count HEAD --not --branches --tags --remotes --end-of-options <recorded> --` (counted without `<recorded>` when the submodule does not have it yet).

**Failures** (`submoduleFailure` in `src/git/submodule/failure.js`, from git's stderr under `LC_ALL=C`): `transport '<x>' not allowed` → `SUBMODULE_TRANSPORT_BLOCKED {transport}` (for `file`, the message names the System's `protocol.file.allow`); a checkout over local changes (`would be overwritten by checkout`, `Your local changes`) → `SUBMODULE_DIRTY`; else the remote ops' `remoteFailure` (`src/git/remote/net.js`): `REMOTE_AUTH_FAILED` / `REMOTE_UNREACHABLE` with `reason`, or `GIT_FAILED {exitCode}`. Each carries `stderr`.

**Caps**: `SUBMODULE_LIMITS.cloneTimeoutMs` and `cloneMaxOutputBytes` for `add` and `update`; the other writes use the write defaults (`LIMITS.write`).

## Security: `.gitmodules`, `.git/config` and a submodule's own config are untrusted

| Threat | Decision | Mechanism |
|---|---|---|
| `submodule.<name>.update=!cmd` (in `.git/config`; git ignores it from `.gitmodules`) | Pinned | Every `submodule update` passes `--checkout`, which overrides it, top level and under `--recursive` |
| `ext::`, `fd::`, any `<transport>::`, a `-`-leading url | Refused + pinned | `submoduleUrl` → `BAD_URL` on add and setUrl; `update` checks every resolved url (`SUBMODULE_UNSAFE {reason: 'url'}`) before cloning; every clone or update runs under `NET_CONFIG` (`protocol.ext.allow=never`, `protocol.fd.allow=never`), which reaches git's submodule child processes through `GIT_CONFIG_PARAMETERS` and beats any config file, a submodule's `url.*.insteadOf` included |
| Relative urls (`./…`, `../…`) | Allowed, checked after resolution | `submoduleUrl` accepts them (no whitespace or control character, no `::`, no backslash, at most `URL_MAX`) and never resolves them; `update` runs `submodule init` first (config only), then checks the resolved url; `add` checks the url git resolves against: the current branch's remote (else `origin`) as `ls-remote --get-url` expands it (insteadOf applied, no network); a missing or refused one is `SUBMODULE_UNSAFE {reason: 'url'}` |
| `protocol.file.allow`, `protocol.allow`, `protocol.<x>.allow` | Repo scope refused; System scope honoured; never set by code-git | Before `add` and `update`: `config --show-scope -z --get-regexp '^protocol\.'`; any `local` or `worktree` entry → `SUBMODULE_UNSAFE {reason: 'config', keys}` (a submodule tab checks the submodule's own). The System's global and system config are its user's. git's own default (`protocol.file.allow=user`) refuses local-path clones into submodules unless the System opts in: `SUBMODULE_TRANSPORT_BLOCKED {transport: 'file'}`. No argv, env or written config of code-git sets `protocol.file.allow` or `GIT_ALLOW_PROTOCOL` |
| A crafted `.git` gitfile naming another repository's git dir | Refused | The preflight (per chain level) and the list probe require `<parent git dir>/modules/<name>` or an embedded `.git` (`gitDirMatches`); `add` refuses a path that already exists |
| Names or paths escaping the repo or aliasing `.git` | Refused | `submodulePath`: `assertSubpath` + no empty or `.` segment, no trailing `/`, no segment aliasing `.git` (`isDotGitAlias`: any case, HFS-ignorable code points dropped, trailing dots and spaces stripped, NTFS `git~<n>`). `submoduleName`: non-empty, ≤ 1024 bytes, no control character or backslash, no leading `-`, not absolute, no `..` segment (git's `check_submodule_name`), no `.git` alias. Symlinks: the list probe per entry, the preflight per op |
| A password in a submodule url | Masked in what is logged and returned | The activity log's argv (`maskUrl`) and stderr (`maskUrls`); a clone failure's refusal `stderr` (`submoduleFailure`), since git quotes the failed url there. git itself gets the real url; `.gitmodules` and the config hold what the user typed |
| A symlinked `.gitmodules` | Refused before a write | git writes through it: `add`, `setUrl` and `remove` refuse `SUBMODULE_UNSAFE {reason: 'gitmodules'}` |
| `core.fsmonitor` in a submodule's config | Pinned | `BASE_ARGS`' `-c core.fsmonitor=false` applies under `-C` and reaches the status and update children |
| `submodule.recurse` | Pin kept | `BASE_ARGS` keeps `submodule.recurse=false`; only `submodule.update` (`--recursive`) and `submodule.sync` (`--recursive`) recurse; status and list pass `--ignore-submodules=none` |

**Command safety**: argv arrays only; paths after `--`; `-C` values are `submodulePath`s (no leading `-`); config keys are built as `submodule.<validated name>.url`; urls are checked (no leading `-`) before they reach argv; `submodule add` passes `-- <url> <path>`. Names, paths, urls, stderr and messages render as React text only.

### Residual risks

| Risk | Why it stays |
|---|---|
| `GIT_ALLOW_PROTOCOL` in the System's environment | It overrides `-c protocol.*`, the `ext` pin included. It is the System user's; code-git neither sets nor clears it |
| Hooks and `core.hooksPath` inside a submodule | Parity with the parent: git never clones hooks (a fresh submodule's come from the System's templates), and an existing submodule's hooks are the user's repo. They run as the checkout's do (checkout and commit hooks) |
| `core.sshCommand`, `core.gitProxy`, `credential.helper`, `url.*.insteadOf` in a submodule's config | They apply when git fetches inside an existing submodule (parity with the remote ops); an insteadOf to `ext::`/`fd::` is neutralised by `NET_CONFIG`. A fresh clone's child process does not read the parent's local config |
| A nested submodule's own config | Checked only at the level the op runs at (a submodule tab checks its repo); recursion relies on the propagated pins and git's defaults |
| `safe.directory` | An explicit `--git-dir` skips git's ownership check; the submodule directory lives inside a checkout the user owns |
| The preflight → op gap | The containment check and the op are separate commands; a symlink or gitfile swapped in between is not caught |

## UI (`frontend/src/features/submodules/`)

| File | Role |
|---|---|
| `api.ts` | Wire types (`SubmoduleEntry`, `SubmoduleList`) and the op wrappers |
| `state.ts` | `submodulesStore` by `tabKey`; `loadSubmodules` (one request in flight per tab plus one rerun); `useSubmodules` reads on mount, after a finished write on the same project (the activity store) and on window focus |
| `SubmodulesPanel.tsx`, `panel.ts` | The left-slot panel (`SUBMODULES_PANEL`), `statusBadges`, and `SubmodulesButton`: below `lg` (left slot hidden) the graph toolbar's **Submodules** button opens the panel in a dialog. Row menus render in the panel's own `ContextMenuHost` (`'submodules'`), inside that dialog on a phone |
| `actions.ts` | `SUBMODULE_ACTIONS` (context `'submodule'`, ctx `{tab, entry}`), `openSubmodule`, `subTab`, `update`, `initialize`, `sync`, `remove` |
| `run.ts` | `runSubmoduleOp`: `trackOp`, then the submodule list, the Changes lists and summary, and the graph of the acted-on repo refreshed whatever the outcome |
| `dialogs/`, `SubmoduleDialogHost.tsx` | Add, Edit URL and the pointer prompt; the host (mounted by `Shell`) renders the open one from `state/submoduleDialog.ts` and starts the exit watcher |
| `exit.ts` | `watchSubmoduleExits` (while the host is mounted) and `offerPointerCommit`; offers that arrive while a dialog is open wait in a queue |

**Menu** (hidden for a blocked entry): Open (primary, 100; populated), Initialize (200; not initialized), Update (210), Sync (220; initialized), Edit URL… (300), Remove… (310, destructive).

**Confirmations**: Remove… always confirms (it names `.git/modules/<name>` as kept). `SUBMODULE_DIRTY` and `SUBMODULE_COMMITS_AT_RISK` come back as an error toast whose **Review…** opens a second, irreversible confirmation listing the facts; confirming retries with `discard: true` / `discardCommits: true`. When `.gitmodules` has unstaged changes, that confirmation says they will be staged with the removal. Update's running toast counts seconds (`trackOp`'s `elapsed`); Add shows "Cloning ‹path›…" in its dialog while it runs, and toasts only its success.

**Open and exit**: Open dispatches `open` with `{...tab, sub: [...(tab.sub ?? []), entry.path]}`; the parent tab stays open. The repo header of a submodule tab shows the chain as a breadcrumb (each ancestor opens or activates its tab) and **Back to ‹parent›** (opens or activates the parent, then closes this tab). Whenever a submodule tab leaves the open tabs — its ✕, Close, Close others, Back — the parent's `submodule.list` is read; when the entry is populated, unblocked and its `head` ≠ `committed`, the pointer prompt offers to commit it (`Update submodule <path>` prefilled; **Commit pointer** / **Not now**). Commit sends `expect: head`; `SUBMODULE_POINTER_MOVED` checks again.

**Tab state**: `tabKey` appends `\0<path>` per chain entry (a checkout's key is unchanged); `refsKey(tab)` (branch tracking) is the project for a checkout and the tab key for a submodule; `prefsKey(tab)` (graph prefs, `code-git:graph:<prefsKey>`) is the bare project name for a checkout, else the project then `\0<path>` per chain entry (NUL is in no validated path, so `['a/b']` and `['a', 'b']` differ). Panel rows are keyed by entry name (unique per `.gitmodules` section; two sections may declare one path). A submodule tab's graph lists itself as its only checkout (no cc worktree list). The route carries the chain as repeated `sub` params.

## Known limitations

- **Remove keeps `.git/modules/<name>`** (git has no command that deletes it), so adding a submodule with the same name again is refused (`SUBMODULE_EXISTS {reason: 'gitdir'}`).
- **Update always checks out** the recorded commit: a configured `submodule.<name>.update` (rebase, merge, `!command`) is ignored.
- **No pointer prompt on a browser reload or close**: only a tab closing inside the app offers it.
- **A nested submodule's local config is checked only at the level the op runs at.**
- **Extra commands per op** in a submodule tab: the containment preflight's three checkout reads plus two per chain level.
- **A read can fail transiently during a multi-command submodule write.** The UI refreshes after each finished command of a write, so a `repo.summary` or graph read started mid-`remove` or mid-`update` can meet a submodule being deleted or cloned and fail (`GIT_FAILED`, or `NOT_A_REPO` as `repo.summary` words git's exit 128): the header or graph briefly shows that error, and recovers when the op ends and its refresh runs.
