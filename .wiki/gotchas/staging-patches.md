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
- **`--unidiff-zero` at context 0**, or `git apply` refuses hunks without context.
- **"\ No newline at end of file" binds to the line before it** and that line must stay the last of every side it is on; otherwise the selection needs the newline change too (`SELECTION_UNSUPPORTED`). `git apply` itself accepts the marker after a `+` line that `-` lines follow.
- **Neutralise `apply.whitespace` / `apply.ignoreWhitespace`** with `--whitespace=nowarn --no-ignore-whitespace` (`=error` refuses trailing spaces; `ignoreWhitespace=change` fuzzes the context match).
- **`git apply --cached` does not check the worktree**, so a path beyond a symlink is accepted into the index (nothing is written on disk); `git apply` / `--index` refuse it ("beyond a symbolic link").

## Commit

- **`commit --amend --only` with no paths amends the message alone**: the tree stays HEAD's and the staged changes stay staged. Plain `--amend` takes the index in.
- **`-F` has its own cleanup default: `whitespace`**, which keeps `#` lines (`strip` is the default only when an editor runs). code-git passes no `--cleanup`, so a repo's `commit.cleanup` still wins.
- **`diff --cached --quiet` works on an unborn HEAD** (it compares with the empty tree); with nothing staged, a commit is still valid while `MERGE_HEAD` exists.
- **The commit template is read with git only**: `config --path --get` expands `~/`; `diff --no-index` never follows a symlink (it shows the target path, mode 120000), so symlinks are followed by hand, relative to the link's directory, with a hop limit for loops.
- **Signing without a tty fails fast**: gpg 2 + pinentry-curses under cc's exec (no controlling terminal) exits at once ("Inappropriate ioctl for device"); a passphrase prompt never hangs there.
