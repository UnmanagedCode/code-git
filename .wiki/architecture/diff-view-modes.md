# Diff view: scope, layout, Ignore whitespace

The viewer's choices are three independent prefs in `DiffPrefs` (`frontend/src/state/diff.ts`), set from `DiffToggles` (`features/diff/DiffToggles.tsx`), which both the main diff (`FileView`) and the File history viewer (`history/CommitFileView.tsx`) render. User-facing behaviour: `docs/features.md` → Diff.

## Glossary

- **Scope** (`scope`: Hunk / Full): how much of the file the diff shows. It is the *request*: `contextFor` gives the chosen context in Hunk scope, `'full'` (one whole-file hunk) in Full scope and File view.
- **Layout** (`layout`: Inline / Split): how rows are laid out. Render-only: `fileKey` (path + context + whitespace) holds no layout, so a flip never refetches.
- **Ignore whitespace** (`ignoreWhitespace`): `whitespaceFor` maps it to the wire value, `all` (git `-w`) or `none`. The backend still accepts `eol` / `change`; the UI never sends them.

## Decisions and gotchas

- **Full scope has no hunk headers, so no hunk actions.** Its single whole-file hunk's header carries nothing useful; `buildRows(…, headers = scope === 'hunk', …)` hides it. Line toggles still work in Full scope (against `context: 'full'`).
- **Hunk+Split needs no renderer of its own.** `SplitView` already draws `type: 'hunk'` rows through `HunkHeader` with `staging.hunkActions`.
- **Ignore whitespace turns staging off, and `canPartial` (`features/staging/partial.ts`) is the only guard.** A `-w` diff drops whitespace-only edits and takes context from one side's whitespace, so a selection made on it does not describe the file's real changes. The backend has no whitespace check of its own. The line ops take only `path` / `context` / `hunks` (`selectionParams`, `src/git/stage/readSelection.js`); a `whitespace` key is `BAD_PARAMS`. `readSelectionPatch` re-reads the diff with whitespace never ignored and checks the selection against it. A `-w`-derived selection therefore usually gets `STALE_DIFF`, and succeeds when the two diffs happen to be identical.
- **Under `-w` a whitespace-only file leaves the list.** git omits it from `--raw` and `--numstat`, so it disappears rather than showing "No content changes".
- **`-w`, not `-b`.** `-b` still shows `a=b` → `a = b`; one on/off toggle should hide a reformat entirely. No `--ignore-blank-lines`: it changes which lines count and moves hunk boundaries.
- **`parsePrefs` keeps known keys only**, each validated on its own (else its default), and the store writes a changed value back once at load. A legacy `mode` or `whitespace` key is dropped and never migrated: an old stored value loads as Hunk+Inline, whitespace shown.
- **A line selection is keyed by `fileKey` and list `generation`** (`state/lineSelection.ts`). A layout flip keeps it. A scope flip asks for another `fileKey`, so the selection does not show there, and comes back on flipping back while the list is unchanged. A whitespace flip reloads the list (new `generation`), which drops it.
