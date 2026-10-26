# code-git

A GitKraken-class git manager for the repositories of **code-conductor (cc) projects**, as a cc plugin with a UI only (no MCP tools). It works on local projects and on projects that live on another System (Docker, SSH): every git command runs on the project's own System through cc's host exec.

**Scope:** cc projects and their worktrees only — no clone, init or opening arbitrary folders (cc owns projects and worktrees). The roadmap's feature reference is [docs/gitkraken-reference.md](docs/gitkraken-reference.md).

## What it does

| Surface | Behaviour |
|---|---|
| Repo picker | Lists every cc project, grouped by workspace, filterable. A project that cannot be opened (not a git repo, System unreachable, git refusal, unreadable record) is listed but disabled, with the reason. Expanding a project lists its main checkout and its worktrees |
| Tabs | One tab per checkout (project or project/worktree). Ctrl/⌘+1…8 activate that tab, Ctrl/⌘+9 the last; tab menu (⋮ or right-click): Close, Close others, Copy name. Tabs persist across reloads; the active one is in the URL |
| Repo header | HEAD (branch, detached, or unborn), upstream with ahead/behind, staged/unstaged/untracked/conflicted counts, the System for non-local projects, Refresh |
| Commit graph | The checkout's history as a lane graph with ref labels, WIP and stash rows, search, keyboard and multi-select; a refs panel (hide / solo / pin) and commit details. [docs/graph.md](docs/graph.md) |
| Diff | A commit, unstaged or staged changes, two refs (`..` / `...`), a run of commits, or a commit vs the working directory. File list; Hunk / Full scope and Inline / Split layout with word-level and syntax highlighting; File view; an Ignore-whitespace toggle and context control; wrap; change navigation and in-file search; binary, rename, LFS-pointer, submodule and oversized states; patch download/copy. Opened from the graph (a commit, a selection, a file in the details), the Changes panel's rows, or the Compare panel (left) |
| Changes | Stage, unstage and discard files, hunks and lines; commit, amend, message-only amend, skip hooks, commit template; ignore; restore a file from a commit; apply a patch. Right slot (it gives way to the commit details while a commit is selected), opened from the graph's WIP row; the **Changes (n)** dialog on narrow screens |
| Branches & tags | Create, checkout (double-click; a remote branch becomes a tracking branch), rename, delete (several at once, or on a remote), upstream and ahead/behind, fast-forward; tags create (annotated or not), push, delete; reset soft/mixed/hard, revert, cherry-pick; Fast-forward and Reset on a branch dropped onto another. Destructive actions confirm first; `code-conductor/*` branches warn. [docs/refs.md](docs/refs.md) |
| Stash | Save all changes, selected files, staged only, or selected hunks and lines (with or without untracked files, optionally keeping the index); apply, apply with staged changes, pop, drop, rename, create a branch; a stash's All changes / Staged / Untracked diffs; one file applied alone. [docs/stash.md](docs/stash.md) |
| Merge & rebase | Merge a branch (fast-forward when possible, no fast-forward, squash) and rebase onto a branch or commit, from the drag menu, a branch's or commit's menu; rebase the newest N commits onto a branch; an interactive-rebase editor (pick, reword, edit, squash, fixup, drop; drag or keys to reorder) that also cherry-picks or squashes N selected commits; a three-pane merge tool for a conflicted file (pick lines, edit the result, save, mark resolved) or take one side. What is in progress (a merge, rebase, cherry-pick or revert, or conflicts left behind) shows as a banner in the Changes panel, after a reload too: Continue, Skip, Abort…. A pull that stops on conflicts stays in progress. [docs/merge.md](docs/merge.md) |
| Remotes | Add, edit, rename, remove remotes; Fetch (all or one, prune behind a confirmation), auto-fetch (off by default); Pull (fast-forward if possible, fast-forward only, rebase; a per-project default); Push a branch (upstream, first push, a drop onto a remote branch, after a commit), force-with-lease behind a confirmation that checks the remote first. Credentials only from the System. [docs/remotes.md](docs/remotes.md) |
| Submodules | Status of each submodule (uninitialised, not cloned, out of sync, modified, untracked, added, conflicted, blocked); add, initialize, update (recursive), sync, edit url, remove; open one as its own tab, with an offer to commit its new pointer in the parent on the way out. [docs/submodules.md](docs/submodules.md) |
| Undo / redo | The checkout's last commit, checkout, branch / tag change, reset, cherry-pick, revert, merge, rebase, discard, stash op (not an apply that stopped on conflicts or changed nothing) or remote-config change, undone and redone from the header, Ctrl/⌘+Z / Ctrl/⌘+Shift+Z or the palette; refused once a created commit is on a remote; a fetch keeps it. [docs/undo.md](docs/undo.md) |
| History | A file's history across renames with each commit's change, blame with author colours, and the reflog of HEAD or a branch. [docs/history.md](docs/history.md) |
| Git-flow | Initialize (the `gitflow.*` settings), start and finish feature, release and hotfix branches from the toolbar's **Repository actions** menu, a flow branch's menu or the palette; finish merges `--no-ff`, tags a release or hotfix, deletes the branch, and changes nothing when a merge would conflict. Native: no git-flow extension needed. [docs/gitflow.md](docs/gitflow.md) |
| LFS | The System's git-lfs: tracked patterns of the root `.gitattributes`, track and untrack, the LFS files (on request), pull, prune behind a confirmation. [docs/lfs.md](docs/lfs.md) |
| code-review links | Inside cc: a link from code-review selects a commit in the graph or opens a file's history; a commit's menu offers **Review in code-review**, a selection that is a first-parent chain ending at HEAD **Review range in code-review**. [docs/protocol.md → Links to code-review](docs/protocol.md#links-to-code-review) |
| Command palette | Ctrl/⌘+P: every command by name, with a second step to pick a branch, a tab or a file; Ctrl/⌘+/ lists every shortcut |
| Activity log | Every git command run: status, op, checkout, argv, duration, exit code, stderr (hook output included). Cancel on a running op that allows it. Hooks always run (only a commit can skip them); a failing one blocks with its output ([docs/features.md → Hooks](docs/features.md#hooks)) |

Details: [docs/features.md](docs/features.md).

## Stack and layout

- Backend: Node ≥ 24, Express 4, plain ESM JavaScript (`server.js`, `src/`). Binds `127.0.0.1` only.
- Frontend: React 19 + Vite 8 + Tailwind v4 + Radix (cc's `docs/plugin-ui.md` reference setup) in `frontend/`, built to `frontend/dist` (untracked).
- Tests: `node --test` (backend, against a fake cc that runs real git) and Vitest + happy-dom (UI).

```
conductor.plugin.json   manifest: backend (npm start, /health) + frontend (/, "Code Git")
server.js               start(): loopback listener, clientError handler
src/                    backend — app wiring, cc client, git runner/ops, activity log, routes
frontend/               UI — shell, state, features, copied cc components
tests/                  backend tests and their fakes (_fakeCc.js, _git.js, …)
harness/playwright/     visual-verification scripts (seeded and live)
harness/mutation/       code-mutant config
docs/                   features, protocol, architecture, GitKraken reference
.wiki/                  gotchas, decisions, glossary
```

Internals: [docs/architecture.md](docs/architecture.md). API and wire contracts: [docs/protocol.md](docs/protocol.md). The commit graph: [docs/graph.md](docs/graph.md). Branches, tags and HEAD: [docs/refs.md](docs/refs.md). Merge, rebase and conflicts: [docs/merge.md](docs/merge.md). Stash: [docs/stash.md](docs/stash.md). Remotes, fetch, pull and push: [docs/remotes.md](docs/remotes.md). Submodules: [docs/submodules.md](docs/submodules.md). Undo and redo: [docs/undo.md](docs/undo.md). File history, blame and the reflog: [docs/history.md](docs/history.md). Git-flow: [docs/gitflow.md](docs/gitflow.md). Git LFS: [docs/lfs.md](docs/lfs.md).

## Run

| How | Command | Notes |
|---|---|---|
| In cc | Library entry with `"postClone": "npm install", "postPull": "npm install"`; or adopt the checkout as a project, then Settings → Plugins → Rescan + Enable | `npm install` builds the UI through `prepare` |
| Standalone | `npm install && PORT=7599 npm start` | Default port 7500 (`DEFAULT_PORT` in `server.js`). Without cc the UI loads, and the routes that reach cc — `api/repos`, `api/repos/:project/worktrees`, `api/ops/:name` — answer 503 `CONDUCTOR_UNAVAILABLE`. The activity routes keep working (the log shows those refused attempts), an unknown path is still a 404, and `/health` stays up |
| UI dev server | `npm start` in one shell, `npm run dev` in another | Proxies `/api` to `PLUGIN_BACKEND` (default the backend's default port) |

| Env var | Used by | Meaning |
|---|---|---|
| `PORT` | backend | Listen port (cc injects it) |
| `CONDUCTOR_URL` | backend, `harness/playwright/live.mjs` | cc's base URL (cc injects it); read per request |
| `CC_PROJECTS_ROOT` | harnesses | Locates the shared code-playwright and code-mutant plugins |

## Test

| Command | Runs |
|---|---|
| `npm test` | typecheck, then backend, then UI tests |
| `npm run test:server` | `node --test "tests/*.test.js"` |
| `npm run test:ui` | `vitest run --config frontend/vitest.config.ts` |
| `node harness/playwright/snap.mjs` / `golden.mjs` / `diff.mjs` / `staging.mjs` / `sidepane.mjs` / `stash.mjs` / `remotes.mjs` / `operations.mjs` / `merge.mjs` / `rebase.mjs` / `conflicts.mjs` / `submodules.mjs` / `history.mjs` / `palette.mjs` / `flow.mjs` / `lfs.mjs` / `links.mjs` | screenshots / golden path / the diff path / the staging path / the side-pane layout / the stash path / the remotes path / the merge-and-rebase in-progress path / the merge and rebase starts / the interactive editor / the merge tool / the submodule path / file history, blame and the reflog / the palette, the shortcut sheet and undo/redo / the git-flow path / the LFS path / the code-review links on a seeded world ([harness/playwright/README.md](harness/playwright/README.md)) |
| `node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" baseline` | mutation trust gates ([harness/mutation/README.md](harness/mutation/README.md)) |

## Known limitations

- **Undo is the last op only, in memory**: one undo and one redo per checkout, forgotten on a backend restart and cleared by any change it does not cover (staging, push, pull, …; a fetch keeps it); a stash put back lands at `stash@{0}` ([docs/undo.md → Residuals](docs/undo.md#residuals)).
- **No progress output for long ops.** cc's exec buffers output; a running op shows only an elapsed timer (and Cancel when the op allows it).
- **Ctrl/⌘+digit works only while focus is inside the plugin frame.** With focus in cc's own UI, cc gets the key.
- **Closing code-review's view after "Review in code-review" goes to cc's session, not back to code-git**: cc's close steps back only over history entries cc pushed itself. The browser's Back returns to code-git.
- **"Review range in code-review" only for a first-parent chain ending at HEAD**: any other selection is not one `base...HEAD` range.
- **The code-review links are hidden outside cc** (standalone there is no cc page to navigate).
- **The activity log is in memory**: capped (`LIMITS.activityRing` in `src/git/limits.js`) and cleared when the backend restarts.
- **Git prompts are disabled.** Credentials must come from the target System's credential helper or ssh-agent; an op that would prompt fails instead.
- **Output over an op's cap is refused (`OUTPUT_TOO_LARGE`), never clipped.**
- **The graph refreshes on its own only after code-git's own writes and when the window regains focus** (no polling): a commit made elsewhere shows on focus or Refresh.
- **Search pages forward** to reach a match that is not loaded yet, a bounded number of pages at a time.
- **Worktree labels need git ≥ 2.36 and commit co-authors git ≥ 2.22** on the project's System ([docs/graph.md → Git versions](docs/graph.md#git-versions)).
- **Below the `lg` breakpoint the side panels are dialogs**: refs, Compare and commit details open from the graph's toolbar or a commit click instead of beside the graph, and the Changes panel from the toolbar's **Changes (n)**; a diff's file list opens from the diff header's **Files (n)**.
- **Untracked files are not in a work-in-progress patch** (`git diff` leaves them out).
- **No image or binary preview** in the diff; blame is its own view (of a commit, never of uncommitted lines), and file history is at most `HISTORY_LIMITS.followMaxCommits` commits deep ([docs/history.md → Known limitations](docs/history.md#known-limitations)).
- **Non-UTF-8 text shows replacement characters** in the diff (hunk and line staging still writes the exact bytes).
- **The Changes lists do not watch the disk**: they reload on first show, on Reload / Refresh and after every op.
- **Hunk and line staging is for modified (`M`) text files only**, with whitespace shown; other files are staged whole.
- **A patch applies to the working tree or the index, never both at once** (`git apply --index` writes through untracked symlinks); apply, then stage.
- **Ignore writes the root `.gitignore`** only, never `.git/info/exclude`.
- **Ref writes need git ≥ 2.24** on the project's System; a remote whose fetch refspecs code-git cannot map refuses branch pushes and remote deletes; a remote ref's undo value is the best one known locally ([docs/refs.md → Known limitations](docs/refs.md#known-limitations)).
- **Writes are not cancellable by default**: an op opts in only where aborting mid-command is safe; a closed browser tab does not abort a write.
- **A renamed stash moves to the top** (`stash@{0}`): git can only store an entry there.
- **Applying one file of a stash is worktree-only and patch-based**: a file that differs from the stash's base is refused, not merged. Pop is whole-stash only.
- **Hunks and lines are stashed only from a file with nothing staged**, and such a stash pops only onto a clean file (git's merge refuses a file with any local change; apply its file instead).
- **Stashing staged changes only needs git ≥ 2.35** on the project's System.
- **The merge tool merges with its own three-way diff**, which can draw conflicts differently from git's merge (no merge drivers, `-X` options or renames); files over 512 KiB a side, binary or non-UTF-8 files are resolved by taking a side.
- **Rebase needs git ≥ 2.26** on the project's System, and refuses a range holding merge commits (`HAS_MERGES`).
- **`git am` in progress, and a multi-commit cherry-pick or revert left stopped after a manual commit, are not shown** as in progress; a branch or tag named `MERGE_HEAD`, `CHERRY_PICK_HEAD` or `REVERT_HEAD` reads as that operation ([docs/merge.md → Known limitations](docs/merge.md#known-limitations)).
- **git-flow finish needs git ≥ 2.38, and main and develop free of other checkouts** (a release or hotfix is finished from the checkout that holds the production branch); a finish that stops after its first write is not rolled back ([docs/gitflow.md → Known limitations](docs/gitflow.md#known-limitations)).
- **LFS needs git-lfs ≥ 3.2.0 on the project's System**, whose filter config is the System's (code-git never runs `git lfs install`); git-lfs may create `.git/lfs` and install its hooks on any LFS write, a file listing included, and when git runs its filter. Patterns are read from the root `.gitattributes` only ([docs/lfs.md](docs/lfs.md)).
