# Side pane widths

User-facing behaviour: `docs/features.md` → Shell. Bounds: `PANE` in `frontend/src/state/paneWidths.ts`.

## Decisions

- **The right pane's floor is the Changes pane's design width.** The commit box's floor (`min-h-30`, sized for a button label that wraps in that width) and the one-line section header assume it (see [file-lists](file-lists.md)). Narrowing the right pane below it would break them, so `PANE.right.min` is pinned by a test.
- **The stored widths are the user's choice; the rendered ones are fitted** (`fitPanes`) against `<main>`'s measured width, as the details' header height is (`clampHeader`). A fit never writes the store, so the choice returns when the window grows. Unmeasured (0: before layout, happy-dom) the choice renders as is.
- **The left pane gives way first**, then the right: the right holds the Changes and commit box, whose paths and floors gain most from width; the refs list truncates well.
- **A pane's live maximum** (`paneMax`) is its ceiling or the room the other rendered pane leaves, whichever is less; it bounds the drag, End and `aria-valuemax`. A key stores only a width it moves to, so a fitted pane's End or arrow leaves the choice alone.
- **The centre minimum needs no last-resort branch.** The panes show only from `lg` (1024 px), and `<main>` is the viewport's width there (`panes.mjs` asserts it): both floors plus handles plus the centre minimum, and the defaults, fit in 1024. `panes.mjs` and a `fitPanes` property test cover the whole range.
- **Widths reach the slots as `--pane-left` / `--pane-right` on `<main>`** (`setCssPx`; a drag previews through the same property and stores once on release).
