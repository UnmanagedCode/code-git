> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md#remote-ops-srcgitopsremotejs) · [refs](refs.md) · [architecture](architecture.md)

# Remotes

Talking to other repositories: the remotes' config (add, edit, rename, remove), fetch, peek. Ops and their wire shapes: [protocol](protocol.md#remote-ops-srcgitopsremotejs).

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

- **Urls** typed in the UI pass `remoteUrl` (`src/git/remote/url.js`) or are refused `BAD_URL`: `http(s)://`, `ssh://`, `git+ssh://`, `ssh+git://`, `git://`, `file://`, an absolute path, scp-like `[user@]host:path`. Never a `<transport>::` url (a remote helper; `ext::` runs a command), a leading `-`, a host starting with `-`, whitespace or control characters, or more than `URL_MAX` characters.
- **New names** pass `newRemoteName`: git's own rule (a valid `refs/remotes/<name>/…`), else `BAD_REF`.
- **Edit** writes only the fields sent; the UI sends only what changed, so a masked `displayUrl` is never written back. A url list with several values is refused (`REMOTE_CONFIG_UNSUPPORTED`).
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

### Peek

`remote.peek` asks the remote where one branch is (`ls-remote --refs --end-of-options <remote> refs/heads/<b>`, the exact name kept: ls-remote matches path tails) and compares the tracking ref here: `stale` = they differ. Read-only; the UI's force-with-lease flow uses it.

## Undo

Every write returns `undo` (`undoRecord`; shape in [protocol](protocol.md#remote-ops-srcgitopsremotejs)). Nothing in the UI reads it yet.

| Op | Destroys | Recoverable |
|---|---|---|
| `remote.add` | nothing | `remote remove` (`undo.remotes[].new` is what was created) |
| `remote.edit` | the replaced url / push url | write `undo.remotes[].old` back |
| `remote.rename` | the old name | rename back |
| `remote.remove` | the remote's config, its tracking refs, the upstream config naming it | locally: re-add from `undo.remotes[].old` (urls, push urls, fetch refspecs, each `branch.<b>.remote`/`.merge`), `update-ref` each `undo.refs[]` (a symbolic one with `symbolic-ref`) |
| `remote.fetch` | the tracking refs' previous positions, pruned refs | `update-ref` each `undo.refs[]` back to `old` (until the next fetch) |

## Known limitations

- **Fetch destinations are restricted** to `refs/remotes/` and `refs/tags/`: a mirror-style refspec refuses the fetch.
- **Rename needs the default refspec**; anything else is renamed with git.
- **Edit refuses a url list with several values.**
- **Remove's undo restores url, push url, fetch refspecs and upstreams only**; other `remote.<name>.*` keys (`prune`, `tagOpt`, `receivepack`, …) and `branch.<b>.pushRemote` are gone.
- **No progress**: cc's exec is buffered; a long fetch shows an elapsed timer until `NETWORK_LIMITS.timeoutMs`.
