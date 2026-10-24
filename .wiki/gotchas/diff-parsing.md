# Gotcha: parsing git diff output

Code: `src/git/parse/diff.js`, `src/git/diff/source.js`. Reference: `docs/protocol.md` → Diff sources / diff ops.

- **Consume a hunk by its header counts, never by line prefix.** A content line can read `diff --git a/x b/x`, `@@ -1 +1 @@` or `--- a`; only the `-a,b +c,d` counts say where the hunk ends. `\ No newline at end of file` can follow the last counted line, so peek for it after the counts are spent.
- **`--raw --numstat -z` prints every raw record first, then every numstat record**, in the same order: join by index, never by path. A rename's raw record has two path fields; its numstat record is `a\td\t` followed by two more NUL fields (old, new). A path can start with `:` — fields are taken positionally, not by pattern.
- **An unmerged path appears twice in an index → worktree diff** (a `U` record, then an `M` one, in both lists); keep the `U` entry only (`parseRawNumstat`). `--cached` (tree → index) emits only the `U` record; a tree → worktree diff (`git diff HEAD`) only the `M` one.
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

  **Not neutralised — known residual risk:** `filter.<driver>.clean` / `.process` (selected by `.gitattributes`) still run when git reads a worktree file for a diff (index → worktree, tree → worktree, untracked `--no-index`). Git has no diff flag to turn them off; C1's `git status` already runs them for tracked files. Extdiff and textconv are not the only config that runs a program.

  Left alone on purpose (they choose hunks, not the format): `diff.algorithm`, `diff.indentHeuristic`, `diff.renameLimit`, `diff.orderFile` (raw and numstat keep one order), `diff.ignoreSubmodules`, `core.autocrlf`.
- **`rev-parse --verify --end-of-options X` does not echo `--end-of-options`** (without `--verify` it does), but it accepts `^X` and ranges — hence `assertCommitish` refuses a leading `^` and any `..`.
- **Untracked files need two gates before `--no-index`** (`diff.file` in `src/git/ops/diff.js`):
  - `ls-files --others` must list the path: it never lists a path *through* a symlinked directory (`out/etc/passwd`).
  - **A symlink *to a directory* is listed as the link itself**, and `git diff --no-index /dev/null <link>` stats through it, sees a directory, and diffs `<link>/null` — a regular file named `null` outside the repo, if one exists (else exit 1, empty output). So a raw probe (`--no-index --raw -z`, zero oids) must name exactly one entry equal to the path, or the read is refused. The probe is stat-only for regular files; a FIFO — at the path, behind a symlink given on the command line, or at `<link>/null` — is opened (git ≥ 2.42 reads a FIFO named on its command line) and blocks, returning no data. `git hash-object -- <link>` would also tell them apart (exit 128 for a directory), but on a file symlink it reads the outside target's content to hash it.
  - A symlink to a file is safe: `--no-index` shows mode `120000` and its target path (`readlink`), not the target's content.
- **The `--no-index` probe is bounded, not type-checked** (`probe` in `src/git/diff/noIndex.js`, `DIFF_LIMITS.probeTimeoutMs`, refusal `PROBE_TIMEOUT`). No git command classifies an arbitrary path by lstat without opening it, and a non-git type check would need an exec path beside `runGit`. A timeout cannot tell a FIFO from a slow System, so the refusal claims only that the probe did not finish. Every `worktreeEntry` / `readNoIndex` / `assertNoIndexReadsItself` caller gets the bound; a write op's probe holds the project lock for at most the bound.
  - **Why the bound need not scale with file size:** `strace -f` of the probe's exact argv (`BASE_ARGS`' `-c` pairs, `DIFF_CONFIG`, `DIFF_FLAGS`, `--raw -z --no-abbrev -- /dev/null <file>`), git 2.55.0, a 118 MiB regular file with a warm page cache, shows only two `newfstatat` calls on the file (one `AT_SYMLINK_NOFOLLOW`), no `openat` or `read`; the oids are zeros. ~1 ms per probe (3 runs), against 232 ms for `git hash-object --no-filters` reading the same file. The content read after a `file` verdict keeps the kind's timeout (it is capped by `maxBytes`).
- **`graph.commit` lists a commit's files with `diff-tree -r -z --raw --numstat --no-abbrev`** and `parseRawNumstat`, so its counts and flags are `diff.files`' (the same join by index).
- **A gitlink's numstat counts its `Subproject commit` line** (1 / 1 for a pointer change): lists show "submodule", never those numbers. **Untracked files have no numstat** in an index → worktree diff; counting them would take one `--no-index` diff per file (N+1), so lists show none.
- **A gitlink (mode 160000) is never a text hunk**: its `Subproject commit <oid>[-dirty]` lines become `FileDiff.submodule`. A gitlink can be committed without a submodule (`update-index --cacheinfo 160000,<oid>,path` plus an empty directory, so `add -A` keeps it) — that is how the fixture makes one offline.
- **The empty tree id** comes from `hash-object -t tree --stdin` (empty stdin, no `-w`): it differs between sha1 and sha256 repos, so it is never hard-coded.
- **`format-patch --root <tip>`** for a run starting at a root commit; `base..tip` otherwise. Only for merge-free runs: a merge commit gets a plain `diff --binary`.
