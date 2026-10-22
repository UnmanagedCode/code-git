> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md#graph-ops-srcgitopsgraphjs-all-reads-cancellable) · [architecture](architecture.md)

# Commit graph

The active checkout's history as a lane graph (center slot), its refs (left slot) and the selection's details (right slot). Read-only: write actions (checkout, merge, reset, …) are registered by later cards on the menus and the drag hook below.

## Using it

### Graph panel

| Element | Behaviour |
|---|---|
| Rows | Newest first, children above parents (git's topo order). Row kinds: **commit**; **WIP** — one per cc checkout of the project (main + worktrees) with uncommitted changes, the own checkout first, then the others by name, reading `// WIP`, the checkout's name and its change counts, joined to its HEAD by a dashed edge; **stash** — directly above its base commit, joined to it by a dashed edge |
| Nodes | A commit is an initials avatar in its lane's colour; a merge (≥ 2 parents) a small dot; WIP a dashed hollow circle; a stash a square |
| Lanes | Each lane has one of 8 colours (`LANE_COLOURS`), hue rotations of the theme's `--primary`; a lane keeps its colour along its first-parent chain |
| Ref chips (Branch / Tag column) | Each in its row's lane colour: the checked-out branch (bold, check icon) or, detached, a bare **HEAD** chip; local branches (a remote branch of the same name at the same commit joins the chip, with a cloud icon); other remote branches; tags; the stash selector; **in X** for another checkout of the project at this commit. Up to 2 chips, the rest behind **+N** |
| Hover a chip | Commits the ref reaches **among the loaded rows** stay; the others dim (`data-dimmed`). A ref whose commit is not loaded dims nothing |
| Columns | Branch / Tag, Graph, Commit message always; Author (avatar + name), Date (author time, `Intl.DateTimeFormat` medium date + short time), SHA (7 characters), Changes (file count + insertions/deletions bar; loaded for the visible rows only, 150 ms after scrolling settles) optional. Toggle from the toolbar gear (**Columns**) or a header cell's right-click menu; reorder by dragging a header cell or with **Move left** / **Move right** in that menu (Enter or Shift+F10 opens it from the keyboard); resize by dragging a cell's right edge, within `COLUMNS[id].min/max` (`features/graph/columns.ts`). The Graph column fits its lanes until resized |
| Paging | `PAGE` rows per request; the next page loads when the viewport bottom is within `PREFETCH_ROWS` of the loaded end. The footer counts the loaded commits |
| Refresh | The toolbar's refresh button (also reloads every checkout's summary) |

