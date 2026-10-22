# Gotcha: staging, discarding and patching

Code: `src/git/ops/stage.js`, `src/git/params.js`, `src/git/stage/`. Reference: `docs/protocol.md` → Staging ops.

## Paths

- **`--pathspec-from-file=- --pathspec-file-nul` exists only on some subcommands**: `add`, `reset`, `restore`, `rm` (and `commit`, `checkout`, `stash push`). **`ls-files` and `clean` do not have it** (`ls-files` exits 129, "unknown option"). Their paths go after `--` in chunks (`chunkPaths`, `STAGE_LIMITS.argvChunkBytes`) — never a whole-repo listing filtered in JS, which grows with the repo instead of the request and would hit the read cap.
- **`GIT_LITERAL_PATHSPECS=1` covers pathspecs read from a file too**: `*.txt` from stdin matches only `*.txt`.
- **`ls-files --others -- <path>` is the untracked gate before `clean`.** git lists a path there only when it is untracked and not ignored and not reached through a symlinked directory; an untracked directory lists its files instead of itself, and a nested repository as `dir/`. Requiring the listing to equal the request is what keeps `clean` off ignored, tracked and outside files.
- **`clean` without `-x` does not delete an ignored file even when it is named** — a backstop, not the gate.
- **Unstaging on an unborn HEAD** is `rm --cached` (nothing to `reset` to); `rm --cached -- .` on an empty index needs `--ignore-unmatch`.
