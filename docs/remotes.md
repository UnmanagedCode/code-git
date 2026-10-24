> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md#remote-ops-srcgitopsremotejs) · [refs](refs.md) · [architecture](architecture.md)

# Remotes

Talking to other repositories: the remotes' config (add, edit, rename, remove), fetch (with prune and auto-fetch), pull in three modes, and branch push with force-with-lease. Ops and their wire shapes: [protocol](protocol.md#remote-ops-srcgitopsremotejs).

## Using it

### Where the actions are

| Surface | Actions |
|---|---|
| Graph toolbar | **Fetch** (every remote; disabled with none; a warning dot after an auto-fetch failure, its reason in the button's label) · **Pull** (the default mode; disabled when HEAD has no upstream on a remote) with **Pull options** ▾ · **Push** (HEAD's branch: to its upstream at once, else the Push dialog; disabled on a detached or unborn HEAD). While its op runs a button shows a spinner and is disabled; the activity panel shows the elapsed time, and Cancel for fetch and push |
| Pull options ▾ | Pull (fast-forward if possible) · Pull (fast-forward only) · Pull (rebase) — each runs once · **The Pull button runs** › a radio of the three, persisted per project · **Fetch all (prune)…** · **Auto-fetch: …** › Off / Every 1, 5, 15, 30, 60 min |
| Refs panel → Remotes header | **Add remote** (+). Every remote `remote.list` names is listed, one with no fetched branch too |
| Remote (right-click its row) | Fetch `<remote>` (150) · Fetch `<remote>` (prune)… (151) · Edit… (700) · Remove… (720, destructive) · Copy URL (900: the masked display url) — Edit and Remove not on a legacy remote; then the graph's Hide / Solo (950s) |
| Local branch | **Push** (250, when it has an upstream on a remote) · **Push to `<remote>`…** (251; a **Push to remote** submenu with several remotes) → the Push dialog |
| A local branch dropped on a remote branch | **Push `<source>` to `<target>`** (250): pushes to that remote branch, setting the upstream when the source has none |
| Commit box | **Push after commit** (persisted per project; shown when HEAD is on a branch and a remote exists): after a commit that succeeded, Push as the toolbar does |

### Dialogs

`state/remoteDialog.ts`, rendered by `RemotesHost` (`features/remotes/`, mounted once by the shell). Add and edit stay open while their op runs and show a refusal inline (`role="alert"`: `BAD_URL`, `REMOTE_EXISTS`, `BAD_REF`).

| Dialog | Content |
|---|---|
| Add remote | Name, Fetch URL, Push URL (optional); **Fetch after adding** (on) |
| Edit remote | Name, Fetch URL and Push URL prefilled with the masked display urls. Only changed fields are sent, against the current name, and a rename runs last (a retry after a failed rename repeats both, never naming a remote that is gone); an emptied push url is removed. A changed field still holding the mask (`:***@`) cannot be saved ("retype the whole URL, password included"), so a masked password is never written back (the server refuses one too, `BAD_URL`). A field whose raw config list holds several values (`multiUrl` / `multiPushUrl`, an empty reset counting) is shown disabled ("edit them with git") |
| Push `<branch>` | Remote (select; preselected from the menu), Branch on the remote (prefilled: the same name), **Set as upstream** (on when the branch has no upstream). Push closes the dialog and runs the push flow |

### Confirmations and toasts

Every confirmation is the shared `confirm()`; nothing is sent unless it resolves true.

