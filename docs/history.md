> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md) · [graph](graph.md)

# File history, blame and the reflog

A file's commits across renames, who last changed each line, and where HEAD and each branch have been. Wire shapes: [protocol → History ops](protocol.md#history-ops-srcgitopshistoryjs-all-reads-cancellable). Gotchas behind the design: `.wiki/gotchas/history.md`.

## Ops

| Op | What | Pages by |
|---|---|---|
| `history.file` | the commits that touched a path, following renames (`log --follow -M`), newest first; each names the file as it was there and a rename's old name | re-walk + slice, bounded by `HISTORY_LIMITS.followMaxCommits` (`--skip` is broken under `--follow`: [protocol → Paging convention](protocol.md#paging-convention-for-ops-that-list)) |
| `history.blame` | per line: the commit, its line number there, the text; each commit's author, mail, time, summary, file name and previous commit | `-L <start>,+<count>`, `count` ≤ `blameLinesMax` |
| `history.reflog` | HEAD's or a local branch's reflog: selector, oid, time, action, who, subject | `--skip` |
| `history.paths` | every file of a commit (`ls-tree -r`) | one command, refused over `pathsMaxOutputBytes` |

- **Frozen start.** The client sends a concrete oid (`rev`), never `HEAD`: pages stay stable while refs move. The reflog has no such anchor: it pages by `--skip` and a refresh reloads it from 0.
- **The repo's config cannot reshape them**: `LOG_SAFE` on the log-family commands; blame and the numstat with `--no-textconv`; blame with `--no-ignore-revs-file` (a configured `blame.ignoreRevsFile` — missing, it would kill blame — is dropped; `-c blame.ignoreRevsFile=` cannot clear it).
- **A binary file has no blame** (`BINARY_FILE`: its numstat is `-`); a path that is not a file in `rev`: `PATH_NOT_IN_COMMIT`.
- **The reflog's time** comes from `%gd` under `--date=unix` (`<ref>@{<unix time>}`); the selector is computed (`skip + i`), never read from git.

## Known limitations

- **History is at most `HISTORY_LIMITS.followMaxCommits` commits deep** (`truncated: true` past it), and each page re-walks from the start.
- **`--follow` is git's**: one file, renames detected per commit; on merge-heavy history git itself can lose or pick the wrong rename.
- **Blame is of a commit only**, never of the working tree's uncommitted lines.
- **The reflog is a snapshot until Refresh.**
