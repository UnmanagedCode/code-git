// COPY of src/git/remote/net.js on code-conductor/c6-remotes (C6 Remotes). On rebase onto C6: delete this file and import the original.
import { NETWORK_LIMITS } from '../../remote/limits.js';

// The one way a command that talks to a remote runs (fetch, push, ls-remote). Credentials come only from the System's
// helper or agent: BASE_ENV turns every prompt off, so a command that would prompt fails (REMOTE_AUTH_FAILED).

/**
 * Before every network subcommand. The `ext::` transport runs an arbitrary command and `fd::` talks over inherited
 * descriptors; a repo's config can reach them (`protocol.allow`, `protocol.ext.allow`, an `insteadOf` rewriting a url to
 * `ext::…`). `protocol.<name>.allow` beats `protocol.allow`, and `-c` beats every config file, so these two win.
 */
export const NET_CONFIG = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.fd.allow=never'];

/** Runs `args` (a network subcommand and its arguments) under NET_CONFIG and NETWORK_LIMITS; `opts.okExit` as runGit's. */
export function netRun(git, args, opts = {}) {
  return git([...NET_CONFIG, ...args], { timeoutMs: NETWORK_LIMITS.timeoutMs, maxOutputBytes: NETWORK_LIMITS.maxOutputBytes, ...opts });
}