| When | What |
|---|---|
| Fetch (prune) | "Deletes remote-tracking branches whose branch is gone from the remote; local branches and tags are untouched" |
| Remove remote | Names the count of tracking branches it deletes and lists the local branches that lose their upstream |
| A push of a `code-conductor/*` branch (source or destination) | The cc warning; **Push anyway** sends `ccOwned` |
| A rebase pull on a `code-conductor/*` HEAD | The cc HEAD warning (`withCcHeadAck`, "Rebasing it"); **Rebase anyway** |
| A fetch | "Fetched origin: 2 updated, 1 new, 1 pruned" (or "up to date"); a warning listing `remote: message` for each remote that failed, "partly fetched", and `ref → target` for each symbolic ref the fetch brought to life |
| A pull | Up to date / Fast-forwarded / Merged / Rebased; `NOT_FAST_FORWARD`: "Diverged: pick Pull (fast-forward if possible) or Pull (rebase)"; `DIRTY_WORKTREE`: "Commit or stash first"; merge or rebase conflicts: a warning "The pull stopped on conflicts" with the files and **Abort merge…** / **Abort rebase…** (confirms "discards the merge/rebase in progress and any conflict resolutions", then `head.abort {which}`); the Changes banner shows the operation ([merge](merge.md)) |
| `REMOTE_AUTH_FAILED` / `REMOTE_UNREACHABLE` | The backend's message (what to set up on the System) with git's stderr |

### Force with lease

A rejected push's toast offers **Force with lease…** (not after a rejected lease). It asks the remote first (`remote.peek`):

- **Not stale** (the remote branch is where the tracking ref says): a destructive confirmation — "Overwrite `<remote>/<to>` (at abc1234) with `<branch>` (def5678)? Commits only on the remote branch are lost. Uses --force-with-lease: refused if the remote moved." **Force push** re-pushes with `forceWithLease.expect` = the remote oid it showed.
- **Stale** (the remote moved since the last fetch): "`<remote>/<to>` moved since the last fetch", offering **Fetch `<remote>`** instead. Force is not offered until a fetch and a fresh push attempt.

### Auto-fetch

