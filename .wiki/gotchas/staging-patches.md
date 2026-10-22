# Gotcha: staging, discarding and patching

Code: `src/git/ops/stage.js`, `src/git/params.js`, `src/git/stage/`. Reference: `docs/protocol.md` → Staging ops.

## Paths

- **`--pathspec-from-file=- --pathspec-file-nul` exists only on some subcommands**: `add`, `reset`, `restore`, `rm` (and `commit`, `checkout`, `stash push`). **`ls-files` and `clean` do not have it** (`ls-files` exits 129, "unknown option"). Their paths go after `--` in chunks (`chunkPaths`, `STAGE_LIMITS.argvChunkBytes`) — never a whole-repo listing filtered in JS, which grows with the repo instead of the request and would hit the read cap.
- **`GIT_LITERAL_PATHSPECS=1` covers pathspecs read from a file too**: `*.txt` from stdin matches only `*.txt`.
- **`ls-files --others -- <path>` is the untracked gate before `clean`.** git lists a path there only when it is untracked and not ignored and not reached through a symlinked directory; an untracked directory lists its files instead of itself, and a nested repository as `dir/`. Requiring the listing to equal the request is what keeps `clean` off ignored, tracked and outside files.
- **`clean` without `-x` does not delete an ignored file even when it is named** — a backstop, not the gate.
- **Unstaging on an unborn HEAD** is `rm --cached` (nothing to `reset` to); `rm --cached -- .` on an empty index needs `--ignore-unmatch`.

## Selection patches (`buildSelectionPatch`)

- **Decode the diff as latin1, compare as UTF-8.** latin1 maps each byte to one character, so the rebuilt patch is byte-exact (CRLF, non-UTF-8). The UI's text came from a UTF-8 non-fatal decode; `asShown` reproduces it per line. Per-line and whole-output decoding agree because `\n` is never inside a UTF-8 sequence and the decoder replaces per maximal invalid subpart.
- **Which side is fixed.** Forward (stage) applies to the old side, so the old side keeps git's numbers; reverse (unstage/discard, applied with `-R`) applies to the new side. The other side's start is "lines before + growth of earlier emitted hunks"; an empty side's start is the line *before* it (`@@ -3,0 +4,2 @@`), so its lines-before is `start`, not `start − 1`.
- **Pair, don't keep git's order, inside a change block.** git prints all `-` then all `+`. Turning an unselected `-d` into context in place puts a selected `+C` after it (`d C`) — what `git add -p`'s manual edit does. Pairing the i-th `-` with the i-th `+` gives `C d`, what the split view shows.
- **Never apply a zero-context patch.** `git apply --unidiff-zero` matches a context-free hunk at the wrong occurrence and exits 0 — on a file without a final newline it changes other lines, even with git's own `-U0` output. A request made against a context-0 diff is mapped (kind + line number + text) onto a re-read at `APPLY_MIN_CONTEXT` and built from that: git's edit script does not depend on `-U`, only its grouping into hunks does. Without `--unidiff-zero`, git requires a hunk lacking leading/trailing context to sit at the file's start/end, which is what keeps it honest.
- **"\ No newline at end of file" binds to the line before it** and that line must stay the last of every side it is on; otherwise the selection needs the newline change too (`SELECTION_UNSUPPORTED`). `git apply` itself accepts the marker after a `+` line that `-` lines follow.
- **Neutralise `apply.whitespace` / `apply.ignoreWhitespace`** with `--whitespace=nowarn --no-ignore-whitespace` (`=error` refuses trailing spaces; `ignoreWhitespace=change` fuzzes the context match).
- **Never `git apply --index`: it writes through an untracked symlink.** Its symlink check reads the index, so with an untracked `link → /outside`, a patch creating `link/x` exits 0 and writes `/outside/x`. Plain `git apply` lstat-checks the worktree and refuses ("affected file … is beyond a symbolic link"); `--cached` accepts the path into the index only and writes nothing on disk. That is why `patch.apply` has no "both" target; "apply then stage" is two steps.
- **`git apply` refuses `..`, absolute and `.git/` paths with exit 128** ("invalid path"), the same exit as "No valid patches in input"; "does not apply" is exit 1.
- **`git restore --source=<c> --worktree` through an untracked symlinked directory** replaces the link with a real directory (deleting the link) and writes inside the repo.

## Ignore

- **`.git/info/exclude` cannot be written with git commands** (`git apply` refuses `.git/`), so ignore targets the root `.gitignore`.
- **Append with the whole file as context**, not with `--unidiff-zero` after the last line: a concurrent edit then fails the apply instead of being overwritten. An empty file has no context, so it alone uses `--unidiff-zero`.
- **Stop tracking by this pattern only**: `ls-files -c -i --exclude=<pattern>` without `--exclude-standard`, or a file already ignored-but-tracked would be untracked too.

## Commit

- **`commit --amend --only` with no paths amends the message alone**: the tree stays HEAD's and the staged changes stay staged. Plain `--amend` takes the index in.
- **`-F` has its own cleanup default: `whitespace`**, which keeps `#` lines (`strip` is the default only when an editor runs). code-git passes no `--cleanup`, so a repo's `commit.cleanup` still wins.
- **`diff --cached --quiet` works on an unborn HEAD** (it compares with the empty tree); with nothing staged, a commit is still valid while `MERGE_HEAD` exists.
- **The commit template is read with git only**: `config --path --get` expands `~/`; `diff --no-index` never follows a symlink (it shows the target path, mode 120000), so symlinks are followed by hand, relative to the link's directory, with a hop limit for loops.
- **Signing without a tty fails fast**: gpg 2 + pinentry-curses under cc's exec (no controlling terminal) exits at once ("Inappropriate ioctl for device"); a passphrase prompt never hangs there.
