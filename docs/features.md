> See also: [README](../README.md) · [protocol](protocol.md) · [architecture](architecture.md)

# Features

## Shell

- Full-width page: the tab bar, the active checkout's header, the panel slots (`left`, `center`, `right`, `bottom`), and the repo picker dialog. It caps no content width, so it does not read `--cc-session-width`.
- Follows cc's light/dark theme live when embedded; standalone, follows the OS (`frontend/public/theme-init.js`). No theme toggle of its own.
- With no tab open the center shows "No repository open." and an **Open a repository** button.
- The center slot holds a placeholder for the commit graph; the bottom slot holds the activity panel.

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
