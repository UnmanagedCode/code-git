> See also: [README](../README.md) · [protocol](protocol.md) · [architecture](architecture.md)

# Features

## Shell

- Full-width page: the tab bar, the active checkout's header, the panel slots (`left`, `center`, `right`, `bottom`), and the repo picker dialog. It caps no content width, so it does not read `--cc-session-width`.
- Follows cc's light/dark theme live when embedded; standalone, follows the OS (`frontend/public/theme-init.js`). No theme toggle of its own.
- With no tab open the center shows "No repository open." and an **Open a repository** button.
- The center slot holds a placeholder for the commit graph, or — while one is open for the active tab — the diff (an **on-demand** panel replaces its slot's other panels until it closes). The left slot holds the Compare panel; the bottom slot holds the activity panel.
- **Below the `lg` breakpoint the left and right slots are hidden**, and with them the Compare picker; diffs then open from the graph.

## Repo picker

Opened by **+** in the tab bar (label "Open repository") or the empty-state button.

| Element | Behaviour |
|---|---|
| List | Every cc project from `GET api/repos`, none filtered out. Grouped by `workspace` (alphabetical; "No workspace" last), projects alphabetical |
| Filter | "Filter projects" text box; case-insensitive substring of the project name or its workspace |
| System badge | Projects whose `system` is not `local`: `<system> · <remoteId>` (e.g. `docker · cc-box`) |
| "no commits" badge | `unbornHead` projects |
| Disabled row | The name and the expand chevron are disabled and the reason shows under the name, as text |
| Expand (chevron, "Show worktrees of …") | Loads `GET api/repos/:project/worktrees`; lists **(main checkout)** then each worktree with its branch, and a **locked** badge on a worktree locked in cc |
| Pick | Clicking a project name opens its main checkout; clicking a checkout row opens it. The dialog closes |

Disabled reasons, first match wins (`disabledReason` in `frontend/src/state/useRepos.ts`):

| Field | Shown text |
|---|---|
| `degraded` | cc's message (unreadable project record) |
| `systemUnreachable` | cc's message |
| `gitRefusal` | git's refusal (e.g. dubious ownership, with its `safe.directory` fix) |
| `isGitRepo === false` | "not a git repo" |

A failed listing shows the error with **Retry**.

## Tabs

- One tab per checkout, labelled `project` or `project/worktree`. Opening an already-open checkout activates its tab.
- Click activates; × closes. Closing the active tab activates its right neighbour, else its left one.
- **Shortcuts:** Ctrl+1…Ctrl+8 (⌘ on macOS) activate tab 1…8; Ctrl/⌘+9 the last tab. Shift or Alt with them does nothing. Only while focus is inside the plugin frame.
- **Tab menu** (⋮ button, or right-click the tab): **Close**, **Close others** (only with more than one tab), **Copy name** (`project/worktree` to the clipboard).
- Tabs persist in `localStorage` key `code-git:tabs`. The active tab is mirrored into the URL query (`?project=…&worktree=…`); loading such a URL opens that checkout beside the persisted tabs, and Back/cc navigation (`popstate`) activates the tab the URL names.

## Repo header

The active checkout's `repo.summary`, loaded when the tab is first shown.

| Field | Shown as |
|---|---|
| Title | `project` or `project/worktree` |
| System | Badge for a non-local System |
| HEAD | Branch name; **detached** badge + the first 10 characters of the commit id; or the unborn branch name + **no commits yet** badge |
| Upstream | `no upstream`, or the upstream name with ↑ahead ↓behind |
| Changes | `N staged`, `N unstaged`, `N untracked`, `N conflicted` (non-zero counts emphasised; conflicted in the destructive colour) |
| Refresh | Reloads the summary (spins while loading) |
| Error | `NOT_A_REPO`: "Not a git repository" plus git's stderr in a block; any other refusal: its message. A refresh the user cancelled from the activity panel is not an error: the previous summary stays |

## Activity panel

Bottom slot, collapsible (the **Activity** toggle). Newest entry first.

| Element | Behaviour |
|---|---|
| Status icon | running (spinner), ok, failed, refused, timeout, cancelled |
| Row | op name, checkout, duration (a live seconds counter while running), `exit N`, the refusal code (not shown for cancelled) |
| argv | The full command, as text |
| Show output | Expands stderr (hook output included); a truncated stderr is marked "…(earlier output dropped)" |
| Cancel | Only on a **running** entry whose op allows cancel: reads yes; writes only where the op opts in |
| Filter | **This tab** / **All** (All by default; This tab needs an open tab) |
| "N running" | Count beside the toggle |

Updates arrive over server-sent events; each event triggers a refetch of the log. The log lives in the backend's memory, so it survives a page reload but not a backend restart.

## Compare panel

Left slot. Picks what to diff, until the commit graph offers it. Hidden below `lg`.

| Section | Controls | Opens |
|---|---|---|
| Working directory | **Unstaged changes (n)** — n = unstaged + untracked from the repo summary; **Staged changes (n)** | the unstaged / staged diff |
| Commit | "Commit (sha or ref)" text box; **Show commit**; **Compare with working directory** | the commit vs its parent; the commit vs the working directory |
| Two refs | "From" and "To" text boxes; a `..` / `...` toggle (`..` default); **Compare** | `from..to`, or from their merge base with `...` |

Typed refs are trimmed; a button stays disabled while its box is empty. The diff's file list is fetched first: a refusal (`BAD_REF`, `REV_UNKNOWN`, `NO_MERGE_BASE`, …) is shown under that section as an alert, and no diff opens.

## Diff

Center slot, per tab: each tab keeps its own diff; switching tabs shows that tab's diff, or its graph when none is open; closing a tab drops its diff. **Close diff** (×) or Esc closes it. Diff sources and their rules: [protocol](protocol.md#diff-sources).

**Header:** the source (`Commit <oid7>`, `Unstaged changes`, `main...side (merge base <oid7>)`, `3 commits <oldest7>…<newest7>`, …); a **vs parent N** select on a merge commit; **Refresh** (refetches the list — how work in progress is updated); **Create patch** ▾; **Close diff**.

**File list** ("Changed files"; above the viewer below `md`): status letter (A added, M modified, D deleted, R renamed, C copied, T type changed, U conflicted, ? untracked), path (`old → new` for a rename), `+added −deleted`. Click views a file; Ctrl/⌘-click toggles it in the selection; Shift-click extends the selection; ↑/↓ move through the files. Row menu (⋮ or right-click), on the selection when the row is in it, else on the row: **Copy path**, **Create patch from selection (download)**, **Copy patch of selection**.

**Viewer toolbar** (the choices persist in `localStorage` key `code-git:diff-prefs`):

| Control | Behaviour |
|---|---|
| Hunk / Inline / Split | Hunk: changed hunks with N context lines and their `@@` headers. Inline: the whole file, unified. Split: the whole file, old beside new, each side numbered |
| Diff / File | File: the new side's full content (the old side for a deleted file), numbered, no +/− markers |
| Whitespace | Show all; ignore at line end; ignore amount; ignore all. Reloads the list too |
| Context lines | 0, 1, 3 (default), 5, 10, 25 — Hunk mode only |
| Wrap lines | Wraps long lines instead of scrolling (Split clips them when off) |
| Syntax highlighting | On by default |
| ↑ / ↓, "change k of n" | Previous / next change block, scrolled to the centre |
| ← / → | Previous / next file |

- Changed words within a paired deleted/added line are emphasised.
- **Keys** (only while focus is inside the diff): Alt+↑ / Alt+↓ previous / next change; Ctrl/⌘+F opens **Find in file** (case-insensitive, both sides in Split; "k/n"; Enter / Shift+Enter next / previous); Esc closes the search, else the diff.

**File states:**

| State | Shown |
|---|---|
| Oversized (more changed lines than `DIFF_LIMITS.oversizeLines`) | "Large diff (N changed lines)" + **Show anyway**; nothing is fetched before |
| Binary | "Binary file — not shown" |
| Conflicted | "Conflicted file — resolve it first" |
| Submodule (gitlink) | "Submodule pointer `<old7> → <new7>`" (— for an absent side), a **dirty** badge for a dirty worktree side |
| Git LFS pointer | A card with each side's object id (12 characters) and size; **Show pointer** shows the pointer text |
| Over the file cap | "Too large to display (over N MB)"; in Inline, Split or File view also **Switch to Hunk mode** |
| Empty file added / deleted | "Empty file added" / "Empty file deleted" |
| No content change (rename-only, mode-only, whitespace hidden) | "No content changes" + the mode or rename line |
| List over its cap | An alert: the diff is too large to list; no file list |

**Create patch** ▾: **Download .patch**, **Copy patch**; with more than one file selected also the same two for the selected files only (a renamed file brings its old path, so the rename stays a rename). A selection needing more than `PATCH_MAX_PATHS` paths (`features/diff/patch.ts`, equal to `DIFF_LIMITS.maxPaths`) is refused in the header before any request: use the whole-diff patch. A commit, or a run of commits without merges, gives a mailbox patch (`git am`); anything else a plain diff (`git apply`), binary changes included, untracked files not. The file name comes from the backend. A failed request is shown as an alert in the header.
