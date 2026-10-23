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
| Diff | A commit, unstaged or staged changes, two refs (`..` / `...`), a run of commits, or a commit vs the working directory. File list; Hunk, Inline and Split modes with word-level and syntax highlighting; File view; whitespace and context controls; wrap; change navigation and in-file search; binary, rename, LFS-pointer, submodule and oversized states; patch download/copy. Opened from the graph (a commit, a selection, a file in the details), the Changes panel's rows, or the Compare panel (left) |
| Changes | Stage, unstage and discard files, hunks and lines; commit, amend, message-only amend, skip hooks, commit template; ignore; restore a file from a commit; apply a patch. Right slot (it gives way to the commit details while a commit is selected), opened from the graph's WIP row; the **Changes (n)** dialog on narrow screens |
| Branches & tags | Create, checkout (double-click; a remote branch becomes a tracking branch), rename, delete (several at once, or on a remote), upstream and ahead/behind, fast-forward; tags create (annotated or not), push, delete; reset soft/mixed/hard, revert, cherry-pick; Fast-forward and Reset on a branch dropped onto another. Destructive actions confirm first; `code-conductor/*` branches warn. [docs/refs.md](docs/refs.md) |
| Stash | Save all changes, selected files, staged only, or selected hunks and lines (with or without untracked files, optionally keeping the index); apply, apply with staged changes, pop, drop, rename, create a branch; a stash's All changes / Staged / Untracked diffs; one file applied alone. [docs/stash.md](docs/stash.md) |
| Activity log | Every git command run: status, op, checkout, argv, duration, exit code, stderr (hook output included). Cancel on a running op that allows it |

Details: [docs/features.md](docs/features.md).

## Stack and layout

- Backend: Node ≥ 24, Express 4, plain ESM JavaScript (`server.js`, `src/`). Binds `127.0.0.1` only.
- Frontend: React 19 + Vite 8 + Tailwind v4 + Radix (cc's `docs/plugin-ui.md` reference setup) in `frontend/`, built to `frontend/dist` (untracked).
- Tests: `node --test` (backend, against a fake cc that runs real git) and Vitest + happy-dom (UI).

```
conductor.plugin.json   manifest: backend (npm start, /health) + frontend (/, "Git")
server.js               start(): loopback listener, clientError handler
src/                    backend — app wiring, cc client, git runner/ops, activity log, routes
frontend/               UI — shell, state, features, copied cc components
tests/                  backend tests and their fakes (_fakeCc.js, _git.js, …)
harness/playwright/     visual-verification scripts (seeded and live)
harness/mutation/       code-mutant config
docs/                   features, protocol, architecture, GitKraken reference
.wiki/                  gotchas, decisions, glossary
```

Internals: [docs/architecture.md](docs/architecture.md). API and wire contracts: [docs/protocol.md](docs/protocol.md). The commit graph: [docs/graph.md](docs/graph.md). Branches, tags and HEAD: [docs/refs.md](docs/refs.md). Stash: [docs/stash.md](docs/stash.md).

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
| `node harness/playwright/snap.mjs` / `golden.mjs` / `diff.mjs` / `staging.mjs` / `stash.mjs` | screenshots / golden path / the diff path / the staging path / the stash path on a seeded world ([harness/playwright/README.md](harness/playwright/README.md)) |
| `node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" baseline` | mutation trust gates ([harness/mutation/README.md](harness/mutation/README.md)) |

## Known limitations

- **No progress output for long ops.** cc's exec buffers output; a running op shows only an elapsed timer (and Cancel when the op allows it).
- **Ctrl/⌘+digit works only while focus is inside the plugin frame.** With focus in cc's own UI, cc gets the key.
- **The activity log is in memory**: capped (`LIMITS.activityRing` in `src/git/limits.js`) and cleared when the backend restarts.
- **Git prompts are disabled.** Credentials must come from the target System's credential helper or ssh-agent; an op that would prompt fails instead.
- **Output over an op's cap is refused (`OUTPUT_TOO_LARGE`), never clipped.**
- **The graph refreshes on its own only after code-git's own writes and when the window regains focus** (no polling): a commit made elsewhere shows on focus or Refresh.
- **Search pages forward** to reach a match that is not loaded yet, a bounded number of pages at a time.
- **Worktree labels need git ≥ 2.36 and commit co-authors git ≥ 2.22** on the project's System ([docs/graph.md → Git versions](docs/graph.md#git-versions)).
- **Below the `lg` breakpoint the side panels are dialogs**: refs, Compare and commit details open from the graph's toolbar or a commit click instead of beside the graph, and the Changes panel from the toolbar's **Changes (n)**.
- **Untracked files are not in a work-in-progress patch** (`git diff` leaves them out).
- **No image or binary preview** in the diff, and **File view has no blame**.
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
