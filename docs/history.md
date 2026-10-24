> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md) · [graph](graph.md)

# File history, blame and the reflog

A file's commits across renames, who last changed each line, and where HEAD and each branch have been. Wire shapes: [protocol → History ops](protocol.md#history-ops-srcgitopshistoryjs-all-reads-cancellable). Gotchas behind the design: `.wiki/gotchas/history.md`.

## Ops

| Op | What | Pages by |
|---|---|---|
| `history.file` | the commits that touched a path, following renames (`log --follow -M`), newest first; each names the file as it was there and a rename's old name | re-walk + slice, bounded by `HISTORY_LIMITS.followMaxCommits` (`--skip` is broken under `--follow`: [protocol → Paging convention](protocol.md#paging-convention-for-ops-that-list)) |
| `history.blame` | per line: the commit, its line number there, the text; each commit's author, mail, time, summary, file name, previous commit and `previousPath` (the file's name in that previous commit: the old name after a rename); paths unquoted from git's C quoting | `-L <start>,+<count>`, `count` ≤ `blameLinesMax` |
| `history.reflog` | HEAD's or a local branch's reflog: selector, oid, time, action, who, subject | `--skip` |
| `history.paths` | every file of a commit (`ls-tree -r`) | one command, refused over `pathsMaxOutputBytes` |

- **Frozen start.** The client sends a concrete oid (`rev`), never `HEAD`: pages stay stable while refs move. The reflog has no such anchor: it pages by `--skip` and a refresh reloads it from 0.
- **The repo's config cannot reshape them**: `LOG_SAFE` on the log-family commands; blame and the numstat with `--no-textconv`; blame with `--no-ignore-revs-file` (a configured `blame.ignoreRevsFile` — missing, it would kill blame — is dropped; `-c blame.ignoreRevsFile=` cannot clear it).
- **A binary file has no blame** (`BINARY_FILE`: its numstat is `-`); a path that is not a file in `rev`: `PATH_NOT_IN_COMMIT`.
- **The reflog's time** comes from `%gd` under `--date=unix` (`<ref>@{<unix time>}`); the selector is computed (`skip + i`), never read from git.

## UI (`frontend/src/features/history/`)

| Surface | What |
|---|---|
| **File history** panel (`HISTORY_PANEL`, center, on demand) | The file's path and the commit it starts from; **History** / **Blame** toggle; **Show in graph** (closes the panel and jumps to the picked commit). History: a list (short SHA, subject, author, date, "renamed from ‹old›") paged with **Load more**; the picked commit's change to the file in the viewer beside it, through the diff's own views with the shared **Diff / File**, **Hunk / Full**, **Inline / Split** and **Ignore whitespace** toggles |
| Blame (same panel) | Every line with its line number; at each run's first line the commit's short SHA, author and date, with the author's colour (the graph's lane palette, by first appearance); clicking it picks that commit in History (with its old name when it renamed the file, so the viewer shows the rename's own change). Pages of `BLAME_PAGE` lines load as the list scrolls near its end (or **Load more lines**) |
| **Reflog** panel (`REFLOG_PANEL`, center, on demand) | **Reflog of** HEAD or a local branch; each entry's selector, action, short SHA, subject and time; **Load more**; **Reload reflog**. Row menu (⋮ or right-click; context `'reflog-entry'`, ctx `{tab, entry}`): **View changes**, **Create branch here…**, **Reset HEAD to here** › Soft / Mixed / Hard (hard through its confirmation dialog), **Copy SHA** |

| Opened from | Item |
|---|---|
| A commit's file (details panel, context `'file'`) | **File history**, **Blame** (not for a file the commit deletes), at that commit |
| A diff's file (`'diff-file'`, one file: the file list bound to an open diff — the details, the Changed files panel, the narrow Files dialog) | **File history**, **Blame**, at the diff's new commit, else HEAD |
| A tracked Changes row (`'workdir-file'`) | **File history**, **Blame**, at HEAD (not for an untracked or added file) |
| A local branch (`'branch'`) | **Show reflog** |
| The palette | **File history…** / **Blame…** (pick one of HEAD's files, `history.paths`, or type a path), **Reflog** |

- Each panel's **×** (**Close file history**, **Close reflog**) gives the slot back to the graph.
- Entry points: `openFileHistory(tab, {path, rev})`, `openBlame(tab, {path, rev})`, `openReflog(tab, ref?)` (`open.ts`); state per `tabKey` in `state.ts`.
- Everything from git (subjects, blame lines, reflog messages, ref and author names) is rendered as React text; no `href` or `style` is built from it.

## Known limitations

- **History is at most `HISTORY_LIMITS.followMaxCommits` commits deep** (`truncated: true` past it), and each page re-walks from the start.
- **`--follow` is git's**: one file, renames detected per commit; on merge-heavy history git itself can lose or pick the wrong rename.
- **Blame is of a commit only**, never of the working tree's uncommitted lines.
- **The reflog is a snapshot until Refresh.**
