# The graph model

How the commit graph's pieces fit, and the words used for them. Behaviour: `docs/graph.md`; modules: `docs/architecture.md`.

## Glossary

| Term | Meaning |
|---|---|
| **tips** / **snapshot** | The sorted, unique commit oids the graph pages from: the visible refs' commits, plus HEAD and detached worktree HEADs unless soloing (`resolveVisibility`). `tipsKey` is their join; a different key means a new snapshot |
| **generation** | Counter bumped on every snapshot swap; a `graph.page` answer tagged with an older one is dropped (`loadNextPage`) |
| **anchor** | The first visible row and how far it is scrolled into, captured before a swap and restored after it (`GraphView`) |
| **row** | A `GraphRow`: `commit` (id = oid), `wip` (id `wip:<worktree or ''>`), `stash` (id `stash:<oid>`) — the latter two are pseudo-rows built by `buildInputs`, not git output |
| **layout input** | `{id, parents, dashed}` per row: WIP → its HEAD, stash → its base only, both dashed |
| **lane** | A column slot waiting for one oid, with a colour index (`LANE_COLOURS`) and a dashed flag |
| **span** (lane run) | One lane's line from the row that opens it to the row it ends in; stored once in `LayoutState.spans`, drawn through the rows strictly between (`passThroughs`) |
| **gutter** | Where every lane at or past `LANE_CAP` is drawn: one column, so a row's drawing is bounded |
| **reserved lane** | Lane 0…k-1 held for the k pinned branches' commits until their rows arrive |
| **checkout** | A cc checkout of the project (main or a worktree) with its `repo.summary` HEAD and counts (`Checkout` in `features/graph/types.ts`) — distinct from a git worktree (`GitWorktree`, from `worktree list`) |
| **jump** / **seek** | A request to show a commit that may not be loaded: pages forward (bounded) until it is (`requestJump` → `loadUntil`) |

## Decisions

- **The store owns each graph's refresh triggers, not the panel** (`watchGraph` in `state/graph.ts`, started by `openGraph`, stopped when the tab closes): a diff replaces the graph in the center slot and unmounts it, and a hide, a solo, a write or a focus meanwhile must still move the snapshot. Focus refreshes only the active tab; a background tab is marked stale and refreshed by `openGraph` when shown again.
- **A remount restores the view** (`viewMemory`, per tab): the scroll anchor (first visible row + offset), the search query and mode, and the focus on the list when the panel that replaced the graph took it.
- **Jumps survive an unmounted graph**: `requestJump` closes a shown diff, and `takeJump` keeps the last jump each tab's panel served, so a panel mounted after the request still serves it (a mount-time "latest seq" baseline would swallow it). A found jump selects its row, or the commit when the row does not exist (a stash with the Stashes section hidden), and is done either way.
- **The layout is pure and resumable** (`extendLayout(state, inputs)`): pages stream in, and laying out page 2 after page 1 must equal laying out both at once — a test pins it on random DAGs. `useGraphLayout` extends when the new inputs only append, else lays out again; 5,000 rows are cheap on the main thread, no worker.
- **Pass-throughs are derived, not stored per row**: storing every occupied lane in both halves of every row grew with branches × rows (≈ 4M edges for 2,000 parallel branches; 5,000 ran out of memory). Rows keep only their node's edges, clamped to the drawn width; lane runs give the rest for the visible window.
- **Lanes never shift sideways**; a lane freed by a root or a convergence is reused by the next new tip. Two lanes may wait for the same parent and converge at its row. The lowest waiting lane wins, so a pinned branch's first-parent chain stays in its reserved lane.
- **No lane waits for a row that may never come**: a WIP row links to its HEAD, and a stash is placed, only once that commit is loaded (`buildInputs`); otherwise a hidden HEAD would draw a lane through every row.
- **WIP rows come from `repo.summary` of every cc checkout** (bounded concurrency, the shared summary store), not from `git worktree list` — the summary has the counts. Worktree **labels** ("in X") come from `worktree list` and are joined to cc names: by branch, by commit when detached, the project name for the main checkout, else the directory's name (`worktreeName`).
- **Labels are looked up by oid** (`labelsByOid`), so a ref whose commit is in a later page gets its chip when that page loads; nothing waits for it.
- **Search asks git over the snapshot**, not the loaded rows (stronger than GitKraken's); navigating to an unloaded match is a jump.
- **The checked-out branch cannot be hidden** (its eye is disabled and the resolver ignores it in `hidden`); **solo overrides hide**.
- **Prefs are per project**, not per checkout: refs are shared by every checkout of a project.
- **Pointer events for drag**, not HTML5 drag and drop: only the app's own chips can be dragged, and no foreign `dataTransfer` can be dropped. The drop publishes to `branchDropStore` and opens the `branch-drop` menu; C2 registers no action there.
- **`CommitItem.time` is the author time; age markers read `committerTime`** (`%ct`). The Date column keeps the author time.
- **A commit's age level is the highest rung it has crossed** (`ageMarkers`): every rung's crossed set is "all times below a cutoff", so levels never fall down the list (a level is non-increasing in commit time) and `yesterday` (calendar) suppresses `1 hour ago` / `3 hours ago` just after midnight with no sorting rule.
- **Age markers are an in-row overlay, never a border**: with `box-sizing: border-box` a `border-t` would shrink the 28px row's content box and shift the lane SVG; the windowing is pure index × `ROW_H`.
- **Column resize handles are `Splitter`s that sit beside the menu trigger inside the `columnheader`, never inside it** (`GraphHeader`). Events from a handle inside the trigger would reach the reorder drag and Radix's open keys (Enter, Space, ↓), and `stopPropagation` is not an option because the shell's shortcuts listen on `window`. Column handles pass `grip={false}`: the fixed-height grip would overflow the header.
