> See also: [README](../README.md) · [protocol](protocol.md) · [architecture](architecture.md) · [submodules](submodules.md)

# Features

## Shell

- Full-width page: the tab bar, the active checkout's header, the panel slots (`left`, `center`, `right`, `bottom`), and the repo picker dialog. It caps no content width, so it does not read `--cc-session-width`.
- Follows cc's light/dark theme live when embedded; standalone, follows the OS (`frontend/public/theme-init.js`). No theme toggle of its own.
- With no tab open the center shows "No repository open." and an **Open a repository** button.
- The center slot holds the commit graph, or — while one is open for the active tab — the diff (an **on-demand** panel replaces its slot's other panels until it closes). The left slot holds the refs panel, the Compare panel and the Submodules panel, the right slot the Changes panel, the commit details or the diff's **Changed files** panel (with no diff open: Changes while nothing or a single WIP row is selected in the graph, the details for a commit, a stash or several rows; with a diff open, the list that drives it: [Diff → File lists](#file-lists)), the bottom slot the activity panel.
- **Below the `lg` breakpoint the left and right slots are hidden**; the graph's toolbar opens the refs panel and the Compare picker as dialogs (**Refs**, **Compare**), the commit details open as a dialog when a commit is clicked, and **Changes (n)** beside **Refs** and **Compare** (or a WIP row click, or Ctrl/⌘+Shift+M) opens the Changes panel as a dialog; **Submodules** opens the Submodules panel as a dialog; an open diff's file list opens from the diff header's **Files (n)**.

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

- One tab per checkout, labelled `project` or `project/worktree`; a submodule tab adds ` › path` per submodule (`app › libs/a › b`). Opening an already-open checkout activates its tab.
- Click activates; × closes. Closing the active tab activates its right neighbour, else its left one.
- **Shortcuts:** Ctrl+1…Ctrl+8 (⌘ on macOS) activate tab 1…8; Ctrl/⌘+9 the last tab. Shift or Alt with them does nothing. Only while focus is inside the plugin frame.
- **Tab menu** (⋮ button, or right-click the tab): **Close**, **Close others** (only with more than one tab), **Copy name** (`project/worktree` to the clipboard).
- Tabs persist in `localStorage` key `code-git:tabs`. The active tab is mirrored into the URL query (`?project=…&worktree=…`, plus `&sub=…` per submodule of a submodule tab); loading such a URL opens that checkout beside the persisted tabs, and Back/cc navigation (`popstate`) activates the tab the URL names.

## Repo header

The active checkout's `repo.summary`, loaded when the tab is first shown.

| Field | Shown as |
|---|---|
| Title | `project` or `project/worktree`. A submodule tab: a breadcrumb of its chain (each ancestor a button opening or activating that repo's tab), the submodule's path as the title, and **Back to ‹parent›** (opens or activates the parent's tab, closes this one) |
| System | Badge for a non-local System |
| HEAD | Branch name; **detached** badge + the first 10 characters of the commit id; or the unborn branch name + **no commits yet** badge |
| Upstream | `no upstream`, or the upstream name with ↑ahead ↓behind |
| Changes | `N staged`, `N unstaged`, `N untracked`, `N conflicted` (non-zero counts emphasised; conflicted in the destructive colour) |
| Undo, Redo | Undo / redo the checkout's last registered op ([Undo and redo](#undo-and-redo)); the title names it, a disabled one says why |
| Commands | Opens the command palette (below) |
| Refresh | Reloads the summary (spins while loading) |
| Error | `NOT_A_REPO`: "Not a git repository" plus git's stderr in a block; any other refusal: its message. A refresh the user cancelled from the activity panel is not an error: the previous summary stays |

## Undo and redo

- **Undo** (Ctrl/⌘+Z, the header's **Undo**, the palette's **Undo …**) takes back the checkout's last registered op; **Redo** (Ctrl/⌘+Shift+Z or Ctrl/⌘+Y, **Redo**) runs it again. One step each way, per checkout; a backend restart forgets it.
- **Undoable**: commit (amend and message-only amend too), checkout, branch create / rename / delete / move / fast-forward, tag create / delete, reset (soft, mixed, hard), cherry-pick, revert, merge (fast-forward or merge commit), rebase and interactive rebase, a merge / rebase / cherry-pick / revert finished with Continue or Skip, discarding files, discarding lines; stash save (files, staged, lines), apply, pop, drop, rename, applying one file, creating a branch from a stash (an apply, pop or branch that stopped on conflicts is not, nor an apply that changed nothing); add, edit, rename and remove a remote. A stash put back by an undo or redo comes back at `stash@{0}` (git stores only at the top). **Fetch** (manual or auto) is never undone and keeps both, so the undo before it still runs. Any other change (staging, push, pull, …) clears both, so an undo never runs over it.
- **Asks first** when the undo or redo deletes a branch or tag (listed), discards files again (listed), runs a hard reset (always, even on a clean tree), drops a stash again (the redo of a drop: its message listed), or removes a remote again (the redo of a remove: the remote and its tracking refs listed). Everything else runs at once; its toast ("Undid …") offers the opposite action.
- **Refused, nothing changed**: a commit it would take back is already on a remote (any remote-tracking ref, as last fetched); something changed since (HEAD, a ref, a discarded or stashed file, the index, the stash list, a remote's config, a remote fetched since it was added — then the entry is dropped); a merge / rebase / cherry-pick / revert or conflicts in progress (both buttons disabled with that reason); local changes in the way (stash them and retry); the branch is checked out in another worktree; a `code-conductor/*` branch, which asks first (**Review…**).
- Keys are off while focus is in a text field (its own undo wins) or a dialog is open. Reference: [undo](undo.md).

## File history, blame and the reflog

- **File history** (a file's menu in the commit details, a diff's file list, a tracked Changes row, or the palette's **File history…**): the commits that changed the file, newest first, following renames ("renamed from ‹old›"). Click one to see its change to the file beside the list (Diff or File view; the toolbar shows the change's `+added −deleted`, or **binary**). **Show in graph** jumps to it.
- **Blame** (the same menus, the palette's **Blame…**, or the panel's **Blame** toggle): each line with the commit that last changed it; each run of lines starts with the commit's short SHA, author and date in the author's colour. Click it to see that commit in History. Lines load as you scroll. Binary files have no blame.
- **Reflog** (a local branch's **Show reflog**, the palette's **Reflog**): where HEAD or a branch has been — selector, action, commit, subject, time — with View changes, Create branch here…, Reset HEAD to here (Soft / Mixed / Hard) and Copy SHA on each entry.
- Reference: [history](history.md).

## Command palette and shortcuts

- **Command palette**: Ctrl/⌘+P, or the header's **Commands** button. Type to filter (the letters in order, case-insensitive), ↑/↓ to move, Enter or a click to run, Esc to close. A command that picks (**Checkout branch…**, **Go to tab…**) opens a second list: type to filter it, Enter runs it with the highlighted item, Esc goes back to the commands. Each row shows its group and, when it has one, its shortcut.
- Commands are offered only where they apply (no tab open: only **Show keyboard shortcuts**). They run what the rest of the UI runs, with the same confirmations and toasts: **Undo …** / **Redo …** (named after the entry), **File history…**, **Blame…** (a file of HEAD, or a typed path), **Reflog**, **Show changes**, **Stage all**, **Unstage all**, **Stash changes…**, **Create branch…**, **Checkout branch…** (local branches but HEAD's, then remote branches), **Fetch all remotes**, **Pull** (the project's default mode) and one per pull mode, **Push**, **Go to tab…** (more than one tab), **Close tab**, **Refresh** (the header summary and the graph), **Show keyboard shortcuts**.
- **Keyboard shortcuts sheet**: Ctrl/⌘+/ (or the palette) lists every shortcut by where it acts, generated from the one catalog the key handlers use, so it is always complete.
- Ctrl/⌘+P, Ctrl/⌘+/ and the undo keys do nothing while focus is in a text field or a dialog is open. Ctrl/⌘+P never opens the browser's print dialog from the app.

## Commit graph

The active checkout's history: a lane graph with ref labels, a WIP row per dirty checkout and stash rows; columns (Author, Date, SHA, Changes optional; reorder, resize); search by message/author/SHA or by path, through git; keyboard navigation and multi-select; hover highlight; context menus; branch-onto-branch drag. The refs panel hides, solos and pins refs (per project, persisted); the details panel shows the selected commit's message, people, signature, parents and files (path or tree, with line counts; the list that drives the commit's diff while it is open: [File lists](#file-lists)). Full behaviour: [graph](graph.md).

## Changes panel

Right slot, while the graph has nothing or a single WIP row selected, and while an unstaged or staged diff is open whatever the selection (below `lg`: the **Changes (n)** dialog from the graph's toolbar; also on a wide screen when Ctrl/⌘+Shift+M is pressed while another diff holds the right slot). Stage, unstage, discard and commit. Opened from the graph by clicking a WIP row (or Enter on it, or its menu's **Show changes**) and by **Edit HEAD message…** on the HEAD commit's menu, which ticks Amend with HEAD's message. Ops: [protocol → Staging ops](protocol.md#staging-ops-shared-rules).

| Part | Behaviour |
|---|---|
| Header | **Changes**, the **Path / Tree** toggle (both lists; the one shared File view choice), **Stash changes…** (disabled with nothing to stash; [Stash](#stash)), **Reload changes** (↻), ⋮ menu: **Refresh**, **Apply patch…** |
| Detached banner | On a detached HEAD: "Detached HEAD at `<oid10>`. A commit made here is on no branch." Hidden during a rebase |
| Operation banner | A merge, rebase, cherry-pick or revert in progress (or conflicts left with none): its title, what to do next, **Continue** / **Skip** / **Abort…** ([merge → The operation banner](merge.md#the-operation-banner)) |
| Error | The last failed op's message and git's stderr (hook output) as text; × dismisses it |
| **Unstaged Files (n)** | Worktree changes and untracked files (`?`). Header: **Discard all…**, **Stage all**. Row hover (always shown on a touch screen): discard (↶, not on a conflicted file), stage (+), ⋮. Tree directory: **Stage folder** (+, `Stage folder <dir>`): one `stage.files` of this section's files beneath the directory, conflicted (`U`) files left out (staging one marks it resolved); hidden when only conflicted files are beneath it. No folder Discard (bulk discard is **Discard all…**). A list longer than `FILE_RENDER_CAP` (`lib/clip.ts`) shows that many rows, then **Show all N** |
| **Staged Files (n)** | Index changes. Header: **Unstage all**. Row hover: unstage (−), ⋮. Tree directory: **Unstage folder** (−, `Unstage folder <dir>`): one `stage.unstageFiles` of this section's files beneath it |
| Row | Status letter, path (`old → new` for a rename; its name alone in Tree), line counts of that section's change (none for an untracked or conflicted file). S stages / U unstages the focused row, in both views. Click or Enter opens its unstaged / staged diff at that file — while that section's diff is open, the section drives it instead ([File lists](#file-lists)) and the other section's row opens its own diff; a conflicted (`U`) row opens the merge tool instead, and its menu adds **Open in merge tool**, **Take current (`<label>`)**, **Take incoming (`<label>`)**, **Mark resolved** ([merge → The conflict tool](merge.md#the-conflict-tool)). Right-click or ⋮: **Stash this file…**, **Stage** / **Unstage**, **Discard…**, **Copy path**, then the ignore items below |
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

Merge (fast-forward when possible, no fast-forward, squash) and rebase from the drag menu or a branch's or commit's menu; rebase the newest N commits onto a branch; an interactive-rebase editor (pick, reword, edit, squash, fixup, drop, reordered by drag or keys) that also cherry-picks or squashes N selected commits; a three-pane merge tool for a conflicted file (pick lines from Current and Incoming, edit the Output, save, mark resolved), or take one side. What is in progress in a checkout — a merge, rebase, cherry-pick or revert, or conflicts left by a squash merge or a stash — shows as a banner in the Changes panel, after a reload too, with **Continue**, **Skip** and **Abort…**. A pull that stops on conflicts, merge or rebase, stays in progress the same way. Details: [merge](merge.md).

## Remotes

Graph toolbar **Fetch**, **Pull** (split: the default mode, and a menu of the three modes, the default, Fetch all (prune)… and Auto-fetch) and **Push**; remote rows in the refs panel (**Add remote**, Fetch, Fetch (prune)…, Edit…, Remove…, Copy URL); **Push** / **Push to `<remote>`…** on a local branch and on a drop onto a remote branch; force-with-lease after a rejected push; **Push after commit** in the commit box. Full behaviour: [remotes](remotes.md).

## Git-flow

The graph toolbar's **Repository actions** (⋮) → **Git-flow**: **Initialize…** (later **Git-flow settings…**), **Start feature… / release… / hotfix…**, **Finish ‹HEAD's branch›…**; **Finish feature… / release… / hotfix…** on a flow branch's menu; the palette's **Git-flow: …** commands. Finish merges with `--no-ff` (release and hotfix into main, tagged, then develop), deletes the branch and leaves HEAD on develop; it checks every merge first and changes nothing when one would conflict. Settings are the `gitflow.*` keys the git-flow extension uses. Details: [gitflow](gitflow.md).

## LFS

**Repository actions** → **LFS…** (or the palette's **LFS…**): the System's git-lfs version (or why it cannot be used), the root `.gitattributes`' tracked patterns with **Untrack**, **Track** a pattern, **List files** on request (path, size, downloaded), **Pull**, and **Prune…** behind a destructive confirmation step. Opening the dialog only reads. Needs git-lfs ≥ 3.2.0 on the System; code-git never runs `git lfs install`. Details: [lfs](lfs.md).

## Hooks

| Rule | Behaviour |
|---|---|
| Honoured | Every hook git runs, where git looks for it (`core.hooksPath` included). Nothing skips hooks but the commit box's **Skip Git hooks** (`commit.create`'s `noVerify`) |
| A failing hook | Blocks the op: `GIT_FAILED` with git's stderr, which holds the hook's output (git sends a hook's stdout to stderr). Shown in the commit box's alert, the op's toast, a dialog's refusal; a git-flow finish's `FLOW_INCOMPLETE` carries it as its cause |
| A succeeding hook | Its output is on its command's activity entry (**Show output**) |
| pre-push | git keeps a pre-push hook's stdout on stdout (the push's porcelain output): when the hook fails, the refusal shows that stdout before git's stderr (`push` in `src/git/remote/push.js`); a succeeding one's stdout is not on the activity entry (its stderr is) |
| post-checkout | Runs after the switch: when it fails, HEAD has already moved |
| pre-merge-commit | When it fails, git leaves the merge in progress (`MERGE_HEAD`): the Changes panel's banner offers Continue and Abort |

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

**Files (n)** (header, below `lg` only): the diff's file list as a dialog ("Changed files", with the Path / Tree toggle). A plain click or Enter views the file and closes the dialog; Ctrl/⌘- and Shift-click and ↑/↓ keep it open. **Previous file** / **Next file** (viewer toolbar) follow the list's displayed order: path order, or the tree's order in Tree.

### File lists

The diff has no file list of its own: the list beside it in the right slot drives it. One component renders every list (`features/diff/FileList.tsx`).

| Diff | Its list |
|---|---|
| The commit or stash selected in the graph (a stash's All changes / Staged / Untracked view included; a merge vs any parent) | The commit details' files, bound to the diff (they list the diff's files: a stash's Staged view lists the index commit's) |
| Unstaged / staged changes | The Changes panel's Unstaged / Staged section (shown even with a commit selected) |
| Anything else: Compare panel commit, commit vs working directory, two refs; a combined multi-commit diff; a reflog entry's or another commit's diff not selected in the graph | **Changed files** panel in the right slot: "N files", the Path / Tree toggle, the list |
| Any, below `lg` | **Files (n)** in the diff header (above) |

| Part | Behaviour |
|---|---|
| Row | Status letter (A added, M modified, D deleted, R renamed, C copied, T type changed, U conflicted, ? untracked), path (`old → new` for a rename), line counts, then the host's row buttons and ⋮ (hover or focus; always on a touch screen) |
| Line counts | `+added −deleted`; **binary** for a binary file; **submodule** for a gitlink; none for an untracked or conflicted file. Commit details with no diff open: `graph.commit`'s counts; an open diff: `diff.files`'; Changes: each section's own list |
| Path / Tree | One choice for every list, persisted as `code-git:graph:fileView`. Tree: directories first, then files, each by name; at most `MAX_TREE_DEPTH` (`features/diff/fileTree.ts`) directory levels |
| Bound to the open diff | The viewed file is highlighted (`aria-current`). Click, ↑/↓ or Enter views a file (no list refetch; in Changes, a file the diff's list does not have yet — it appeared on a reload of the panel — refetches the list and is shown); Ctrl/⌘-click toggles it in the selection; Shift-click extends the selection over the displayed order |
| Not bound | Click or Enter opens the diff at that file (details: the commit's diff; Changes: the section's diff, a conflicted file the merge tool); the list then becomes bound |
| Keys | ↑/↓ (`files.move`): previous / next file row (directory rows are skipped; bound: views it). Enter (`files.open`): opens / views the focused file |
| Row menu (⋮ or right-click) | Bound to a diff (details, Changed files panel, Files dialog), on the selection when the row is in it, else on the row: **Apply file from stash** (one file of a stash's All changes or Untracked view), **File history**, **Blame**, **Copy path**, **Create patch from selection (download)**, **Copy patch of selection**, **Restore file to this version…**. Details with no diff open: the commit file menu (**Apply this file** on a stash, **File history**, **Blame**, **Copy path**). Changes: its row menu (below) |
| Large lists | The first `FILE_RENDER_CAP` (`lib/clip.ts`) rows, then **Show all N**; a viewed file past the cap shows them all |

**Viewer toolbar** (the choices persist in `localStorage` key `code-git:diff-prefs`):

| Control | Behaviour |
|---|---|
| Diff scope: Hunk / Full | How much of the file the diff shows, and so what it requests. Hunk (default): the changed hunks with N context lines, each under its `@@` header. Full: the whole file (one `-U<FULL_CONTEXT>` request), no hunk headers |
| Diff layout: Inline / Split | How it is laid out; render-only, never refetches. Inline (default): one column, old and new line numbers, +/− markers. Split: old beside new, each side numbered (under each `@@` header in Hunk scope). Any scope with any layout |
| Diff / File | File: the new side's full content (the old side for a deleted file), numbered, no +/− markers |
| Ignore whitespace | Off by default. On: `git diff -w` for the list and the file, so whitespace-only edits are hidden (a file whose only change is whitespace leaves the list). Reloads the list too. Hunk and line staging are off while it is on |
| Context lines | `CONTEXT_CHOICES` (`state/diff.ts`), default 3 — Hunk scope only |
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
| Over the file cap | "Too large to display (over N MB)"; in Full scope or File view also **Switch to Hunk** (Hunk scope, Diff view, the layout kept) |
| Empty file added / deleted | "Empty file added" / "Empty file deleted" |
| No content change (rename-only, mode-only, whitespace hidden by Ignore whitespace) | "No content changes" + the mode or rename line |
| List over its cap | An alert in the diff: the diff is too large to list; the Changed files panel stays empty, the bound details say "The changed files could not be listed; the diff says why." (no file count) |

**Hunk and line staging** — only on an unstaged or staged diff of a modified (`M`) text file, with **Ignore whitespace** off and the Diff view (not File view); not on added, deleted, renamed, untracked, binary, submodule, conflicted or LFS-pointer files, nor on commit or compare diffs:

| Control | Unstaged diff | Staged diff |
|---|---|---|
| Hunk header (Hunk scope, either layout) | **Stash hunk…** (the file has nothing staged), **Discard hunk…**, **Stage hunk** | **Unstage hunk** |
| Gutter toggle on each added/removed line (every scope and layout) | click selects or unselects ("Select added line N" / "Select removed line N"); Shift-click selects every change line from the last clicked one | same |
| Selection bar ("k lines selected") | **Stage lines**, **Discard lines…**, **Stash lines…** (the file has nothing staged), **Clear** | **Unstage lines**, **Clear** |

- Within a run of removed and added lines, the i-th removed line pairs with the i-th added one (as Split shows them): staging only that pair replaces that line.
- Discarding asks first and previews the removed/added lines. A refusal shows in the header: the file changed since it was shown (reload it), or a selection that leaves out the end-of-file newline change.
- After each action the selection clears and the diff, the Changes lists and the header reload.

**Restore file to this version…** (the bound file list's menu, one file, when the diff's new side is a commit — a commit, a range or two refs; not for a deleted file or a submodule): after a confirmation, puts that commit's version of the file in the index and the working tree, overwriting uncommitted changes to it.

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

**One file** — **Apply this file** (the details panel's file menu, on a stash) or **Apply file from stash** (the diff's file list menu — the details while the stash is selected, on All changes or Untracked): the file's change goes into the working tree only, as a patch — all of it or nothing; a file that differs from the stash's base is refused, never overwritten. Pop is whole-stash only.


## Submodules

The repo's submodules, in the left slot (below `lg`: the graph toolbar's **Submodules** dialog). Ops, gates and security: [submodules](submodules.md). Every action shows its progress and outcome as a toast and reloads the list, the Changes lists, the header and the graph.

| Element | Behaviour |
|---|---|
| Header | **Submodules (n)**, **Add…**, and **Update all** (every unblocked submodule) when there is one |
| Row | The path; status badges **Type changed** (a file or a directory is staged where the parent has the submodule: no Remove until it is unstaged), **Not recorded** (`.gitmodules` declares it but its gitlink is not in the index: only Open, Edit URL… and Remove… are offered, and **Update all** skips it), **Uninitialised**, **Not cloned**, **Out of sync** (checked out ≠ recorded), **Modified**, **Untracked**, **Added** (not committed yet), **Conflicted**, **Blocked** (an unsafe name or path, or a directory that resolves outside the checkout: no action is offered), **URL refused** (its url is not one code-git clones from; the reason as the badge's tooltip); the checked-out commit and, when it differs, `→` the recorded one. Right-click or ⋮ opens its menu; double-click opens it |
| Empty | "No submodules" |
| **Add…** | (the dialog shows "Cloning ‹path›…" while git clones) Url (http(s), ssh, git, file, an absolute path, `user@host:path`, or relative `./…` / `../…` resolved against the default remote), path (defaults to the url's last segment), optional name and branch. git clones it; the submodule and `.gitmodules` are staged. A refusal stays in the dialog with git's message |

| Menu item | Behaviour |
|---|---|
| **Open** | (cloned) Opens the submodule as its own tab: graph, refs, Changes, diff, stash and its own submodules all act on it. Closing that tab by any way, or **Back to ‹parent›**, offers **Commit the new pointer for ‹path› in ‹parent›?** when its HEAD differs from what the parent committed: the message prefilled `Update submodule ‹path›`, **Commit pointer** commits only that pointer (anything else staged stays staged), **Not now** sends nothing |
| **Initialize** | (recorded, not initialized) Registers its url, no network; the toast's **Update** clones it, or says the url is refused |
| **Update** | (recorded, not in conflict) Clones if needed and checks out the recorded commit, recursively; the toast counts seconds. Never overwrites local changes (refused with git's message). Commits on no branch the checkout would leave behind: the toast's **Review…** lists them and **Update anyway** retries |
| **Sync** | (recorded, initialized) Copies `.gitmodules`' url into the config (and nested submodules') |
| **Edit URL…** | Writes a new url to `.gitmodules` (left unstaged) and syncs an initialized submodule |
| **Remove…** | Asks first (what is removed, and that `.git/modules/‹name›` is kept). Changed or untracked files, commits on no branch, a staged pointer, or unstaged `.gitmodules` changes: the toast's **Review…** lists them in an irreversible confirmation (**Discard and remove**; unstaged `.gitmodules` changes are staged with the removal) |

Refused outright with the server's message: a url with a `<transport>::` helper or a leading `-`, a repository whose own config sets `protocol.*`, and a local-path clone the System's git does not allow (`protocol.file.allow`).
