> See also: [README](../README.md) · [protocol](protocol.md) · [architecture](architecture.md)

# Features

## Shell

- Full-width page: the tab bar, the active checkout's header, the panel slots (`left`, `center`, `right`, `bottom`), and the repo picker dialog. It caps no content width, so it does not read `--cc-session-width`.
- Follows cc's light/dark theme live when embedded; standalone, follows the OS (`frontend/public/theme-init.js`). No theme toggle of its own.
- With no tab open the center shows "No repository open." and an **Open a repository** button.
- The center slot holds the commit graph, or — while one is open for the active tab — the diff (an **on-demand** panel replaces its slot's other panels until it closes). The left slot holds the refs panel and the Compare panel, the right slot the Changes panel or the commit details (Changes while nothing or a single WIP row is selected in the graph, the details for a commit, a stash or several rows), the bottom slot the activity panel.
- **Below the `lg` breakpoint the left and right slots are hidden**; the graph's toolbar opens the refs panel and the Compare picker as dialogs (**Refs**, **Compare**), the commit details open as a dialog when a commit is clicked, and **Changes (n)** beside **Refs** and **Compare** (or a WIP row click, or Ctrl/⌘+Shift+M) opens the Changes panel as a dialog.

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

## Commit graph

The active checkout's history: a lane graph with ref labels, a WIP row per dirty checkout and stash rows; columns (Author, Date, SHA, Changes optional; reorder, resize); search by message/author/SHA or by path, through git; keyboard navigation and multi-select; hover highlight; context menus; branch-onto-branch drag. The refs panel hides, solos and pins refs (per project, persisted); the details panel shows the selected commit's message, people, signature, parents and files (path or tree). Full behaviour: [graph](graph.md).

## Changes panel

Right slot, while the graph has nothing or a single WIP row selected (below `lg`: the **Changes (n)** dialog from the graph's toolbar). Stage, unstage, discard and commit. Opened from the graph by clicking a WIP row (or Enter on it, or its menu's **Show changes**) and by **Edit HEAD message…** on the HEAD commit's menu, which ticks Amend with HEAD's message. Ops: [protocol → Staging ops](protocol.md#staging-ops-shared-rules).

| Part | Behaviour |
|---|---|
| Header | **Changes**, **Stash changes…** (disabled with nothing to stash; [Stash](#stash)), **Reload changes** (↻), ⋮ menu: **Refresh**, **Apply patch…** |
| Detached banner | On a detached HEAD: "Detached HEAD at `<oid10>`. A commit made here is on no branch." |
| Error | The last failed op's message and git's stderr (hook output) as text; × dismisses it |
| **Unstaged Files (n)** | Worktree changes and untracked files (`?`). Header: **Discard all…**, **Stage all**. Row hover (always shown on a touch screen): discard (↶, not on a conflicted file), stage (+), ⋮. A list longer than `FILE_RENDER_CAP` (`lib/clip.ts`) shows that many rows, then **Show all N** |
| **Staged Files (n)** | Index changes. Header: **Unstage all**. Row hover: unstage (−), ⋮ |
| Row | Status letter, path (`old → new` for a rename). Click or Enter opens its unstaged / staged diff at that file. Right-click or ⋮: **Stash this file…**, **Stage** / **Unstage**, **Discard…**, **Copy path**, then the ignore items below |
| Commit box | **Summary** (one line), **Description**, ☐ **Amend previous commit**, ☐ **Skip Git hooks**, then the commit button(s) |

**Discard** always asks first and sends nothing until confirmed: a file ("Discard changes to …?" / "Delete …?" for an untracked file), or **Discard all…**, which lists every untracked file it deletes with their count. Both say "This cannot be undone." Discard all throws away exactly the unstaged and untracked files shown; staged changes and ignored files stay, and conflicted files are left untouched — the confirmation says how many.

**Ignore** (row menu), into the root `.gitignore` (left unstaged):

| File | Items |
|---|---|
| Untracked | **Ignore '‹name›'**; **Ignore all '*.ext' files** (when the name has an extension; a dotfile like `.env` has none); **Ignore folder '‹dir›/'** (when the file is in a folder) |
| Tracked | The same three as **Ignore and stop tracking …** — confirmed first; the matching tracked files leave the index and stay on disk |

**Apply patch…**: a patch file, or pasted text; apply to **Working tree** (default) or **Index only**. **Check** lists the files and line counts it changes; **Apply** is enabled only after a successful check of the same bytes and target. A patch that does not apply shows git's message; one over `APPLY_PATCH_MAX_BYTES` (`features/workdir/api.ts`, equal to `STAGE_LIMITS.applyPatchMaxBytes`) is refused before any request. There is no "both" target: apply to the working tree, then stage.

**Commit button**

| Mode | Button(s) | Enabled when |
|---|---|---|
| Commit | **Commit changes to N files** (N = staged files; "(detached HEAD)" on a detached HEAD); **Commit** while nothing is staged | a summary, something staged or a merge in progress, and the draft is not the unedited commit template |
| Amend (ticked) | **Amend commit** (staged changes + the message) and **Update message only** (the message alone; the staged changes stay staged) | a summary; Update message only also needs the message changed from HEAD's |

- Ticking **Amend** loads HEAD's message into the fields and keeps the draft aside; unticking puts the draft back.
- **Commit template** (`commit.template`): pre-fills the box once per tab while it is empty and Amend is off, and again after each commit; "Template: ‹path›" under the button names the file it was read from; a template problem (missing, binary, …) shows there instead.
- After a commit the box goes back to the template (or empty) and Amend is unticked; a failed commit keeps the draft.

**Keys** (only while focus is inside the plugin frame)

| Key | Action |
|---|---|
| ↑ / ↓ | Move between rows of a list |
| S / U | Stage the focused unstaged row / unstage the focused staged row (not while typing) |
| Ctrl/⌘+Shift+S / Ctrl/⌘+Shift+U | Stage all / unstage all |
| Ctrl/⌘+Shift+M | Focus the summary (below `lg`, opens the Changes dialog) |
| Ctrl/⌘+Enter (in the commit box) | Commit (Amend commit in amend mode) |
| Ctrl/⌘+Shift+Enter (in the commit box) | Stage all, then commit |

The lists load when the tab is first shown, on Refresh and after every op; there is no file watcher. Every op also reloads the repo header and an open unstaged/staged diff.

## Branches and tags

Write actions on the graph's branch, tag, commit and drop menus, a dialog for each destructive one, double-click to check out (a tag: jump), a toolbar **Branch** button (Ctrl/⌘+B), multi-select delete in the refs panel and ahead/behind badges on local branches. Full behaviour, the checked-out and `code-conductor/*` rules: [refs](refs.md).

## Merge, rebase and conflicts

What is in progress in a checkout — a merge, rebase, cherry-pick or revert, or conflicts left by a squash merge or a stash — shows as a banner in the Changes panel, after a reload too, with **Continue**, **Skip** and **Abort…**. A pull that stops on conflicts, merge or rebase, stays in progress the same way. Details: [merge](merge.md).

## Remotes

Graph toolbar **Fetch**, **Pull** (split: the default mode, and a menu of the three modes, the default, Fetch all (prune)… and Auto-fetch) and **Push**; remote rows in the refs panel (**Add remote**, Fetch, Fetch (prune)…, Edit…, Remove…, Copy URL); **Push** / **Push to `<remote>`…** on a local branch and on a drop onto a remote branch; force-with-lease after a rejected push; **Push after commit** in the commit box. Full behaviour: [remotes](remotes.md).

## Toasts

Bottom right (sonner, following the theme). A one-click op shows its progress ("Pushing v1 to origin…") and is replaced in place by its outcome: success, a warning with an action (a conflicted cherry-pick offers **Abort**) or the refusal with git's stderr. Errors stay `ERROR_MS` (`lib/opToast.ts`). An op run from a dialog shows its progress and refusal in the dialog and toasts only its success.

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

Left slot, below the refs panel. Picks what to diff beside the graph's own entry points ([graph → Diffs](graph.md#diffs)). Below `lg` it opens as a dialog from the graph toolbar's **Compare** button.

| Section | Controls | Opens |
|---|---|---|
| Working directory | **Unstaged changes (n)** — n = unstaged + untracked from the repo summary; **Staged changes (n)** | the unstaged / staged diff |
| Commit | "Commit (sha or ref)" text box; **Show commit**; **Compare with working directory** | the commit vs its parent; the commit vs the working directory |
| Two refs | "From" and "To" text boxes; a `..` / `...` toggle (`..` default); **Compare** | `from..to`, or from their merge base with `...` |

Typed refs are trimmed; a button stays disabled while its box is empty. The diff's file list is fetched first: a refusal (`BAD_REF`, `REV_UNKNOWN`, `NO_MERGE_BASE`, …) is shown under that section as an alert, and no diff opens.

## Diff

Center slot, per tab: each tab keeps its own diff; switching tabs shows that tab's diff, or its graph when none is open; closing a tab drops its diff. **Close diff** (×) or Esc closes it. Diff sources and their rules: [protocol](protocol.md#diff-sources).

**Header:** the source (`Commit <oid7>`, `Unstaged changes`, `main...side (merge base <oid7>)`, `3 commits <oldest7>…<newest7>`, …); a **vs parent N** select on a merge commit, or on a stash the **All changes / Staged / Untracked** switch ([Stash](#stash)); **Refresh** (refetches the list — how work in progress is updated); **Create patch** ▾; **Close diff**.

**File list** ("Changed files"; above the viewer below `md`): status letter (A added, M modified, D deleted, R renamed, C copied, T type changed, U conflicted, ? untracked), path (`old → new` for a rename), `+added −deleted`. Click views a file; Ctrl/⌘-click toggles it in the selection; Shift-click extends the selection; ↑/↓ move through the files. Row menu (⋮ or right-click), on the selection when the row is in it, else on the row: **Apply file from stash** (one file of a stash's All changes or Untracked view), **Copy path**, **Create patch from selection (download)**, **Copy patch of selection**.

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

**Hunk and line staging** — only on an unstaged or staged diff of a modified (`M`) text file, with **Show all whitespace** and the Diff view (not File view); not on added, deleted, renamed, untracked, binary, submodule, conflicted or LFS-pointer files, nor on commit or compare diffs:

| Control | Unstaged diff | Staged diff |
|---|---|---|
| Hunk header (Hunk mode) | **Stash hunk…** (the file has nothing staged), **Discard hunk…**, **Stage hunk** | **Unstage hunk** |
| Gutter toggle on each added/removed line (Hunk, Inline, Split) | click selects or unselects ("Select added line N" / "Select removed line N"); Shift-click selects every change line from the last clicked one | same |
| Selection bar ("k lines selected") | **Stage lines**, **Discard lines…**, **Stash lines…** (the file has nothing staged), **Clear** | **Unstage lines**, **Clear** |

- Within a run of removed and added lines, the i-th removed line pairs with the i-th added one (as Split shows them): staging only that pair replaces that line.
- Discarding asks first and previews the removed/added lines. A refusal shows in the header: the file changed since it was shown (reload it), or a selection that leaves out the end-of-file newline change.
- After each action the selection clears and the diff, the Changes lists and the header reload.

**Restore file to this version…** (file list menu, one file, when the diff's new side is a commit — a commit, a range or two refs; not for a deleted file or a submodule): after a confirmation, puts that commit's version of the file in the index and the working tree, overwriting uncommitted changes to it.

**Create patch** ▾: **Download .patch**, **Copy patch**; with more than one file selected also the same two for the selected files only (a renamed file brings its old path, so the rename stays a rename). A selection needing more than `PATCH_MAX_PATHS` paths (`features/diff/patch.ts`, equal to `DIFF_LIMITS.maxPaths`) is refused in the header before any request: use the whole-diff patch. A commit, or a run of commits without merges, gives a mailbox patch (`git am`); anything else a plain diff (`git apply`), binary changes included, untracked files not. The file name comes from the backend. A failed request is shown as an alert in the header.

## Stash

Save work aside and bring it back. Ops and their rules: [stash](stash.md). Every stash action shows its progress and outcome as a toast (bottom right) and reloads the Changes lists, the header, an open unstaged/staged diff and the graph.

**Save** — from the Changes header's **Stash changes…**, the own WIP row's menu, a Changes row's **Stash this file…** (Selected files, that file ticked), or the diff's **Stash hunk…** / **Stash lines…**:

| Control | Behaviour |
|---|---|
| **Stash message** | Optional; one line. Without one git writes "WIP on ‹branch›: ‹commit›" |
| **All changes** | Every tracked change, staged and unstaged |
| **Selected files** | A checkbox per changed file (both lists, one row per path); a rename stashes both paths; ticking an untracked file ticks **Include untracked files** and keeps it ticked |
| **Staged only** | What is staged; the two checkboxes are disabled. Needs git ≥ 2.35 on the project's System |
| ☐ **Include untracked files** | Also stash (and remove) untracked files |
| ☐ **Keep staged changes** | The stash takes everything, and what was staged stays staged in the working tree |
| Lines mode (from the diff) | "N lines of ‹path›" and the message only. Offered on an unstaged diff of a file with nothing staged; the selection clears after the stash |

A refusal (nothing to stash, a conflict in progress, a path behind an untracked symlink, …) stays in the dialog with git's message. When git failed after already storing the stash, a toast also says "A stash was created despite the error" and names it. A save made at the same moment as an identical one from another session says "Stashed (another stash was saved at the same moment: check the stash list)".

**Stash rows** (graph and the refs panel's Stashes section) — right-click:

| Action | Behaviour |
|---|---|
| **Apply** / **Apply with staged changes** | Into the working tree; the stash stays. "With staged changes" restores what was staged as staged |
| **Pop** | Apply, then drop the stash. With conflicts the stash is kept |
| **Create branch…** | A new branch at the commit the stash was made on, checked out, the stash applied with its staged part and dropped when it applied cleanly. On a `code-conductor/*` checkout it asks first (as checkout does) |
| **Rename…** | A new message; "A renamed stash moves to the top (stash@{0})." |
| **Drop…** | Asks first ("Drop stash@{n}?" with the subject), then removes the stash |

- **Apply with staged changes** with other changes staged: when git refuses, the staging is put back as it was (git itself would leave it unstaged).
- No confirmation for apply or pop: git refuses to overwrite a local change — the toast says "Local changes would be overwritten" and names the files ("Commit, stash or discard these changes first."); nothing is written. That includes a file with *any* local change, even one the stash would merge cleanly into.
- Conflicts: "Applied stash@{n} with conflicts in N files", the files named; the conflicted files show in the Changes panel (`U`).

**View** — **View changes** (stash menu) or the details panel's **View changes**: the diff header's switch shows **All changes** (staged and unstaged together, against the stash's base), **Staged** (what was staged), **Untracked** (only for a stash with untracked files).

**One file** — **Apply this file** (the details panel's file menu, on a stash) or **Apply file from stash** (the diff's file menu, on All changes or Untracked): the file's change goes into the working tree only, as a patch — all of it or nothing; a file that differs from the stash's base is refused, never overwritten. Pop is whole-stash only.

