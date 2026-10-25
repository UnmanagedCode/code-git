# Git LFS

A thin wrapper over the git-lfs CLI installed on the project's System. Ops: `src/git/ops/lfs.js`; detection: `src/git/lfs/detect.js`; parsers: `src/git/lfs/parse.js`; the root `.gitattributes`: `src/git/lfs/attributes.js`; caps: `LFS_LIMITS` (`src/git/lfs/limits.js`); wire shapes: [protocol → LFS ops](protocol.md#lfs-ops-srcgitopslfsjs).

## Floor and detection

- **git-lfs ≥ 3.2.0** (`LFS_FLOOR`): the first with `git lfs ls-files --json`. Tested on 3.3.0 and 3.6.1; a fixture captured from each pins the parser (`tests/fixtures/lfs-<version>-ls-files.json`).
- `git -c alias.lfs= lfs version` (exit 0 or 1): without git-lfs, git would expand a repository's `alias.lfs` (a `!` alias runs a shell command, on a read), so the probe empties it; git's `expansion of alias 'lfs' failed` (or `'lfs' is not a git command`; exit 1 under `LC_ALL=C`, git 2.39 and 2.55 alike) is `available: false`. An installed git-lfs runs before any alias; any other failure is `GIT_FAILED`; a first line not matching `^git-lfs/(\d+)\.(\d+)\.(\d+)` is `GIT_FAILED` ("unrecognised git-lfs version").
- Every LFS write first runs `assertLfs`: absent → `LFS_UNAVAILABLE`; below the floor → `GIT_TOO_OLD {feature: 'git-lfs', need: '3.2.0', have}`.
- **code-git never runs `git lfs install`.** The LFS filter config is the System's; `lfs.status` reports whether `filter.lfs.process` is set (`filters`).

## What writes, and what only reads

Every git-lfs command but `version` may write into the repository: `track`, `untrack` (listing included: `track --json`, `--dry-run`), `ls-files`, `pull` and `prune` create `.git/lfs/{objects,tmp}`, and install git-lfs's four hooks (`pre-push`, `post-checkout`, `post-commit`, `post-merge`) when the System has the LFS filter configured (`track` and `untrack` without it too; `pull` through the checkout it makes). With a hook of another program already at one of those names, git-lfs installs none of them, keeps that hook and still exits 0. `tests/ops-lfs.test.js` pins both from a smudge-skipped clone.

So:

- **`lfs.status` is a read and runs only `git lfs version` and plain git**: `config --get filter.lfs.process`, and the root `.gitattributes` read through `diff --no-index` (`readNoIndex`, never through a symlink). A test asserts it leaves `.git` byte-identical.
- **The file list is `lfs.files`, a write** (`journal: 'neutral'`: it keeps the undo slots), run only when the user asks (**List files**).
- **git itself runs git-lfs's filter.** In a repository with LFS files whose System configures the filter, `git status` and `git diff` — `repo.summary` and the Changes panel's reads included — run git-lfs's clean filter, which creates `.git/lfs` and installs the hooks the same way. That is the System's filter config at work, not an LFS op.

## Patterns: the root `.gitattributes`

`lfs.status` lists the patterns of the root `.gitattributes` whose line ends up with `filter=lfs`, read by `parseLfsAttributes` the way git's attribute parser reads them:

- blank lines and `#` comments skipped; tokens split on space, tab, CR, LF;
- a pattern starting with `"` is C-unquoted (`\"`, `\\`, `\a \b \f \n \r \t \v`, octal `\ooo` bytes) and listed as data; one git cannot unquote is a plain token, as git reads it;
- `[attr]` macro lines and `!` negative patterns (git ignores those) skipped;
- the last `filter` token of a line decides (`filter=lfs -filter` is not LFS);
- patterns decoded as UTF-8.

