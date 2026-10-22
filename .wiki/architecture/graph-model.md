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
| **reserved lane** | Lane 0…k-1 held for the k pinned branches' commits until their rows arrive |
| **checkout** | A cc checkout of the project (main or a worktree) with its `repo.summary` HEAD and counts (`Checkout` in `features/graph/types.ts`) — distinct from a git worktree (`GitWorktree`, from `worktree list`) |
| **jump** / **seek** | A request to show a commit that may not be loaded: pages forward (bounded) until it is (`requestJump` → `loadUntil`) |

## Decisions

- **The layout is pure and resumable** (`extendLayout(state, inputs)`): pages stream in, and laying out page 2 after page 1 must equal laying out both at once — a test pins it on random DAGs. `useGraphLayout` extends when the new inputs only append, else lays out again; 5,000 rows are cheap on the main thread, no worker.
- **Lanes never shift sideways**; a lane freed by a root or a convergence is reused by the next new tip. Two lanes may wait for the same parent and converge at its row. The lowest waiting lane wins, so a pinned branch's first-parent chain stays in its reserved lane.
- **No lane waits for a row that may never come**: a WIP row links to its HEAD, and a stash is placed, only once that commit is loaded (`buildInputs`); otherwise a hidden HEAD would draw a lane through every row.
- **WIP rows come from `repo.summary` of every cc checkout** (bounded concurrency, the shared summary store), not from `git worktree list` — the summary has the counts. Worktree **labels** ("in X") come from `worktree list` and are joined to cc names: by branch, by commit when detached, the project name for the main checkout, else the directory's name (`worktreeName`).
- **Labels are looked up by oid** (`labelsByOid`), so a ref whose commit is in a later page gets its chip when that page loads; nothing waits for it.
- **Search asks git over the snapshot**, not the loaded rows (stronger than GitKraken's); navigating to an unloaded match is a jump.
- **The checked-out branch cannot be hidden** (its eye is disabled and the resolver ignores it in `hidden`); **solo overrides hide**.
- **Prefs are per project**, not per checkout: refs are shared by every checkout of a project.
- **Pointer events for drag**, not HTML5 drag and drop: only the app's own chips can be dragged, and no foreign `dataTransfer` can be dropped. The drop publishes to `branchDropStore` and opens the `branch-drop` menu; C2 registers no action there.
