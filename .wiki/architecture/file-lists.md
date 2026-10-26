# File lists

One component (`FileList`, `frontend/src/features/diff/FileList.tsx`) renders every file list: the commit details', the Changes panel's sections, an open diff's. User-facing behaviour: `docs/features.md` → File lists.

## Decisions

- **The diff has no list of its own; the right slot's list drives it.** Which list that is comes from `rightSlotFor` (`features/workdir/rightSlot.ts`): the Changes section for an unstaged / staged diff, the details when `diffOwnerCommit` (`features/diff/binding.ts`) is the single selected commit or stash, else the `DiffFilesPanel`. Below `lg` (right slot hidden) the diff header's **Files (n)** dialog holds the same `DiffFileList`.
- **Bound vs unbound.** A list is *bound* while the open diff is its own (`useOpenDiff`): picking calls `setSelection` (no list refetch), `multi` and `followFocus` are on. The exception: a Changes section's rows come from `workdirStore`, which Reload changes and `refreshWorkdirIfShown` reload without the diff's list, so a picked file the loaded diff list lacks also runs `loadList` (which keeps the pick); without it the viewer would stay blank. Unbound, a pick opens the diff (details: `requestFileOpen`; Changes: `openDiff` / `openConflict`), and the list becomes bound on the next render. The Changes section stays bound to `workdirStore`'s rows (their counts); only `viewed` / `selected` come from the diff.
- **`onSelect`'s `plain` flag** says a plain click or Enter, not a toggle, an extend or a focus-following move: the narrow dialogs (Files, Changes) close only on a plain pick, so ↑/↓ and Ctrl-click work inside them.
- **A pick made while the diff's list loads wins** (`loadList` → `withListedPick`, `state/diff.ts`): the list beside the diff is live during the load (the details' stand-in, a bound Changes section), so the answer keeps the viewed file and the listed part of the selection as they are by then, and falls back to the path the load started with, then the first file.
- **A directory's actions get every file beneath it**, from the full list, not the rows rendered under `FILE_RENDER_CAP`.
- **Displayed order is the one order**: Shift-click ranges, ↑/↓ and the viewer's Previous / Next file all use `orderedFiles` (path order, or the tree's depth-first order), so Tree never jumps around.
- **The details' list fills the right slot below a fixed `h-*` header** (`CommitDetails.tsx`, "Commit information"): the aside's `h-full` resolves because the slot `<div>` (`shell/Shell.tsx`) is a stretched flex item of `main`, so the file section takes the rest and scrolls on its own. Inside the phone dialog's `max-h-[70dvh] overflow-y-auto` scroller (`GraphPanel.tsx`) `h-full` falls back to auto: the header keeps its height and the dialog scrolls the files.
- **One persisted Path / Tree choice** (`state/fileView.ts`, key `graph:fileView`, the details' original key so a user's choice survives).
- **Folder staging is stage / unstage only, one op** (`stageFilesOf` / `unstageFilesOf`, `patchPaths`): no N+1, reversible. A folder Stage leaves conflicted (`U`) files out (`git add` would mark them resolved). No folder Discard: bulk destruction stays behind **Discard all…**'s confirmation.
- **Counts never cost a command per file.** Lists show numstat already fetched (`diff.files`, `graph.commit`'s one `diff-tree --raw --numstat`). An untracked file has no numstat (counting it would take one `--no-index` diff per file), so it shows none; a gitlink shows "submodule" (its numstat counts the `Subproject commit` line).

## Gotchas

- **A row's menu is portalled, but its key and click events still bubble through React** to the list and the row. The list's `onKeyDown` ignores events whose target is outside its DOM (`currentTarget.contains(target)`), and the menu content stops click propagation, or ↑/↓ in an open menu would move the list and a menu click would pick the row.
- **Enter and S / U act only when the row itself has focus**, not a button inside it: a row button's Enter must activate the button.
- **The Files dialog lives inside the diff's `<section>`**: its keys would reach `useDiffKeys` through React (Esc would close the diff, not the dialog). `DialogContent` stops key propagation; Radix's own Esc listener is a document capture listener, so the dialog still closes.
- **Directory rows are not options** (`li role="presentation"` holding a `ul role="group"` named by the directory path): ↑/↓ query `li[role="option"]` in DOM order, which is the displayed order.
