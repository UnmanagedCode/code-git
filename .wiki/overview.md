# Overview

code-git is a cc plugin (UI only, no MCP tools) that manages the git repos of cc projects — local or on another System — GitKraken-style. Every git command runs on the project's own System through cc's `POST /api/exec`; the backend never spawns a process.

Shape: `server.js` → `src/app.js` (wiring) → `src/routes/*` → `src/git/ops/*` (named ops) → `src/git/runner.js` (`runGit`, the one choke point) → `src/conductor/exec.js` → cc. The UI (`frontend/`) is tabs + a repo header + panel slots + an activity panel. Module map: `docs/architecture.md`.

## Glossary

| Term | Meaning |
|---|---|
| **target** | `{project, worktree, sub?}` naming one cc checkout (`worktree: null` = the main checkout), or with `sub` a submodule inside it. Validated by `assertTarget`, which refuses any other key |
| **sub chain** | A target's `sub`: submodule paths from the checkout down, each relative to the one before; the runner alone turns it into `-C <path> --git-dir=.git`, cc never sees it |
| **form A** | cc exec addressing by `{project, worktree?}`; cc resolves the directory and the System. code-git uses only this form (never `system`/`cwd`, never `shell`) |
| **op** | A named backend operation (`repo.summary`) with `kind` read/write, `cancellable`, `params`, `run`. The UI calls ops by name; no route takes argv |
| **op run** | One call of an op; its commands share an `opRunId` |
| **activity entry** | One git command as logged: argv, target, status, exit code, stderr tail. Diagnostic only |
| **tabKey** | `project + '\0' + (worktree ?? '')`, then `'\0' + path` per sub chain entry: the key of a checkout's UI state. `refsKey`/`prefsKey` share refs-derived state and graph prefs across a project's worktrees, but not into its submodules |
| **diff source** | What a diff compares (`commit`, `unstaged`, `staged`, `compare`, `worktree`, `commits`, `pair`); resolved to a **pair** of pinned sides (`tree` oid / `index` / `worktree`) |
| **System** | Where a project lives (`local`, `docker`, `ssh`, …), from cc's project row |

## Decisions worth knowing

- **Form A only.** Confining code-git to cc projects is the product's scope, and form A gets remote Systems for free: cc resolves where the checkout lives. A `system`/`cwd` can never be sent because `assertTarget` refuses extra keys and `exec` builds the body itself.
- **Every cc project is listed in the picker**, unopenable ones disabled with cc's reason — never filtered, so "where is my project?" always has an answer on screen.
- **The activity log is not a source of truth.** It is in memory and capped; undo/reflog features read git.
