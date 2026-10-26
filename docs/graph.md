> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md#graph-ops-srcgitopsgraphjs-all-reads-cancellable) · [architecture](architecture.md)

# Commit graph

The active checkout's history as a lane graph (center slot), its refs (left slot) and the selection's details (right slot). The graph's own actions only read; write actions are registered by other features on its menus and the drag hook below — branches, tags and HEAD: [refs](refs.md).

## Using it

### Graph panel

| Element | Behaviour |
|---|---|
| Rows | Newest first, children above parents (git's topo order). Row kinds: **commit**; **WIP** — one per cc checkout of the project (main + worktrees) with uncommitted changes, the own checkout first, then the others by name, reading `// WIP`, the checkout's name and its change counts, joined to its HEAD by a dashed edge; **stash** — directly above its base commit, joined to it by a dashed edge |
| Nodes | A commit is an initials avatar in its lane's colour; a merge (≥ 2 parents) a small dot; WIP a dashed hollow circle; a stash a square |
| Lanes | Each lane has one of 8 colours (`LANE_COLOURS`), hue rotations of the theme's `--primary`; a lane keeps its colour along its first-parent chain |
| Ref chips (Branch / Tag column) | Each in its row's lane colour: the checked-out branch (bold, check icon) or, detached, a bare **HEAD** chip; local branches (a remote branch of the same name at the same commit joins the chip, with a cloud icon); other remote branches; tags; the stash selector; **in X** for another checkout of the project at this commit. Up to 2 chips, the rest behind **+N** |
| Hover a chip | Commits the ref reaches **among the loaded rows** stay; the others dim (`data-dimmed`). A ref whose commit is not loaded dims nothing |
| Columns | Branch / Tag, Graph, Commit message always; Author (avatar + name), Date (author time, `Intl.DateTimeFormat` medium date + short time), SHA (7 characters), Changes (file count + insertions/deletions bar; loaded for the visible rows only, 150 ms after scrolling settles) optional. Toggle from the toolbar gear (**Columns**) or a header cell's right-click menu; reorder by dragging a header cell or with **Move left** / **Move right** in that menu (Enter or Shift+F10 opens it from the keyboard); resize by dragging a cell's right edge, or focus its handle (`role="separator"`, "Resize <column>"; Tab from the header cell) and press ← / → (`COLUMN_RESIZE_STEP`), Home / End (minimum / maximum) — `GRAPH_COLUMN_WIDTH_STEP_KEY` / `GRAPH_COLUMN_WIDTH_BOUND_KEY` (`features/graph/keys.ts`) — within `COLUMNS[id].min/max` (`features/graph/columns.ts`); a cancelled drag restores the width and stores nothing, and the menu keys act on the header cell only, never on its handle. The Graph column fits its lanes until resized |
| Paging | `PAGE` rows per request; the next page loads when the viewport bottom is within `PREFETCH_ROWS` of the loaded end. The footer counts the loaded commits. Age markers on loaded rows never move as pages append |
| Age markers | A muted hairline across the row's top edge with a pill (sticky at the list's right edge, so it stays visible when the columns overflow) naming the age of the rows below it (`data-age-marker`, `aria-hidden`; an overlay inside the row, so row height and lanes are unchanged). Computed by `ageMarkers` (`features/graph/ages.ts`) over the loaded rows, top-down, from each commit's **committer** time (`CommitItem.committerTime`; the Date column shows author time). Ladder: `1 hour ago` (≥ 1 h), `3 hours ago` (≥ 3 h), `yesterday` (before local midnight today), `last week` (≥ 7 d), `last month` (≥ 30 d), `3 months ago` (≥ 90 d), `1 year ago` (≥ 365 d), then `N years ago` per further 365 d. A commit's level is the highest rung it has crossed, so the hour rungs never appear below `yesterday`; each rung is marked at most once (a newer commit after a crossing gets nothing) and rungs crossed in one gap collapse into the oldest label. WIP and stash rows are never marked and cross nothing; the first row has no gap above it, so a crossing there is consumed without a marker. A time that is not a representable date is skipped. "Now" is `GraphData.loadedAt`, the clock of the last successful refresh: markers do not tick between refreshes |
| Refresh | The toolbar's refresh button (also reloads every checkout's summary) |

