# Gotcha: submodules

Code: `src/git/ops/submodule.js`, `src/git/submodule/`, `subArgs` in `src/git/runner.js`. Reference: `docs/submodules.md`. Raw git behaviour is pinned by `tests/submodule-git-probes.test.js` (each probe has a control).

## Addressing

- **`-C <sub>` alone walks up.** In a submodule that is not cloned (empty directory), plain `git -C libA … --work-tree=.` finds the *parent's* repository and treats `libA/` as the parent's working tree: `add -A` stages `libA/x.txt` as `x.txt` in the parent's index. `--git-dir=.git` after `-C` turns discovery off (exit 128, "not a git repository") and still reads a gitfile. `--work-tree=.` before `-C` resolves after it.
- **Containment is a whole-string compare** of the submodule's `rev-parse --show-toplevel` against `<checkout top>/<chain>\n`. git realpaths the working tree, so any symlinked component in the chain (the submodule itself, or a directory above it) differs. Never split the output on `\n`.
- **A gitfile can name any repository**: `evil/.git` = `gitdir: <other>/.git` still reports `<root>/evil` as its top level, so writes would land in `<other>`. The git dir must be checked too: `rev-parse --absolute-git-dir` (git realpaths it, `..` and symlinks resolved) must equal `<parent's --absolute-git-dir>/modules/<name>` for the name `.gitmodules` declares at that path, or `<top>/.git`. Use the parent's *own* git dir, not `--git-common-dir`: in a linked worktree, `submodule update` puts git dirs under `<common>/worktrees/<wt>/modules/`. Nested: each level against its parent's git dir (a git dir anywhere under the checkout's `modules/` is not enough — another submodule's would pass).
- **Collapsing `.gitmodules` by name hides aliases**: `config --get-regexp` returns every section's records, and a second `[submodule "libA"]` with `path = evil` overwrote libA's path in a by-name map, so `evil` borrowed libA's name and passed `modules/<name>`. Read every (name, path) pair; a name at two paths or a path under two names blocks every entry involved.
- **`submodule add` adopts an existing path** ("Adding existing repo") instead of cloning — whatever repository its `.git` names; add refuses any existing path.
- **A submodule write holds the project's lock**: the pointer is the parent's state. The preflight's reads (three for the checkout plus two per chain level) take no lock, so a symlink or gitfile swapped in between preflight and op is not caught (documented residual).

## Untrusted config

- **`--checkout` overrides `submodule.<name>.update=!cmd`**, at the top level and in the recursion (the nested repo's own config). Without it both commands run. git already ignores `update=!cmd` from `.gitmodules`; it is `.git/config` that matters.
- **`-c` reaches git's submodule child processes** (through `GIT_CONFIG_PARAMETERS`): `-c core.fsmonitor=false` stops a submodule's fsmonitor during the parent's `status`/`update`; `-c protocol.ext.allow=never` beats a submodule's own `protocol.ext.allow=always` plus `url.ext::….insteadOf`.
- **A fresh clone's child does not read the parent's local config**: a parent-local `protocol.ext.allow=always` does not let an `ext::` submodule url clone. code-git still refuses repo-scope `protocol.*` (a submodule tab's own repo, and fetches inside an existing submodule, do read it).
- **`protocol.file.allow` defaults to `user` for submodule clones**: a local-path submodule url fails "transport 'file' not allowed" unless the System's global/system config opts in. The test System's global config (`hermeticEnv`) opts in; product code never sets it.
- **`config --show-scope -z --get-regexp`** prints `scope\0key\nvalue\0` per entry: alternate fields, split the second at its first `\n`.
- **`.gitmodules` keys**: `config -f .gitmodules -z --get-regexp` prints `key\nvalue\0` (a value-less key has no `\n`); the name is between `submodule.` and the **last** `.` (names hold dots and spaces); a missing file is exit 1, like no match.
- **A symlinked `.gitmodules` is written through** by `git config --file` (its lock file dereferences), so add/setUrl/remove refuse it first.
- **A relative url resolves against the default remote as git expands it**: check `ls-remote --get-url <remote>` (insteadOf applied, no network; an unknown remote prints its own name), not the raw `remote.<r>.url`.

## Writes

- **`submodule add` leaves the clone on its branch**; `submodule update` detaches. An "orphan" count is only meaningful on a detached HEAD (a branch keeps its commits), so tests that want orphans `checkout --detach` first.
- **`rev-list … --end-of-options <oid>` needs a trailing `--`**: a file named like the oid in the submodule's working tree makes it "ambiguous argument … both revision and filename".
- **`git rm` of a submodule refuses while `.gitmodules` has unstaged changes** ("please stage your changes to .gitmodules"): it stages the whole file with the removal. Edit URL leaves exactly that state; remove reports it (`gitmodules` fact) and, once confirmed, stages `.gitmodules` first.
- **`git rm` without `-f` refuses a staged-but-uncommitted gitlink** ("has changes staged in the index"): remove reports `staged` before deinit runs, so a refusal never leaves the submodule half-removed.
- **No gitlink in the index → git's submodule commands fail** "pathspec did not match" (`init`, `update`, `sync`, `deinit`, `rm`): they address submodules through the index, not `.gitmodules`. So: refuse `SUBMODULE_NOT_RECORDED` for init/update/sync; remove drops the `.gitmodules` section by `config --remove-section`, or, for a gitlink still in HEAD (`rm --cached`), puts the index entry back from HEAD and removes normally. A conflicted gitlink has no stage-0 entry either: it is not "not recorded" (init and sync run), but `submodule update` prints "Skipping unmerged submodule" and exits 0, so update refuses `SUBMODULE_CONFLICTED`.
- **`prefsKey` must not join paths with `/`**: chains `['a/b']` and `['a', 'b']` would share prefs. NUL, as `tabKey` uses.
- **`submodule deinit` drops the whole `submodule.<name>` config section**, `update` included: a probe re-arming `update=!cmd` must set it after each `init`.
- **Removal keeps `.git/modules/<name>`**; adding the same name again fails "A git directory for '…' is found locally" (→ `SUBMODULE_EXISTS {reason: 'gitdir'}`).
- **`commit --only -- <gitlink>` re-reads the submodule's HEAD at commit time**, so a move after the check commits a pointer the user never saw. commitPointer commits a temporary index (HEAD's tree + `update-index --cacheinfo 160000,<expect>,<path>`, `GIT_INDEX_FILE` is not a protected name) and then sets the real index's entry the same way: exactly `expect`, other staged changes untouched, hooks still run.

## UI

- **Reads race multi-command writes**: the graph/summary watchers refresh after each finished write *command*, so a `git status` started mid-`deinit` or mid-clone can fail (`GIT_FAILED`, or `NOT_A_REPO` for exit 128) and the header flashes an error until the op's own refresh. Known limitation; `submodules.mjs` tolerates only that case.
- **The exit watcher starts when `SubmoduleDialogHost` mounts**, not at module load: `test/setup.ts`'s `tabsStore.set(EMPTY)` would otherwise read as every submodule tab closing and fire `submodule.list` after the test.
