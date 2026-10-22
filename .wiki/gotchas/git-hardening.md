# Gotcha: hardening git invocations

All in `src/git/runner.js` (`BASE_ARGS`, `BASE_ENV`, `READ_ENV`) and `src/git/validate.js`.

- **Paths always follow `--`, and `GIT_LITERAL_PATHSPECS=1` is always set.** Without it, a path named `:(glob)*` or `*.txt` is pathspec magic matching other files. That is why `assertPath` *allows* a leading `-`: after `--` a file named `-rf` is just a file (runner tests create one).
- **Revisions refuse a leading `-`** (`assertRev`) — `--output=/tmp/x` as a "ref" would be an option. Also pass `--end-of-options` before a revision for subcommands that parse options. Gotcha: `git rev-parse --end-of-options X` *echoes* `--end-of-options`; use `log -1 --format=%H --end-of-options X` or `rev-parse --verify`.
- **`-C <subpath>`** needs `assertSubpath` (no leading `-`): there is no `--` before `-C`'s value.
- **Editors are `false`** (`GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`): an accidental editor launch fails loudly instead of hanging until the timeout. An op that needs an editor (interactive-rebase todo) overrides it in its own env. Everything else that changes *what* runs or *where* is off-limits to an op's env (`isProtectedEnv` in `src/git/runner.js`): prompts, `GIT_LITERAL_PATHSPECS`, `GIT_DIR`/`GIT_WORK_TREE`, `GIT_EXEC_PATH`, `GIT_SSH*`, and any `GIT_CONFIG*` — the `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` triple is arbitrary `-c` config, i.e. `core.sshCommand`, `core.hooksPath`, aliases. Setting one throws (fail loudly), it is not silently dropped.
- **`LC_ALL=C`** keeps git's messages stable; `repo.summary` maps exit 128 + "not a git repository" to `NOT_A_REPO` and relies on it. Other exit-128 failures (dubious ownership) stay `GIT_FAILED`.
- **Reads set `GIT_OPTIONAL_LOCKS=0`** so `git status` never rewrites the index — reads stay read-only, which the live harness depends on.
- **`core.quotePath=false`** plus `-z` output: parse NUL-separated fields; never regex over paths. In porcelain v2, a rename entry (`2 …`) is followed by an extra NUL field, its original path — skip it or it is miscounted as another entry (`parseStatus`).
- **Decode untrusted output with `TextDecoder('utf-8', {fatal: false})`**; never interpret it.