**Selection** (GitKraken's): a click selects one row and opens its details; clicking the only selected row again deselects it; Shift-click selects the range from the last clicked row; Ctrl/⌘-click adds or removes one row (WIP rows included). Right-click a row of a multi-selection for the selection's menu.

**Keyboard** (focus on the list; ignored while typing in a field):

| Keys | Action |
|---|---|
| `j` / `↓`, `k` / `↑` | Next / previous row (selects it); past the last loaded row, loads more |
| `Shift+J` / `Shift+K` (or Shift+arrows) | Next / previous row in the same lane |
| `Ctrl/⌘+Home`, `Ctrl/⌘+End` | First row (WIP when present), last loaded row |
| `Esc` | Stops a running jump, else clears the selection |
| `Shift+F10`, ContextMenu key | The focused row's menu |
| `Ctrl/⌘+F`, `/` | Focus the search box |
| `Enter` | Opens the selection's diff ([Diffs](#diffs)) |
| `Enter` / `Shift+Enter` in the search box | Next / previous match; `Esc` clears the search |

**Search** — one box, two modes (**Commits** / **Path**), 300 ms after typing stops (`SEARCH_DEBOUNCE_MS`); a newer query cancels the previous request.

- **Commits**: a case-insensitive fixed string in the message, or the author's name/email, or — when the query is 4–64 hex characters — a SHA prefix.
- **Path**: commits touching a repo-relative path (literal: `*` and `:(glob)` are characters), with git's default history simplification.
- Matches come from git over the whole snapshot, not only the loaded rows; matching rows are highlighted (`data-match`). The counter reads `i / n` with "(+m not loaded)"; next/previous moves to the nearest loaded match after/before the focused row, and past the last loaded one pages forward to an unloaded match. Over `SEARCH_MAX` matches the counter says so ("first N matches").

**Jumps** — clicking a ref in the refs panel, a parent in the details panel, **Jump to commit** in a ref menu, or a search match that is not loaded yet pages forward until the commit is loaded, then selects it and scrolls it to the middle. While it pages: "Loading… N commits" (**Stop** or Esc cancels). After `SEEK_PAGES` pages: "Not within the first N commits" with **Load more**; when the snapshot ends first: "Not in the visible graph" (a SHA search match need not be reachable from the visible refs).

**Drag** — drag a branch chip (graph or refs panel; local or remote) onto another branch chip: the target is highlighted (`data-drop-active`), Esc cancels, dropping on itself does nothing. A drop opens the `branch-drop` menu; with no action registered for it, nothing opens.

**Context menus** — commit, multi-selection, WIP, stash, branch, tag, remote, worktree and file menus. The graph's own actions:

| Menu | Actions |
|---|---|
| Commit | Show details, View changes, Compare with working directory, Copy SHA, Copy message (the full message; the subject when it cannot be read) |
| Multi-selection | View combined diff (when the selection has one), Copy N SHAs (newline-separated) |
| Branch / tag | Jump to commit, Copy name, Hide / Show (not offered for the checked-out branch), Solo / Unsolo; branches also Pin to left / Unpin |
| Remote | Hide remote / Show remote, Solo remote / Unsolo remote, Show all (while something on that remote is hidden) |
| Stash | Show details, View changes, Copy message, Hide stashes |
| WIP | View unstaged changes, View staged changes; another checkout's also Open X in a tab |
| Worktree | Open in a tab (a cc checkout), Copy path |
| File | Copy path |

### Diffs

The graph opens diffs through the diff viewer's `openDiff` (`features/graph/diffWiring.ts`); the diff replaces the graph in the center slot until it is closed.

| From | Opens |
|---|---|
| A file in the details panel | `{kind: 'commit', rev: <commit>}` at that file (a merge against its first parent, as listed; a stash against its base) |
| **Enter** on the list, or **View changes** / **View combined diff** in the details panel | the selection: one commit or stash → that commit; one WIP row → its checkout's unstaged changes (staged when only staged changes are pending); two or more commits → `{kind: 'commits', oids, wip}` (`wip` when the own checkout's WIP row is selected too). A selection with a stash or another checkout's WIP row among several rows opens nothing |
| Commit menu | **View changes** (`commit`), **Compare with working directory** (`worktree`) |
| Multi-selection menu | **View combined diff** (as Enter) |
| WIP menu | **View unstaged changes**, **View staged changes** |
| Stash menu | **View changes** |

Another checkout's WIP opens in that checkout's tab (opened if needed).

### Refs panel

