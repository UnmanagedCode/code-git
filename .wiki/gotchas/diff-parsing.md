# Gotcha: parsing git diff output

Code: `src/git/parse/diff.js`, `src/git/diff/source.js`. Reference: `docs/protocol.md` → Diff sources / diff ops.

- **Consume a hunk by its header counts, never by line prefix.** A content line can read `diff --git a/x b/x`, `@@ -1 +1 @@` or `--- a`; only the `-a,b +c,d` counts say where the hunk ends. `\ No newline at end of file` can follow the last counted line, so peek for it after the counts are spent.
- **`--raw --numstat -z` prints every raw record first, then every numstat record**, in the same order: join by index, never by path. A rename's raw record has two path fields; its numstat record is `a\td\t` followed by two more NUL fields (old, new). A path can start with `:` — fields are taken positionally, not by pattern.
- **An unmerged path appears twice** in both lists (a `U` record, then an `M` one); keep the `U` entry only (`parseRawNumstat`).
- **Repo config that reshapes the text** — every key is overridden on every diff command, and `tests/_diffRepo.js` sets all of them so the op tests run against them:

| Config | Effect if left alone | Override |
|---|---|---|
| `diff.suppressBlankEmpty` | blank context line emitted as `""`, not `" "` | `-c diff.suppressBlankEmpty=false` before the subcommand (a later `-c` wins); the parser also reads a bare empty line in a hunk as context |
| `diff.external`, `diff.<driver>.command` | runs a program | `--no-ext-diff` |
| `diff.<driver>.textconv` (`.gitattributes`) | runs a program; text is not the blob | `--no-textconv` |
| `diff.relative` | paths relative to a subdir, others vanish | `--no-relative` |
| `diff.noprefix`, `diff.mnemonicPrefix`, `diff.srcPrefix`/`dstPrefix` | header prefixes change | `--src-prefix=a/ --dst-prefix=b/` |
| `color.ui`, `color.diff`, `diff.wsErrorHighlight` | ANSI escapes | `--no-color` (+ `BASE_ARGS` `color.ui=false`) |
| `diff.context` | context size | explicit `-U<n>` |
| `diff.interHunkContext` | merges nearby hunks (hunk ids change) | `--inter-hunk-context=0` |
| `diff.renames` | rename detection off / copies on | `-M` |
| `diff.submodule=log\|diff` | a gitlink becomes a log or an inline diff | `--submodule=short` |
| `core.quotePath`, `core.abbrev` | quoted paths, short oids | `BASE_ARGS` + `-z`, `--no-abbrev` |
| `format.*` (signature, headers, to/cc, coverLetter, numbered, thread, useAutoBase, from, attach, notes, signOff, forceInBodyFrom) | format-patch output changes | `FORMAT_PATCH_FLAGS` |

  Left alone on purpose (they choose hunks, not the format): `diff.algorithm`, `diff.indentHeuristic`, `diff.renameLimit`, `diff.orderFile` (raw and numstat keep one order), `diff.ignoreSubmodules`, `core.autocrlf`.
- **`rev-parse --verify --end-of-options X` does not echo `--end-of-options`** (without `--verify` it does), but it accepts `^X` and ranges — hence `assertCommitish` refuses a leading `^` and any `..`.
- **Untracked files need the `ls-files` gate before `--no-index`.** `git diff --no-index /dev/null out/etc/passwd` would read through a symlinked directory; `ls-files --others` never lists such a path. An untracked **symlink itself** is safe: `--no-index` shows mode `120000` and its target path (`readlink`), not the target's content.
- **A gitlink (mode 160000) is never a text hunk**: its `Subproject commit <oid>[-dirty]` lines become `FileDiff.submodule`. A gitlink can be committed without a submodule (`update-index --cacheinfo 160000,<oid>,path` plus an empty directory, so `add -A` keeps it) — that is how the fixture makes one offline.
- **The empty tree id** comes from `hash-object -t tree --stdin` (empty stdin, no `-w`): it differs between sha1 and sha256 repos, so it is never hard-coded.
- **`format-patch --root <tip>`** for a run starting at a root commit; `base..tip` otherwise. Only for merge-free runs: a merge commit gets a plain `diff --binary`.
