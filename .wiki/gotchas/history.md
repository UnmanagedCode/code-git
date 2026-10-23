# Gotcha: history, blame, reflog

The read ops in `src/git/ops/history.js` (reference: `docs/history.md`). Each is pinned by `tests/history-git-probes.test.js`.

- **`log --follow` breaks `--skip`** (git 2.55): the skip counts commits of the unfiltered walk, and skipping the rename commit loses the file — `--skip=2` on a four-commit renamed history is empty. `--max-count` counts shown commits correctly. history.file therefore re-walks with `--max-count=skip+limit+1` and slices: the paging convention's only exception, bounded by `HISTORY_LIMITS.followMaxCommits` — chosen over a cursor restarting at the last shown commit, which loses side branches merged below it.
- **The `-z --name-status` layout** with a NUL-separated format: six NUL-ended fields, then a token `\n<status>`, then one path (two for `R`/`C`: old, new), each NUL-ended, then the next commit's oid with no separator. A commit with no entry (a merge) has none of the status tokens.
- **`-c blame.ignoreRevsFile=` does not clear a configured file**: blame keeps a sorted list of files and opens each; a missing one dies "could not open object name list" before the empty entry could reset anything. `--no-ignore-revs-file` (OPT_STRING_LIST's `--no-` form) clears the list.
- **blame takes no `--end-of-options`** before its revision (it reads the next argument as one): the rev is always a validated full oid.
- **blame runs textconv by default** (`diff.<driver>.textconv` from `.gitattributes`): `--no-textconv` always. `diff --numstat` does not run textconv, but takes the flag anyway.
- **`%gd` is the entry's time under `--date=unix`** (`HEAD@{1700000000}`), its index otherwise: the selector `HEAD@{n}` is computed from `skip + i`.
- **`log -g` of a ref that does not exist exits 128** ("bad revision"); a branch with no reflog file exits 0 with nothing: both are an empty list.
