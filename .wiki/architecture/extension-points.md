# Extension points

How later cards plug in without editing each other's files. The table of what to create and where to register: `docs/architecture.md` → Extension points. The decisions:

- **Registries are explicit lists, not self-registration.** `PANELS` (`frontend/src/shell/panels.ts`), `ACTIONS` (`frontend/src/shell/menus.ts`) and the `buildRegistry` list (`src/git/ops/index.js`) each import their entries. A feature module calling `registerPanel()` at import time would create an import cycle with the registry module (TDZ at load). A feature adds one import + one list entry; parallel cards conflict only on adjacent lines.
- **Ops, not routes.** A new git capability is an op file; `POST api/ops/:name` already handles target validation, cancel wiring and activity. Add a route file only for something that is not a git op.
- **`cancellable` is resolved once at load** (`buildRegistry`); the route and the activity log read the frozen definition. Default read → true, write → false; a non-boolean throws at load.
- **Write lock is per project, not per checkout** (`src/git/locks.js`): worktrees share refs and objects, so two writes on different worktrees of one project still serialize.
- **On-demand panels** (`PanelDef.onDemand`, `state/shownPanel.ts`): a panel such as the diff takes over its slot for one tab while `showPanel` names it, instead of each feature hand-rolling "replace the graph". `Slot` in `Shell.tsx` is the only reader; the shown id is per `tabKey`, pruned when the tab closes, and not persisted (a reload shows the graph).
- **Ops get `{target}` as `run`'s third argument** for naming output after the checkout (`diff.patch` filenames); git still goes only through the bound `git`.
- **Per-checkout UI state** goes in a feature's own store keyed by `tabKey`; there is no central `RepoState` to edit.
- **Context-menu contexts** are free strings: `'tab'` exists; `'diff-file'` (a diff's file list row) exists too; planned ones are `'commit'`, `'branch'`, `'file'`, `'branch-drop'` (drag a branch onto a branch).
- **`<ActionMenuItems>` renders inside a `DropdownMenuContent`**; a tab's menu is a controlled DropdownMenu opened by its ⋮ trigger or by `onContextMenu` (cc ships no context-menu component).