**Selection** (GitKraken's): a click selects one row and opens its details — a WIP row opens its checkout's **Changes panel** instead (`openWip`, `features/workdir/entry.ts`; another checkout's in that checkout's tab), without taking the keyboard focus from the list; clicking the only selected row again deselects it; Shift-click selects the range from the last clicked row; Ctrl/⌘-click adds or removes one row (WIP rows included). Right-click a row of a multi-selection for the selection's menu.

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

**Jumps** — clicking a ref, a pinned-ref icon, a stash or a worktree in the refs panel, a parent in the details panel, **Jump to commit** in a ref menu, or a search match that is not loaded yet pages forward until the commit is loaded, then selects it and scrolls it to the middle. A jump requested while a diff is shown closes the diff first, so the graph is back to show it. While it pages: "Loading… N commits" (**Stop** or Esc cancels). After `SEEK_PAGES` pages: "Not within the first N commits" with **Load more**; when the snapshot ends first: "Not in the visible graph" (a SHA search match need not be reachable from the visible refs). A page that fails ends the jump silently: the page-error banner says why, with **Retry**. A load already running (the first load, a refresh, the scroll prefetch) is waited for and does not count against `SEEK_PAGES`.

**Drag** — drag a branch chip (graph or refs panel; local or remote) onto another branch chip: the target is highlighted (`data-drop-active`), Esc cancels, dropping on itself does nothing. A drop opens the `branch-drop` menu: Fast-forward and Reset ([refs](refs.md#where-the-actions-are)); with no action applying, nothing opens. **Double-click** a chip runs its primary action (a branch: Checkout; a tag: Jump to commit).

**Untrusted text** (subjects, names, refnames, paths) is shown cut to `DISPLAY_MAX` characters (`lib/clip.ts`), in text and tooltips; a commit body to `BODY_SHOWN` until **Show the whole message**; at most `CO_AUTHORS_SHOWN` co-authors. Copy actions copy the whole value. The Tree view nests at most `MAX_TREE_DEPTH` directories.

**Context menus** — commit, multi-selection, WIP, stash, branch, tag, remote, worktree and file menus. The graph's own actions (after the write actions of [refs](refs.md#where-the-actions-are)):

| Menu | Actions |
|---|---|
| Commit | Show details, View changes, Compare with working directory, Copy SHA, Copy message (the full message; the subject when it cannot be read); on the HEAD commit also C4's **Edit HEAD message…** (order 300: the Changes panel with Amend ticked and HEAD's message loaded) |
| Multi-selection | View combined diff (when the selection has one), Copy N SHAs (newline-separated) |
| Branch / tag | Jump to commit, Copy name, Hide / Show (not offered for the checked-out branch), Solo / Unsolo; branches also Pin to left / Unpin |
| Remote | Hide remote / Show remote, Solo remote / Unsolo remote, Show all (while something on that remote is hidden) |
| Stash | C8's **Apply**, **Apply with staged changes**, **Pop**, **Create branch…**, **Rename…**, **Drop…** (order 400–405: [stash](stash.md)); Show details (not while the Stashes section is hidden: there is no stash row to select), View changes, Copy message, Hide stashes |
| WIP | C8's **Stash changes…** (the own checkout only); C4's **Show changes** (its Changes panel), View unstaged changes, View staged changes; another checkout's also Open X in a tab |
| Worktree | Open in a tab (a cc checkout), Copy path |
| File | C8's **Apply this file** (a stash's file: into the working tree only); Copy path |

### Diffs

The graph opens diffs through the diff viewer's `openDiff` (`features/graph/diffWiring.ts`); the diff replaces the graph in the center slot until it is closed.

| From | Opens |
|---|---|
| A file in the details panel | `{kind: 'commit', rev: <commit>}` at that file (a merge against its first parent, as listed; a stash against its base) |
| **Enter** on the list, or **View combined diff** in the details panel | the selection: one commit or stash → that commit; one WIP row → its checkout's Changes panel, not a diff (its rows open the per-file unstaged / staged diffs); two or more commits → `{kind: 'commits', oids, wip}` (`wip` when the own checkout's WIP row is selected too). A selection with a stash or another checkout's WIP row among several rows opens nothing |
| Commit menu | **View changes** (`commit`), **Compare with working directory** (`worktree`) |
| Multi-selection menu | **View combined diff** (as Enter) |
| WIP menu | **View unstaged changes**, **View staged changes** |
| Stash menu | **View changes** |
| The stash view switch (in a stash's diff header, in place of the parent select) | **All changes** `{kind: 'commit', rev: W, parent: 1}`, **Staged** `{rev: I}`, **Untracked** `{rev: U}` (only with untracked files) ([stash](stash.md#ui-frontendsrcfeaturesstash)) |

Another checkout's WIP opens in that checkout's tab (opened if needed).

### Refs panel

- **Filter refs**: case-insensitive substring of the short name (stashes: selector or subject; worktrees: their name).
- Sections, each collapsible: **Local**, **Remotes** (one group per remote), **Tags**, **Stashes**, **Worktrees** (every git worktree of the project with its cc name, branch or detached commit, **dirty** and **locked** badges; when git cannot list them — git < 2.36 — a notice with git's message).
- **Folders**: in Local, in each remote group and in Tags, refs group by `/` into collapsible folders, listed like the Changes panel's Tree view (`buildFileTree`): folders first, then refs, each by name; a folder with one child is still a folder (no compaction); depth is capped at `MAX_TREE_DEPTH`.
  - A folder is the **full refname prefix ending in `/`** (`refs/heads/code-conductor/`, `refs/remotes/origin/feature/`, `refs/tags/release/`), and only matches refs in its own namespace: a remote `origin`'s `feature/` never matches a remote named `origin/feature`, and `refs/heads/code-conductor/` never matches `refs/heads/code-conductorx`.
  - **Collapse** is stored per project (`collapsedFolders`); folders are expanded by default. While the filter has text, every folder that still has a match shows expanded, its button is disabled, and folders with no match are not listed; clearing the filter brings back the stored collapse. A collapsed folder holding the checked-out branch keeps its name bold. Section and remote-group collapse are not stored.
  - **Pinned** refs stay out of the tree: they sit flat at the top of their list in pin order (the order of the graph's reserved lanes), labelled with their full path inside the namespace, so a collapsed folder never hides a pin. The filter applies to them too.
  - Folder rows have a hide and a solo toggle (**Hide folder `<path>`**, **Solo folder `<path>`**; a tag folder is **tag folder `<path>`**, a remote's **remote `<remote>` folder `<path>`**, so equal paths in different namespaces have distinct names; `folderName` in `features/graph/refTree.ts`) stored as the prefix, so a ref created later under the folder inherits it. They have no context menu, selection, drag or drop; click, Enter or Space toggles collapse. A folder row is dimmed when none of its refs is shown in the graph.
  - Each list shows its first `REFS_SHOWN` rows (folder rows count).
- A row click jumps to its commit; a stash row to its stash row, or — while the Stashes section is hidden — to its base commit. Ctrl/⌘-click and Shift-click select branch rows instead (right-click a selected row for the multi-selection menu), double-click runs the ref's primary action, and local rows show their ahead/behind ([refs](refs.md#where-the-actions-are)). Refs not shown in the graph are dimmed.
- **Row controls** (refs, folders, remote groups, section headers): each toggle is its own button with a stable label (**Pin `<ref>` to left** / **Unpin**, **Hide** / **Show**, **Solo** / **Unsolo**). An inactive toggle sits in an overlay over the end of the name (`data-row-overlay`) that shows on row hover or keyboard focus (`:focus-visible` inside the row — a mouse click on the name does not pin it open), so an idle row reserves no width for it; on a touch screen (`pointer-coarse`) the toggles are always shown (the gradient stays non-interactive, so a tap beside them still hits the name). Activating a toggle from the keyboard keeps focus on it as it moves between the overlay and the flow (when the flipped toggle is disabled — **Show** on the checked-out branch becomes a disabled **Hide** — focus goes to the row's name). A folder's collapse button is named like its toggles (`folder <path>`, `tag folder <path>`, `remote <remote> folder <path>`). An active toggle (pinned, hidden, soloed) stays in flow after the name as a compact indicator; clicking it undoes it. The tracking badge, **Show all** and **Add remote** are always visible. The checked-out branch's eye is disabled, unless it is already hidden (then **Show** is enabled).
- Section headers: eye (hide the section), target (solo the section; not for Stashes), **Show all** while anything in the section is hidden — a hidden ref, remote or folder, or the section itself. Remote group headers: eye and target for the remote, right-click for the remote menu.
- **Visibility rules** (`resolveVisibility`): the **solo set** is every ref matched by a soloed ref, folder, remote or section. If it is not empty the graph shows exactly that set and **every hide is ignored** (a soloed ref inside a hidden folder is shown; a hidden ref or sub-folder inside a soloed folder is shown; solo folder + solo remote is their union). Otherwise the graph shows every ref minus those matched by a hidden ref, folder, remote or section; the checked-out branch is never hidden. A soloed folder with no refs under it has no effect. HEAD and detached worktree HEADs are always graphed unless soloing. A WIP row shows only for a checkout with uncommitted changes: the own checkout's whatever is hidden or soloed; another's when its branch is shown, or when it is detached and nothing is soloed.
- Hide, solo, pin, folder state and the columns persist **per project** (all its checkouts share them) under storage key `code-git:graph:<project>`: `hidden`, `hiddenRemotes`, `hiddenSections`, `hiddenFolders`, `soloed`, `soloedRemotes`, `soloedSections`, `soloedFolders`, `pinned`, `collapsedFolders`, `columns`. A folder entry that is not a `refs/(heads|remotes|tags)/…/` prefix is dropped on load. Names of refs that no longer exist are kept and do nothing. Changing any hide or solo pref reloads the snapshot; `collapsedFolders` and `pinned` do not.
- **Residuals**: the remote menu's **Show all** and the branch menu's Hide / Solo labels do not account for folder hides.

### Details panel

In the right slot the details show while `rightSlotFor` (`features/workdir/rightSlot.ts`) answers `'details'`: no diff open and a commit, stash or several rows selected, or the open diff is the selected commit's or stash's. In the narrow dialog they always show.

| Selection | Shows |
|---|---|
| Nothing | In the right slot: nothing — the slot shows the Changes panel; in the narrow dialog: "Select a commit" |
| One commit or stash | Subject, body (as text), author, committer when different, co-authors (`Co-authored-by:` trailers), full SHA with copy, signature badge (below), parents as buttons that jump, "Changes against the first parent" for a merge ("Changes against parent N" while its diff against parent N is open), and the changed files |
| One WIP row | In the right slot: the Changes panel instead |
| Several | "N selected" and each row's short SHA and subject |

- **Files** ("N files", the shared file list: [features → File lists](features.md#file-lists)): Path or Tree view (`code-git:graph:fileView`, the one choice every file list shares); status letter coloured by `statusClass` (`features/diff/fileTree.ts`); `+added −deleted` from `graph.commit` (**binary**, **submodule** instead); rows carry `data-path`; the first `FILE_RENDER_CAP` then **Show all N**.
  - **Unbound** (no diff of this commit open): a click or Enter publishes the file-open intent (`requestFileOpen`), which opens the commit's diff at that file; right-click or ⋮ for the commit file menu (`CONTEXT.file`).
  - **Bound** (the open diff is this commit's, or one of this stash's views: `diffOwnerCommit`, `features/diff/binding.ts`): the list is the diff's (`DiffFileList`) — its files (a stash's Staged view lists the index commit's), the viewed file highlighted, a click, ↑/↓ or Enter views a file without refetching the list, Ctrl/⌘- and Shift-click select, the menu is the diff's (`'diff-file'`). While the diff's list loads, the commit's own files stand in when they are the same diff (the commit against its first parent), and pick and select as the loaded list will; a pick made there is kept when the list arrives. A failed diff list shows no count and no list here, only "The changed files could not be listed; the diff says why." (the error is the diff's alert).
- **Layout** (one commit or stash): the commit information (subject, body, people, SHA, parents) is a header whose height never depends on the message; it scrolls on its own. Below it, "Changes against…", "N files" and the view toggle stay put above the list, and only the list scrolls; together they fill the rest of the panel.
- **Resizing the header** (right slot only): drag the grip bar below it, or focus the bar (`role="separator"`, "Resize commit information") and press ↑ / ↓ (one step), Home / End (minimum / maximum) — `DETAILS_HEADER_STEP_KEY` / `DETAILS_HEADER_BOUND_KEY` (`features/graph/keys.ts`), the shortcut sheet's **Commit details** section. Default, minimum, the room the files always keep and the step: `DETAILS_HEADER` (`state/detailsHeader.ts`). The maximum is the panel's height less the bar and the files' room, re-applied when the panel shrinks; the chosen height is kept and comes back when the panel grows (a key that cannot move a clamped header stores nothing). A drag stores its height on release; a cancelled one (a touch turned into a scroll, a lost pointer capture) puts the height back and stores nothing; one cut short by the panel unmounting (another commit selected, the slot switching panels) stores nothing, and the next mount renders the stored height. One height for every commit and tab, persisted as `code-git:graph:detailsHeader`.
- **Narrow dialog**: the header keeps the default height, with no grip bar (the dialog is one scroller: a taller header would only push the files further down it), and the dialog scrolls.
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
  3. a write op run on the same project ending, with no other run of the project running — once per run (or per overlapping set of runs), never between its commands (`watchGraph` → `onSettledWrite` over `activityStore`'s runs, which the always-mounted activity panel refetches on every SSE event; [architecture → Write op runs](architecture.md#write-op-runs));
  4. the window regaining focus or becoming visible, at most once per `FOCUS_THROTTLE_MS`, for the active tab — catches agents committing in cc worktrees; another open tab is marked and refreshed when it is shown again; skipped while a write run of the project is in flight (its end refreshes);
  5. a hide/solo change (re-resolves the tips of the refs already read, no refs re-read).
  Triggers 3–5 run from the first show until the tab closes, whether or not the graph panel is mounted: a diff replaces it in the center slot, and closing the diff shows the snapshot as the triggers left it.
  Concurrent triggers coalesce: one run in flight plus one queued rerun.
- **A run**: `graph.refs`, cc's worktree list and the `repo.summary` of every checkout of the project (at most `SUMMARY_CONCURRENCY` at once, into the shared summary store) — on the first show without the own checkout's, which the header has just loaded; then the tips. Unchanged tips: only labels, WIP rows and the layout update. Changed tips: pages are read (`RELOAD_CHUNK` at a time) until as many rows as before are loaded (at least `PAGE`), then swapped in with **one** store update — the old rows stay meanwhile.
- **Kept across a swap**: the first visible row stays at the same offset (else the first surviving selected row is scrolled to); the selection keeps the rows that still exist.
- **Kept across a remount** (a diff closed, a tab shown again): the same scroll anchor and search query and mode (`viewMemory`), and the focus goes back to the list when the panel that replaced the graph took it away.
- **Errors**: a failing `graph.page` (e.g. a tip garbage-collected) triggers one refresh; when the tips did not move, the error stays with **Retry**. A failing refs read shows the error with **Retry**, keeping any rows already shown. A cancel (from the activity panel) is not an error.

## Lane layout

Pure, in `features/graph/layout.ts`; `extendLayout(state, inputs)` continues exactly where the previous page stopped, so page-by-page equals all-at-once.

- Each lane slot holds the oid it waits for, its colour and whether it is dashed. Per row: the lanes waiting for the row converge into its column — a pinned tip's reserved lane, else the lowest waiting lane, else the first free slot (reserved slots skipped), else a new one at the end. The first parent continues in that column with its colour; each further parent reuses a lane already waiting for it or opens a free slot with the next colour. A row with no parents frees its column. Lanes never shift sideways; trailing free slots are trimmed.
- **Pins**: pinned branches' commits reserve lanes 0…k-1 in pin order; a reserved lane stays empty until its tip row arrives (possibly in a later page).
- A WIP row links to its HEAD only once that commit is loaded, and a stash is placed only above a loaded base, so no lane waits for a row that may never arrive.
- **Bounded by the drawn width, not by the number of refs**:
  - A row stores only its node's edges — `in` (lanes ending in it) and `out` (lanes it continues into). A line that merely passes through rows is stored once, as a lane run (`Span`: lane, colour, the rows it starts and ends at) in the layout state, and drawn only for the rendered rows (`passThroughs`).
  - Only the first `LANE_CAP` lanes are drawn one by one; every lane past it is drawn in one overflow gutter (a node there is drawn in the gutter too, `data-overflow`), and an edge is stored once per drawn shape. So a row draws at most `LANE_CAP + 1` pass-through lines plus its node's `LANE_CAP + 1` in- and out-edges, however many branches are open.
  - The tips are clamped to `TIPS_MAX` (the most one `graph.page` request takes): HEAD and detached worktree HEADs first, then the checked-out branch, local branches, remotes, tags. A notice says how many were left out; hiding or soloing refs chooses which.
  - The refs panel lists the first `REFS_SHOWN` rows of each list, with **Show more**; the filter finds the rest.
- Rendering: one SVG per row (numeric attributes only), each node edge a line or a cubic curve within its half-row, each pass-through one straight line; test hooks `data-edge="top|bottom|through" data-from data-to`, the row's `data-col`.

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