Off by default (`autoFetchMinutes: 0`, per project, `code-git:remotes:<project>`). One timer per project with an open tab — fetching the project's checkout, never a submodule of a submodule tab (`features/remotes/autoFetch.ts`; `setRemoteClock` injects the timers in tests). A tick fetches every remote, never pruning, only when the page is visible, no write op run of that project is in flight (`writeRunning`: the activity log's runs, so not between two commands of a write either) and no remote op of it is in flight; it shows no running or success toast. The first failure of a streak (the op refused, or a remote's `error`) toasts once and sets the toolbar's warning dot; a success clears both.

## Rules

### Every network command

- Runs through `netRun` (`src/git/remote/net.js`): `-c protocol.ext.allow=never -c protocol.fd.allow=never` (`NET_CONFIG`) right after `BASE_ARGS`, deadline and output cap from `NETWORK_LIMITS` (`src/git/remote/limits.js`). Covers `fetch`, `ls-remote` and every `push` (C5's tag pushes and remote deletes included).
- Prompts are off (`BASE_ENV`): credentials come only from the System's credential helper, ssh key or agent. A command that would prompt fails at once.
- A command that failed as a whole → `remoteFailure`: `REMOTE_AUTH_FAILED` or `REMOTE_UNREACHABLE` with a `reason` and a message saying what to set up on the System, else `GIT_FAILED` with git's stderr.

| `reason` | Code | git said (`classifyRemoteFailure`, first match wins) |
|---|---|---|
| `credentials` | `REMOTE_AUTH_FAILED` | `Authentication failed`, `HTTP Basic: Access denied`, `The requested URL returned error: 401` / `403` |
| `prompt` | `REMOTE_AUTH_FAILED` | `terminal prompts disabled`, `could not read Username` / `Password` |
| `ssh-key` | `REMOTE_AUTH_FAILED` | `Permission denied (publickey` |
| `ssh-host-key` | `REMOTE_AUTH_FAILED` | `Host key verification failed` |
| `dns` | `REMOTE_UNREACHABLE` | `Could not resolve host` |
| `refused` | `REMOTE_UNREACHABLE` | `Connection refused`, `Failed to connect to` |
| `timeout` | `REMOTE_UNREACHABLE` | `Connection timed out`, `Operation timed out` |
| `not-found` | `REMOTE_UNREACHABLE` | `does not appear to be a git repository`, `repository '…' not found` |
| `unavailable` | `REMOTE_UNREACHABLE` | `unable to access` (anything else curl reports) |

### Remote config

- **Passwords in urls** never reach the browser: `remote.list`'s `urls`, `pushUrls`, `displayUrl` and `displayPushUrl`, the remote ops' undo records (`undo.remotes[].old` / `.new` `.urls` / `.pushUrls`, masked by `forTheWire`) and the activity log's argv (so `/api/activity`, its events and the Activity panel) go through `maskUrl` (`src/mask.js`), which hides everything from the userinfo's first `:` to the value's last `@` (a password may hold `/`, `@` and whitespace; a path holding `@` after a `user:` prefix is masked too). git's ssh, git and http transports percent-decode the userinfo, so a `%3A` (any case) counts as its `:` and a `%40` as its `@` (`ssh://user%3APW@h/r` → `ssh://user%3A***@h/r`, `ssh://user:PW%40h/r` → `ssh://user:***%40h/r`; a `%40` in a path after a `:` is masked over too: `https://u:pw@h/%40scope/r` → `https://u:***%40scope/r`). It finds the url anywhere in a stored value — `foo::https://user:PW@h/r`, which git stores though `remoteUrl` refuses it, becomes `foo::https://user:***@h/r` — and any `<scheme>://`, one starting with a digit (`1password://`) too. For a `git://` remote set with git to a url carrying a password, `maskUrls` also masks git's look-up line (`unable to look up user:***@h (port 9418)`), and every exec turns git's trace output off (`TRACE_OFF` in `BASE_ENV`), whose `run_command` lines print the userinfo without a scheme too. Git config and the undo journal (in memory, never sent) keep the real url, so undo, redo and the re-add of a removed remote restore it. A remote's other config values (a proxy, a pack command) an undo or redo writes back are recorded as `***` (`redactArgv`, `src/activity/log.js`).
- **Urls** typed in the UI pass `remoteUrl` (`src/git/remote/url.js`) or are refused `BAD_URL`: `http(s)://`, `ssh://`, `git+ssh://`, `ssh+git://`, `git://`, `file://`, an absolute path, scp-like `[user@]host:path`. Never a `<transport>::` url (a remote helper, its name starting with a letter or a digit: `1foo::x` runs `git-remote-1foo`; `ext::` runs a command), a leading `-`, a host starting with `-`, whitespace or control characters, a `git://` url carrying userinfo, its `@` literal or encoded `%40` (`git://user:pw@h/r`, `git://user:pw%40h/r`: the git protocol cannot authenticate, and git prints the authority back without its scheme — `unable to look up user:pw@h (port 9418)` — where no url mask finds it; the refusal never echoes the url), or more than `URL_MAX` characters. Submodule urls follow the same rule (`submoduleUrl`, `urlProblem`).
- **New names** pass `newRemoteName`: git's own rule (a valid `refs/remotes/<name>/…`) and no `=` (git would split a push's `-c remote.<name>.mirror=false` there), else `BAD_REF`.
- **Edit** writes only the fields sent; the UI sends only what changed, and never a field still holding the mask. The server backs that: a field equal to `maskUrl` of the raw list's single value is unchanged (not sent: nothing written, the stored password kept; an edit left writing nothing records no undo entry); any other url whose password is exactly `***` (`isMaskedUrl`) is refused `BAD_URL` before any write (a masked value skips `remoteUrl` in the params, `editedUrl`, so a `<transport>::<url>` remote's echoed mask still counts as unchanged) — a changed host, path or user never gets the stored password. `remote.add` refuses a masked url or push url too (Copy URL copies the masked one). A raw url list with several values (an empty reset counts) is refused (`REMOTE_CONFIG_UNSUPPORTED`); `remote.list` reports the same count as `multiUrl` / `multiPushUrl` (`multiValued` in `src/git/remote/config.js`), so the UI disables that field.
- **Rename** only for the default refspec `+refs/heads/*:refs/remotes/<name>/*`, the one shape git rewrites; git moves the tracking refs (HEAD alias included) and rewrites `branch.<b>.remote`.
- **Remove**: git deletes the remote's `refs/remotes/` refs its fetch refspecs map (except those another remote also maps) and every `branch.<b>.remote` / `.merge` naming it. Local branches and tags stay.
- **Legacy remotes** (no url in config, read from `.git/remotes/<name>` or `.git/branches/<name>`): listed (`legacy: true`), never edited, renamed or removed.