- **Filter refs**: case-insensitive substring of the short name (stashes: selector or subject; worktrees: their name).
- Sections, each collapsible: **Local** (pinned first, with a pin icon that jumps), **Remotes** (one group per remote), **Tags**, **Stashes**, **Worktrees** (every git worktree of the project with its cc name, branch or detached commit, **dirty** and **locked** badges; when git cannot list them — git < 2.36 — a notice with git's message).
- A row click jumps to its commit. Hover a row for its pin (local branches), eye (hide) and target (solo) toggles; active toggles stay visible. The checked-out branch's eye is disabled. Refs not shown in the graph are dimmed.
- Section headers: eye (hide the section), target (solo the section; not for Stashes), **Show all** while anything in the section is hidden. Remote group headers: eye and target for the remote, right-click for the remote menu.
- **Visibility rules** (`resolveVisibility`): any solo (ref, remote or section) shows only the soloed refs, overriding hides; otherwise every ref minus the hidden ones, hidden remotes and hidden sections; the checked-out branch is never hidden. HEAD and detached worktree HEADs are always graphed unless soloing. A WIP row shows for the own checkout always, for another when its branch is shown, or when it is detached and nothing is soloed.
- Hide, solo, pin and the columns persist **per project** (all its checkouts share them) under storage key `code-git:graph:<project>`; names of refs that no longer exist are kept and do nothing.

### Details panel

| Selection | Shows |
|---|---|
| Nothing | "Select a commit" |
| One commit or stash | Subject, body (as text), author, committer when different, co-authors (`Co-authored-by:` trailers), full SHA with copy, signature badge (below), parents as buttons that jump, "Changes against the first parent" for a merge, and the changed files |
| One WIP row | Branch or detached, change counts, **Open worktree** for another checkout |
| Several | "N selected" and each row's short SHA and subject |

- **Files**: Path or Tree view (the choice persists under `code-git:graph:fileView`); status letter coloured A added, D deleted, M modified, R/C renamed/copied (with `old → new`); the first `FILE_RENDER_CAP` then **Show all N**. A click opens the commit's diff at that file (and publishes the file-open intent) and marks the row; right-click for the file menu.
- A commit whose file list is over the output cap shows its metadata and "Too many changes to list." instead of the files.
- **Signature badge** (git's `%G?`): G Signed (good), U Signed (unknown validity), X Expired signature, Y Expired key, R Revoked key, B Bad signature, E Unverified (cannot be checked); N (unsigned) shows none. Hover for git's signer and key.

### Narrow screens

Below Tailwind's `lg` (`WIDE_GRAPH_QUERY`, 64rem) the side slots are hidden: the graph toolbar's **Refs** and **Compare** buttons open the refs panel and the diff's Compare picker in dialogs, and clicking a commit (or **Show details**) opens the details in a dialog.

## Snapshot and refresh

- **Snapshot** = the sorted, unique commit oids the graph pages from (`tips`): the visible refs' commits, plus HEAD and detached worktree HEADs unless soloing. Every `graph.page` names the tips explicitly (stdin) with a `skip`, so a page always belongs to its snapshot even if refs move meanwhile. Each snapshot has a `generation`; a page answer for an older generation is dropped.
- A snapshot lives until a refresh finds different tips (`tipsKey`) — any ref move: a commit, fetch, reset or branch change in **any** checkout of the project, since checkouts share refs — or a hide/solo change moves them.
- **Refresh triggers** (no timer):
  1. First show of the tab, once the checkout's own `repo.summary` succeeded (a checkout that is not a repo never loads a graph);
  2. the toolbar's refresh button;
  3. an activity entry of `kind: 'write'` for the same project that has finished and is newer than the last one seen (`watchGraph` reads `activityStore`, which the always-mounted activity panel refetches on every SSE event);
  4. the window regaining focus or becoming visible, at most once per `FOCUS_THROTTLE_MS` — catches agents committing in cc worktrees;
  5. a hide/solo change (re-resolves the tips of the refs already read, no refs re-read).
  Concurrent triggers coalesce: one run in flight plus one queued rerun.
- **A run**: `graph.refs`, cc's worktree list and every other checkout's `repo.summary` (at most `SUMMARY_CONCURRENCY` at once, into the shared summary store); then the tips. Unchanged tips: only labels, WIP rows and the layout update. Changed tips: pages are read (`RELOAD_CHUNK` at a time) until as many rows as before are loaded (at least `PAGE`), then swapped in with **one** store update — the old rows stay meanwhile.
- **Kept across a swap**: the first visible row stays at the same offset (else the first surviving selected row is scrolled to); the selection keeps the rows that still exist.
- **Errors**: a failing `graph.page` (e.g. a tip garbage-collected) triggers one refresh; when the tips did not move, the error stays with **Retry**. A failing refs read shows the error with **Retry**, keeping any rows already shown. A cancel (from the activity panel) is not an error.

## Lane layout

Pure, in `features/graph/layout.ts`; `extendLayout(state, inputs)` continues exactly where the previous page stopped, so page-by-page equals all-at-once.

- Each lane slot holds the oid it waits for, its colour and whether it is dashed. Per row: the lanes waiting for the row converge into its column — a pinned tip's reserved lane, else the lowest waiting lane, else the first free slot (reserved slots skipped), else a new one at the end. The first parent continues in that column with its colour; each further parent reuses a lane already waiting for it or opens a free slot with the next colour. A row with no parents frees its column. Lanes never shift sideways; trailing free slots are trimmed.
- **Pins**: pinned branches' commits reserve lanes 0…k-1 in pin order; a reserved lane stays empty until its tip row arrives (possibly in a later page).
- A WIP row links to its HEAD only once that commit is loaded, and a stash is placed only above a loaded base, so no lane waits for a row that may never arrive.
- Rendering: one SVG per row (numeric attributes only), each edge a line or a cubic curve within its half-row; test hooks `data-edge="top|bottom" data-from data-to`, the row's `data-col`.

## Performance

`harness/playwright/graph-perf.mjs` (seeded) and `live-graph.mjs` (read-only, a live cc) run the same measurement (`graphMeasure.mjs`).

| | |
|---|---|
| Fixture | `tests/_graphFixture.js` defaults: mulberry32 seed 42, 5,000 commits, 60 topic branches of which 45 merged into main, every head mirrored as `origin/<head>`, 78 tags — 200 refs; written with one `git fast-import` |
| Browser | Headless Chromium from code-playwright, viewport 1280×800 |
| Procedure | Open the project; scroll the list 600 px per animation frame to the bottom, repeatedly, until the snapshot is fully loaded; sample the rendered rows every frame, the frame intervals, `longtask` entries, each `graph.page` round trip (`request.timing().responseEnd`) and cc's own `durationMs` for those commands |
| Gates (`graphLimits.mjs`) | At most `MAX_ROWS` rows in the DOM; every `graph.page` round trip within `MAX_PAGE_MS`; no long task over `MAX_LONG_TASK_MS` (a hang guard). `live-graph.mjs` gates the DOM bound only |
| Printed, never gated | p50 / p95 / max frame time, the page count, the list's height, cc's durations |
| Output | `out/graph-perf.json`, `out/live/graph-perf.json` |

## Git versions

What each graph feature needs, and what happens below it. Every feature also needs what C1's `repo.summary` needs (`status --porcelain=v2`, git 2.11): below that no graph opens.

| Feature | Needs | Below it |
|---|---|---|
| Pages, search, stats, refs: `--no-show-signature` on every log-family command | git 2.10 | Below C1's floor |
| Worktree labels and the Worktrees section: `worktree list --porcelain -z` | git 2.36 | **Degrades**: `graph.refs` answers `worktrees: null` with git's stderr; no "in X" labels; the Worktrees section shows the notice. Everything else works |
| Commit details' co-authors: `%(trailers:key=Co-authored-by,valueonly,separator=%x1e)` | git 2.22 | **Degrades**: git prints the placeholder literally, which parses as no co-authors; the rest of the details shows. (The oid is passed without `--end-of-options` — it is checked as full hex — so nothing else in `graph.commit` needs a newer git) |
| Annotated tag of a tag: `%(*objectname)` | — | Newer git peels it to the commit; older git peels one level, so the ref has `oid: null` and is not graphed |

## Signing programs

- `%G?` (with `%GS`, `%GK`) makes git verify the commit's signature, which runs the repo's configured signing program — `gpg.program`, `gpg.ssh.program` (or the x509 one) — on the project's System. Only `graph.commit` asks for it, for the one commit shown; `graph.page`, `graph.search`, `graph.stats` and `graph.refs` never do (tests pin their argv).
- Every log-family command passes `--no-show-signature`, so a configured `log.showSignature` cannot make the pages run the signing program per commit or add its output to the records. `--no-ext-diff --no-textconv` keep `diff.external` and textconv drivers — programs — from running.
