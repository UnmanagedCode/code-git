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
| Blame (same panel) | Every line with its line number; at each run's first line the commit's short SHA, author and date, with the author's colour (the graph's lane palette, by first appearance); clicking it **drills**: the file is blamed again at that run's `previous` commit under its `previousPath` (renames followed), so each line shows who wrote it before. A run whose commit added the file (no `previous`) is `aria-disabled`, marked **added**, and does nothing. Each drill is a frame of the stack `blameStack` (`state.ts`); the header's breadcrumb (`nav` "Blame revisions", one crumb per frame, the path shown where it changes) and **Back** return to a frame without a request and scroll to the line clicked there. A ⋮ on each run's header, or a right-click on its lines, opens the run menu (below). Lines are syntax-highlighted with the diff's tokenizer and the shared **Syntax** preference. Pages of `BLAME_PAGE` lines load as the list scrolls near its end (or **Load more lines**) |
| Blame run menu (⋮ or right-click on a run; context `'blame-run'`, ctx `{tab, line, commit, path}`) | **Blame previous revision** (only with a `previous`), **Show in History** (picks the commit, with its old name when it renamed the file, so the viewer shows the rename's own change), **Show in graph** (closes the panel and jumps to the commit), **Copy SHA** |
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
- Blame highlighting (`blameHighlight.ts`, `blameSegments`): the tokenizer gets the file's own text, line 1 through the last loaded line, as one string (as the diff tokenizes a side) and runs again when a page arrives, so a page or author-run boundary never splits a comment or string. Each drill frame uses its own path's language. A file whose `total` is over `HIGHLIGHT_MAX_LINES` is plain from its first page.
- Everything from git (subjects, blame lines, reflog messages, ref and author names) is rendered as React text; no `href` or `style` is built from it.

## Known limitations

- **History is at most `HISTORY_LIMITS.followMaxCommits` commits deep** (`truncated: true` past it), and each page re-walks from the start.
- **`--follow` is git's**: one file, renames detected per commit; on merge-heavy history git itself can lose or pick the wrong rename.
- **The last loaded lines of a highlighted blame can be provisional**: a construct still open at the end of the loaded text (a template string needing its closing backtick) is coloured by what is loaded; the next page corrects it, and the near-end loader usually fetches it first.
- **A later page can turn the whole blame plain**: a line over `HIGHLIGHT_MAX_LINE_CHARS`, or the loaded text passing `HIGHLIGHT_MAX_SIDE_CHARS`, switches highlighting off for the frame (the diff's per-side rule). A file over `HIGHLIGHT_MAX_LINES` is plain from the start.
- **A drill lands near the clicked line, not on it**: the line did not exist in the earlier version, so the view scrolls to the clicked line's number in the clicked commit (`origLine`), loading pages serially up to it first.
- **`previous` is absent** for the commit that added the file, a root commit and a shallow clone's boundary commit: those runs cannot drill.
- **Blame is of a commit only**, never of the working tree's uncommitted lines.
- **The reflog is a snapshot until Refresh.**
