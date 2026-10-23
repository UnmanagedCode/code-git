# Gotcha: cc's exec contract

Authoritative contract: cc's `docs/plugins.md` → Host exec, and `src/hostExec.ts` in cc. What bites:

- **Buffered whole, no streaming, no progress.** A long op shows only an elapsed timer. Don't design a feature around progress output.
- **The output cap kills, it never clips.** Past `maxOutputBytes` cc kills the command and answers `EXEC_OUTPUT_TOO_LARGE` → `OUTPUT_TOO_LARGE`. Large reads must page by git arguments (`--max-count`, one path at a time, `-L`, `cat-file -s` first) — never fetch everything and slice.
- **Unknown keys are refused** (`INVALID_ARGUMENT`), and code-git maps that to `INTERNAL`: it is always our bug. So omit `worktree` for the main checkout rather than sending `null`, and send stdin as `stdinB64`.
- **Caps:** cc refuses `timeoutMs`/`maxOutputBytes` above its maxima; `LIMITS` (`src/git/limits.js`) must stay within `CC_EXEC_CAPS` (`src/conductor/exec.js`) — a test pins it.
- **Cancel = disconnect.** cc kills the command when the client disconnects. That is why `cancellable` exists: a write aborted mid-command can leave `index.lock` or a half-done rebase, so writes default to non-cancellable and their HTTP request's `close` does **not** abort them (`src/routes/ops.js`). A write may opt in (fetch, push) only when an abort is safe.
- **Deadline ordering.** The fetch to cc waits `timeoutMs + min(10 s, timeoutMs)` so cc's `EXEC_TIMEOUT` (with partial stderr) arrives before our own deadline fires.
- **Retry only reads, only connection failures.** A write retried after a reset may have run once already.
- **Form A only**; `system`/`remoteId`/`cwd`/`shell` never appear. The fake cc records any such use in `state.violations` so tests can assert it never happens.
- **Credentials:** prompts are off (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, and `GIT_ASKPASS`/`SSH_ASKPASS` set to `false` with `SSH_ASKPASS_REQUIRE=never`: cc's local provider merges the System's own environment, so an inherited askpass would otherwise run and hang a push until its timeout; the fake cc's `state.inheritedEnv` reproduces it), so remote auth must come from the target System's credential helper or ssh-agent. An op that would prompt fails.