A root `.gitattributes` that is a symlink, a directory, binary or over `LFS_LIMITS.attributesMaxBytes` answers `attributes: 'unsupported'`, `patterns: null`; `lfs.track` and `lfs.untrack` refuse a symlink or non-regular file with `ATTRIBUTES_UNSUPPORTED` (git-lfs would write through it). A FIFO (or a symlink to one) refuses `lfs.status`, `lfs.track` and `lfs.untrack` with `PROBE_TIMEOUT` within `DIFF_LIMITS.probeTimeoutMs`: git opens it, so the probe is bounded rather than stat-only. A file swapped for a FIFO between the probe and the content read refuses `READ_TIMEOUT` within `DIFF_LIMITS.contentReadTimeoutMs` (`lfs.status`, `lfs.untrack`'s reads of the patterns).

## Ops

Every git-lfs command but `version` runs as `git --no-literal-pathspecs lfs …`: under the runner's `GIT_LITERAL_PATHSPECS=1` (`BASE_ENV`) `git lfs pull` checks nothing out and still exits 0. No user-named argument is a pathspec (a pattern goes into `.gitattributes`, after `--`).

| Op | Runs | Notes |
|---|---|---|
| `lfs.status` | `-c alias.lfs= lfs version`; when usable: `config --get filter.lfs.process` (exit 0 or 1), the root `.gitattributes` | Nothing after `version` when git-lfs is absent or too old |
| `lfs.files` | `assertWorktree`, `assertLfs`; `lfs ls-files --json` (`LFS_LIMITS.listMaxOutputBytes`, else `OUTPUT_TOO_LARGE`) | Fields read: `name`, `size`, `oid`, `downloaded` (the ones 3.3.0 has); a missing one is `null`; `files: null` is `[]`; malformed output is `GIT_FAILED` |
| `lfs.track` | gates; `lfs track -- <pattern>` | git-lfs writes the line (`<pattern> filter=lfs diff=lfs merge=lfs -text`; a space as `[[:space:]]`) |
| `lfs.untrack` | `assertWorktree`, `assertLfs`; the patterns before; `assertAttributesWritable`; `lfs untrack -- <pattern>`; the patterns after | `removed`: a pattern line left the file |
| `lfs.pull` | `assertWorktree`, `assertLfs`; `NET_CONFIG lfs pull` through `netRun`, `LFS_LIMITS.netTimeoutMs` | A network or auth failure is `GIT_FAILED` with git-lfs's stderr (its wording is not `classifyRemoteFailure`'s); credentials only from the System, as every remote command |
| `lfs.prune` | `assertWorktree`, `assertLfs`; `lfs prune` | git-lfs's own retention: objects not pushed yet, and those of HEAD and of recent refs and commits (`lfs.fetchrecent*`, `lfs.pruneoffsetdays`), are kept |

- **Pattern check** (`checkPattern`): 1…`LFS_LIMITS.patternMaxLength` characters, no control character, no whitespace at either end, no leading `-` (an option), `#` (a comment), `!` (a negative pattern) or `"` (a quoted pattern) → else `BAD_PARAMS`.
- None is cancellable; none has an undo (the writes clear the slots; `lfs.files` keeps them).

## UI

- **Repository actions** → **LFS…**, and the palette's **LFS…**, open the LFS dialog (`features/lfs/`, one store `state/lfsDialog.ts`, `LfsHost` mounted by `Shell`).
- On open it posts `lfs.status` only. It shows git-lfs's version; "not installed", or the version and the 3.2.0 floor, when unusable; a note when the filter is not configured (run `git lfs install` on the System).
- The tracked patterns, each with **Untrack**; a pattern field with **Track**.
- **List files** (its helper text: git-lfs may create `.git/lfs` and install its hooks while it lists) → path, size, downloaded. Once listed, the list is read again after each LFS op in that dialog session.
- **Pull**; **Prune…** switches the dialog to a destructive confirmation step (Cancel returns to the dialog).

## Known limitations

- Patterns in nested `.gitattributes` files, `.git/info/attributes` or `core.attributesFile` are not listed (their files still show in **List files**).
- The file list is HEAD's LFS files as git-lfs lists them, at most `FILES_SHOWN` (`features/lfs/LfsDialog.tsx`) rows in the dialog.
- `lfs.pull`'s failures are not classified as auth or unreachable: the toast shows git-lfs's own message.
- **Residual risk — swapping `.gitattributes` under git-lfs's own open.** code-git's own reads of the file are bounded (`PROBE_TIMEOUT` at the probe, `READ_TIMEOUT` when the file is swapped for a FIFO before the content read). What remains is git-lfs's own open. `assertAttributesWritable` is the last command before `lfs track` / `lfs untrack`, but git-lfs opens `.gitattributes` by path in its own process, and nothing code-git runs can hold that file or pin its inode for it, so the check is adjacent to the write, never atomic. A local writer who swaps the file for a symlink in the milliseconds between the two gets the pattern line appended to the link's target. A swap to a FIFO makes git-lfs itself block for up to the write timeout, holding the project lock. Both need write access to the checkout. There is no check after the write: it would catch only a swap left in place, and would report a write already made as refused.
