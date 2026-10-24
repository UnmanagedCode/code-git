# Gotcha: git-flow, git-lfs and hooks

## Git-flow

- **The production key is `gitflow.branch.master`** whatever the branch is called (nvie's and AVH's name); the version-tag key reads back lowercased, `gitflow.prefix.versiontag`. `config -z --get-regexp` prints `key\nvalue\0`, and a key with no `=` prints `key\0` with no newline (an empty value here: `readFlowConfig`).
- **`merge-tree --write-tree` needs git ≥ 2.38**. With `-z --name-only --no-messages`, exit 0 is clean, exit 1 conflicted; stdout is the tree id, then the conflicted paths, each NUL-terminated (`preflight` in `src/git/ops/flow.js` drops the first field). It writes nothing to refs, HEAD or the index: the preflight that makes `FLOW_CONFLICT` atomic.
- **Develop merges the flow branch, not the tag** (nvie; AVH merges the tag). That is what lets both merges be preflighted before the first write.
- **`switch -c <name> --end-of-options <oid>`**: the new branch's name is `-c`'s value, never parsed as an option, so it sits before `--end-of-options` (as `branch.create`). The argv test allows exactly that.
- **A failing `pre-merge-commit` hook makes `git merge` exit 1 with no unmerged path** and leaves `MERGE_HEAD` and the staged result. `integrate.merge` accepts exit 1 (a merge's conflict exit), so the command's activity entry reads `ok` while the op refuses `GIT_FAILED` (in `flow.finish`: `FLOW_INCOMPLETE`'s cause); look entries up by argv, not by `failed`.

## git-lfs

- **Every git-lfs command but `version` may write.** `git lfs track` installs git-lfs's four hooks and creates `.git/lfs/tmp` even to list (`--json`, `--dry-run`); `ls-files` creates `.git/lfs/objects` once there are LFS files, and hooks when the filter is configured. So `lfs.status` never runs them: it parses the root `.gitattributes` itself (`parseLfsAttributes`, git's attr parser rules) and the file list is `lfs.files`, a journal-neutral write the user asks for.
- **git runs git-lfs too**: with LFS files and the filter configured, a plain `git status` runs the clean filter, which installs the hooks and creates `.git/lfs`. A harness asserting "nothing written" after opening a tab fails for that reason, not because of an LFS op; `tests/ops-lfs.test.js` proves `lfs.status` alone leaves `.git` byte-identical.
- **A foreign hook at one of git-lfs's hook names makes it install none** of the four, keep that hook and exit 0.
- **`GIT_LITERAL_PATHSPECS=1` breaks `git lfs pull` silently**: it checks nothing out and exits 0. The LFS ops run `git --no-literal-pathspecs lfs …` (git sets the variable to 0 for git-lfs and the git it runs); `subcommandOf` skips that flag when naming the subcommand.
- **`ls-files --json` answers `{"files": null}`** for no LFS files, not `[]`. Its 3.3.0 fields are `name, size, checkout, downloaded, oid_type, oid, version`; the parser reads `name, size, oid, downloaded` only.
- **`git lfs version` without git-lfs** is git's own `git: 'lfs' is not a git command` (exit 1, under `LC_ALL=C`).
- **A path or `file://` remote needs no LFS server**: git-lfs's standalone file transfer serves it. Tests and seeds push objects with `git lfs push --all origin` and clone smudge-skipped (`GIT_LFS_SKIP_SMUDGE=1`) to get pointer files.
- **Tests write `filter.lfs.*` into the temp HOME's gitconfig** (`lfsFilters` in `tests/_lfs.js`, `GIT_CONFIG_GLOBAL` from `hermeticEnv`), never into the developer's global config.
- **A System without git-lfs but with `filter.lfs.required=true`** makes git itself fail (`git status` cannot run the required filter): the "absent" worlds (`strippedWorld`, `seedLfs({absent: true})`) use a repo and HOME without LFS filter config.
- **Removing git-lfs from a fake System**: `cc.state.inheritedEnv = {PATH: <dir>}` with only a `git` symlink in `<dir>`. git finds its own helpers through its exec path, not PATH; git-lfs is found through PATH. A stub `git-lfs` script there fakes an older version.

## Hooks

- **git sends a hook's stdout to stderr, except pre-push's**: a pre-push hook's stdout goes to git's stdout, which `push --porcelain` output shares, so code-git shows only what it prints to stderr (`tests/hooks.test.js` pins it).
- **post-checkout runs after the switch**: when it fails, `branch.checkout` refuses `GIT_FAILED` but HEAD has moved.