### Fetch

- One command per remote: `-c gc.auto=0 -c maintenance.auto=false fetch --no-recurse-submodules --prune|--no-prune --no-prune-tags --end-of-options <remote>` (`fetchArgs` in `src/git/remote/fetch.js`).
- **Pruning only when asked** (`prune: true`, the UI's confirmation): `--prune` / `--no-prune` is always explicit, so `fetch.prune` / `remote.<r>.prune` prune nothing unasked; `--no-prune-tags` always, so no tag is ever pruned.
- **Destinations**: a fetch refspec writing outside `refs/remotes/` and `refs/tags/` (a `+refs/heads/*:refs/heads/*` mirror would move `code-conductor/*` branches) refuses `REMOTE_CONFIG_UNSUPPORTED` before anything runs.
- **Symbolic refs**: every ref the fetch may write (its refspecs' destinations, and `refs/tags`) is read first; a live symbolic one other than the remote's HEAD alias (`refs/remotes/<r>/HEAD` → a ref of the same destination pattern) refuses `SYMBOLIC_REF` with `ref` and `target`. A **dangling** one is invisible until something creates its target; a fetch can (a tag it follows), so after the fetch each symbolic ref live then and not before is reported in `symrefsResolved` (`{ref, target}`), and the UI warns. Verified with git 2.55: fetch itself leaves a symbolic tracking ref and its target alone; the checks do not rely on that.
- **Every remote** (`remote: null`): each remote with a url (or legacy file) in `git remote` order, one after another; a failure about one remote (`REMOTE_*`, `SYMBOLIC_REF`, `GIT_FAILED`, `GIT_TIMEOUT`, `OUTPUT_TOO_LARGE`) is that remote's `error` and the others still run. A push-only remote is skipped.
- **Partial**: git exiting non-zero after changing some refs → `partial` (its stderr); after changing none → the refusal.
- **Cancellable**: objects are written before refs and each ref update is atomic, so an abort leaves a consistent subset of tracking refs updated and at most a temporary pack (gc removes it); the index and worktree are never touched, and gc/maintenance never run mid-fetch. `FETCH_HEAD` may be partial; nothing reads it.

### Pull

Never `git pull`: a fetch of the upstream's remote (`fetchRemote`, the same checks as `remote.fetch`, never pruning) and then one integration (`src/git/remote/integrate.js`), each with the config that would reshape it overridden on the command line, so `pull.*` is never read.

| HEAD vs the fetched upstream | `ff` (fast-forward if possible) | `ffOnly` | `rebase` |
|---|---|---|---|
| same, or HEAD ahead | `upToDate` | `upToDate` | `upToDate` |
| behind | `merge --ff-only` → `fastForward` | the same | the same |
| diverged | a merge commit "Merge remote-tracking branch '`<remote>/<b>`'" → `merged`; conflicts → `conflicts` with `files`, **the merge stays in progress** | `NOT_FAST_FORWARD` (fetched, HEAD unchanged) | `rebase` → `rebased`; conflicts → `conflicts` with `files`, **the rebase stays in progress** |

- **Before anything runs**: `BARE_REPO`; `OPERATION_IN_PROGRESS` while a merge, rebase, cherry-pick or revert is in progress, `CONFLICTED` while paths are unmerged (`assertNoOperation`); `NO_UPSTREAM` for a detached HEAD, no upstream, a local upstream (`branch.<b>.remote = .`) or one naming no configured remote; `NO_HEAD` for an unborn HEAD. Rebase only: a `code-conductor/*` HEAD needs `ccOwned` (a rebase rewrites the branch; a fast-forward or merge only adds, as a commit does), and tracked changes refuse `DIRTY_WORKTREE` (untracked files do not count).
- **Overrides**: `merge.autoStash=false` (no hidden stash; local changes in the way → `CHECKOUT_CONFLICT`), `rebase.autoStash=false`, `rebase.updateRefs=false` (a rebase would otherwise move every other branch pointing into the rebased range, `code-conductor/*` ones included), `rebase.autoSquash=false`, `rebase.backend=merge`, `rebase.rebaseMerges=false` (`REBASE` in `integrate.js`, shared by every rebase), `--no-stat` on the merge.
- **Conflicts policy**: a merge or rebase pull's conflicts stay in progress for the user — resolve, stage, then **Continue** (`head.continue`), or **Abort** (`head.abort {which: 'merge' | 'rebase'}`) from the toast or the Changes banner ([merge → The stop rule](merge.md#the-stop-rule); `onRebaseStopped` in `integrate.js` is the single place that decides). Any other failed rebase is aborted (`rebase --abort`, exit 128 when nothing was in progress), then `CHECKOUT_CONFLICT` (untracked files in the way) or `GIT_FAILED`.
- **Not cancellable**: aborting mid-merge or mid-rebase would leave the checkout half-integrated. Its fetch still never prompts and stops at `NETWORK_LIMITS.timeoutMs`.

### Peek

`remote.peek` asks the remote where one branch is (`ls-remote --refs --end-of-options <remote> refs/heads/<b>`, the exact name kept: ls-remote matches path tails) and compares the tracking ref here: `stale` = they differ. Read-only; the UI's force-with-lease flow uses it.

## Undo

Every write returns `undo` (`undoRecord`; shape in [protocol](protocol.md#remote-ops-srcgitopsremotejs)). `remote.add`, `remote.edit`, `remote.rename` and `remote.remove` are undoable from the header (plans and steps: [undo → Per-op plans](undo.md#per-op-plans)); `remote.fetch` (the auto-fetch too) is journal-neutral: never undone, and it keeps the slots ([undo → Fetch neutrality](undo.md#fetch-neutrality)); `remote.pull` and `remote.push` clear them.

| Op | Destroys | Undo / redo |
|---|---|---|
| `remote.add` | nothing | undo removes the config (refused `UNDO_STALE` once the remote was fetched); redo writes `undo.remotes[].new` again |
| `remote.edit` | the replaced url / push url | the lists that differ set back to `old` / again to `new` |
| `remote.rename` | the old name | renamed back / again (`git remote rename`: refs and branch keys follow) |
| `remote.remove` | the remote's config (every `remote.<name>.*` key), its tracking refs, the `branch.<b>.remote` / `.merge` / `.pushRemote` and `remote.pushDefault` naming it | undo writes the config and those keys back, then re-creates the refs (a symbolic one with `symbolic-ref`); redo asks first (it deletes the listed tracking refs) |
| `remote.fetch` | the tracking refs' previous positions, pruned refs | not undoable (journal-neutral); `undo.refs[]` holds each ref's `old` |
| `remote.pull` | HEAD's position (rebase: the original commits stay in the reflog) | `reset --hard <undo.head.old.oid>` locally; the fetch's refs as `remote.fetch` |
| `head.abort` `merge` | the conflicted merge's partial result | — |

## Known limitations

- **Fetch destinations are restricted** to `refs/remotes/` and `refs/tags/`: a mirror-style refspec refuses the fetch.
- **A remote tag cannot be deleted while a fetch refspec maps tags onto themselves** (`+refs/tags/*:refs/tags/*`): git would delete the local tag through that mapping too, so `tag.deleteRemote` refuses `REMOTE_CONFIG_UNSUPPORTED`. Pushing a tag under it works (git writes the tag the value it was pushed from).
- **Rename needs the default refspec**; anything else is renamed with git.
- **Edit refuses a url list with several values.**
- **A url whose password span is exactly `***` is read as the mask** (`isMaskedUrl`; the span runs from the first `:` after `scheme://` to the value's last `@`): add refuses it `BAD_URL`, and so does edit, unless it equals the current value's mask — then the field counts as unchanged and nothing is written. Set such a password with git. A span that only holds the mask is not refused: `https://user:***@h/r@` (its span is `***@h/r`) is accepted and stored as typed.
- **Remove's undo restores each key's values, not their place in `.git/config`**: the section comes back at the end of the file ([undo → Residuals](undo.md#residuals)).
- **No progress**: cc's exec is buffered; a long fetch shows an elapsed timer until `NETWORK_LIMITS.timeoutMs`.
